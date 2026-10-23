(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORAGE = {
    favorites: "rongjingmusic:favorites:v1",
    recent: "rongjingmusic:recent:v1",
    volume: "rongjingmusic:volume:v1",
    shuffle: "rongjingmusic:shuffle:v1",
    repeat: "rongjingmusic:repeat:v1"
  };
  const DB_NAME = "rongjingmusic-library";
  const DB_VERSION = 1;
  const DB_STORE = "tracks";
  const palette = ["#9b493e", "#ad8454", "#65786b", "#65748b", "#82677e", "#8d6e4d"];

  const state = {
    catalogTracks: [],
    localTracks: [],
    visibleTracks: [],
    queue: [],
    queueIndex: -1,
    currentTrackId: null,
    view: "discover",
    filter: "all",
    query: "",
    favorites: readArray(STORAGE.favorites),
    recent: readArray(STORAGE.recent),
    isPlaying: false,
    shuffle: localStorage.getItem(STORAGE.shuffle) === "true",
    repeat: ["off", "all", "one"].includes(localStorage.getItem(STORAGE.repeat)) ? localStorage.getItem(STORAGE.repeat) : "off",
    volume: readVolume(),
    databaseAvailable: true
  };

  const el = {
    audio: $("#audio"),
    hero: $(".hero"),
    heroVinyl: $("#hero-vinyl"),
    heroTrackIndex: $("#hero-track-index"),
    trackCount: $("#track-count"),
    pageHeading: $("#page-heading"),
    sectionTitle: $("#section-title"),
    sectionEyebrow: $("#section-eyebrow"),
    trackList: $("#track-list"),
    queueList: $("#queue-list"),
    queueCount: $("#queue-count"),
    emptyState: $("#empty-state"),
    emptyTitle: $("#empty-title"),
    emptyDescription: $("#empty-description"),
    search: $("#search-input"),
    fileInput: $("#file-input"),
    playButton: $("#play-button"),
    progress: $("#progress"),
    currentTime: $("#current-time"),
    duration: $("#duration"),
    volume: $("#volume"),
    nowTitle: $("#now-title"),
    nowArtist: $("#now-artist"),
    nowLike: $("#now-like"),
    miniCover: $("#mini-cover"),
    shuffleButton: $("#shuffle-button"),
    repeatButton: $("#repeat-button"),
    toast: $("#toast")
  };

  let toastHandle = 0;
  let dbPromise = null;
  let lastMediaSessionTrackId = null;

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function readVolume() {
    const value = Number(localStorage.getItem(STORAGE.volume));
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function allTracks() {
    return state.catalogTracks.concat(state.localTracks);
  }

  function getTrack(id) {
    return allTracks().find((track) => track.id === id) || null;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    window.clearTimeout(toastHandle);
    toastHandle = window.setTimeout(() => el.toast.classList.remove("is-visible"), 3000);
  }

  function openDatabase() {
    if (!("indexedDB" in window)) {
      return Promise.reject(new Error("IndexedDB is unavailable"));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DB_STORE)) {
          database.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open local music database"));
      request.onblocked = () => reject(new Error("Local music database is blocked"));
    });
    return dbPromise;
  }

  async function readLocalRecords() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("Could not read local music"));
    });
  }

  async function writeLocalRecord(record) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save local music"));
      transaction.onabort = () => reject(transaction.error || new Error("Saving local music was aborted"));
    });
  }

  async function deleteLocalRecord(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not remove local music"));
    });
  }

  async function loadCatalog() {
    try {
      const response = await fetch("./data/catalog.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Catalogue returned " + response.status);
      const payload = await response.json();
      state.catalogTracks = (Array.isArray(payload.tracks) ? payload.tracks : []).map((track, index) => ({
        ...track,
        id: String(track.id || "catalog-" + index),
        artist: track.artist || "荣景音乐",
        album: track.album || "荣景音乐作品",
        tag: track.tag || "荣景作品",
        durationSeconds: Number(track.durationSeconds) || 0,
        color: track.color || palette[index % palette.length],
        isLocal: false
      }));
    } catch (error) {
      state.catalogTracks = [];
      console.warn("Rongjing Music catalogue could not be loaded.", error);
      toast("公开曲库暂时无法载入。你仍然可以导入本地音乐。");
    }
  }

  async function loadLocalLibrary() {
    try {
      const records = await readLocalRecords();
      state.localTracks = records
        .filter((record) => record && record.blob)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((record, index) => ({
          ...record,
          artist: record.artist || "本地音乐",
          album: record.album || "本地导入",
          tag: "本地导入",
          color: record.color || palette[index % palette.length],
          durationSeconds: Number(record.durationSeconds) || 0,
          src: URL.createObjectURL(record.blob),
          isLocal: true
        }));
    } catch (error) {
      state.databaseAvailable = false;
      state.localTracks = [];
      console.warn("Local music persistence is unavailable.", error);
    }
  }

  function tracksForView() {
    let tracks = allTracks();
    if (state.view === "favorites") {
      tracks = tracks.filter((track) => state.favorites.includes(track.id));
    } else if (state.view === "recent") {
      tracks = state.recent.map((id) => tracks.find((track) => track.id === id)).filter(Boolean);
    } else if (state.view === "discover") {
      tracks = tracks.filter((track) => !track.isLocal);
    }

    if (state.filter === "catalog") tracks = tracks.filter((track) => !track.isLocal);
    if (state.filter === "local") tracks = tracks.filter((track) => track.isLocal);
    if (state.query) {
      const query = state.query.toLocaleLowerCase();
      tracks = tracks.filter((track) =>
        [track.title, track.artist, track.album, track.tag]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      );
    }
    return tracks;
  }

  function setView(view) {
    if (!["discover", "library", "favorites", "recent"].includes(view)) return;
    state.view = view;
    state.filter = "all";
    $$(".nav-item[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === view);
    });
    const labels = {
      discover: "发现",
      library: "全部曲库",
      favorites: "我喜欢的",
      recent: "最近播放"
    };
    const titles = {
      discover: "为你推荐",
      library: "全部曲库",
      favorites: "我喜欢的",
      recent: "最近播放"
    };
    el.pageHeading.textContent = labels[view];
    el.sectionTitle.textContent = titles[view];
    el.sectionEyebrow.textContent = view === "discover" ? "CURATED LISTENING" : "YOUR MUSIC";
    el.hero.hidden = view !== "discover";
    $$(".filter-chip").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.filter === "all");
    });
    renderLibrary();
  }

  function setFilter(filter) {
    state.filter = filter;
    $$(".filter-chip").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.filter === filter);
    });
    renderLibrary();
  }

  function renderLibrary() {
    const tracks = tracksForView();
    state.visibleTracks = tracks;
    renderTrackList(tracks);
    renderQueue();
    updateCounts();
    updatePlayer();
  }

  function updateCounts() {
    const count = allTracks().length;
    el.trackCount.textContent = count + " 首作品";
    el.queueCount.textContent = String((state.queue.length || allTracks().length)).padStart(2, "0");
    $("#view-all").hidden = state.view !== "discover";
  }

  function createIconButton(action, label, symbol, extraClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button " + (extraClass || "");
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = symbol;
    return button;
  }

  function renderTrackList(tracks) {
    el.trackList.replaceChildren();
    el.emptyState.hidden = tracks.length > 0;
    if (tracks.length === 0) {
      if (state.query) {
        el.emptyTitle.textContent = "没有找到这首歌";
        el.emptyDescription.textContent = "试试其他关键词，或把音乐文件导入曲库。";
      } else if (state.view === "favorites") {
        el.emptyTitle.textContent = "还没有收藏";
        el.emptyDescription.textContent = "遇见喜欢的旋律时，点一下爱心，它就会留在这里。";
      } else if (state.view === "recent") {
        el.emptyTitle.textContent = "还没有播放记录";
        el.emptyDescription.textContent = "播放过的作品会出现在这里。";
      } else {
        el.emptyTitle.textContent = state.filter === "local" ? "还没有本地音乐" : "曲库还在生长";
        el.emptyDescription.textContent = "导入一首本地音乐，或稍后回来听新的作品。";
      }
      return;
    }

    tracks.forEach((track, index) => {
      const row = document.createElement("div");
      row.className = "track-row" + (track.id === state.currentTrackId ? " is-current" : "") + (track.isLocal ? " is-local" : "");
      row.dataset.trackId = track.id;

      const indexCell = document.createElement("div");
      indexCell.className = "track-index";
      indexCell.textContent = String(index + 1).padStart(2, "0");
      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.className = "row-play";
      playButton.dataset.action = "play";
      playButton.dataset.trackId = track.id;
      playButton.setAttribute("aria-label", (track.id === state.currentTrackId && state.isPlaying ? "暂停 " : "播放 ") + track.title);
      playButton.textContent = track.id === state.currentTrackId && state.isPlaying ? "Ⅱ" : "▶";
      indexCell.append(playButton);

      const main = document.createElement("div");
      main.className = "track-main";
      const title = document.createElement("div");
      title.className = "track-title";
      title.textContent = track.title || "未命名音轨";
      const subtitle = document.createElement("div");
      subtitle.className = "track-subtitle";
      subtitle.textContent = (track.artist || "荣景音乐") + (track.isLocal ? " · 本地文件" : "");
      main.append(title, subtitle);

      const tag = document.createElement("div");
      tag.className = "track-tag";
      tag.textContent = track.album || track.tag || "荣景作品";

      const duration = document.createElement("div");
      duration.className = "track-duration";
      duration.textContent = formatTime(track.durationSeconds);

      const like = createIconButton(
        "favorite",
        state.favorites.includes(track.id) ? "取消收藏" : "收藏歌曲",
        state.favorites.includes(track.id) ? "♥" : "♡",
        "track-like" + (state.favorites.includes(track.id) ? " is-liked" : "")
      );
      like.dataset.trackId = track.id;

      row.append(indexCell, main, tag, duration, like);
      if (track.isLocal) {
        const remove = createIconButton("delete", "从本地曲库移除", "×", "track-delete");
        remove.dataset.trackId = track.id;
        row.append(remove);
      }
      el.trackList.append(row);
    });
  }

  function renderQueue() {
    const tracks = state.queue.length ? state.queue : allTracks();
    el.queueList.replaceChildren();
    el.queueCount.textContent = String(tracks.length).padStart(2, "0");
    tracks.slice(0, 5).forEach((track, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "queue-item" + (track.id === state.currentTrackId ? " is-current" : "");
      item.dataset.trackId = track.id;
      const number = document.createElement("span");
      number.className = "queue-number";
      number.textContent = track.id === state.currentTrackId && state.isPlaying ? "♫" : String(index + 1).padStart(2, "0");
      const copy = document.createElement("span");
      copy.className = "queue-copy";
      const title = document.createElement("span");
      title.className = "queue-title";
      title.textContent = track.title || "未命名音轨";
      const artist = document.createElement("span");
      artist.className = "queue-artist";
      artist.textContent = track.artist || "荣景音乐";
      copy.append(title, artist);
      const action = document.createElement("span");
      action.className = "queue-play";
      action.setAttribute("aria-hidden", "true");
      action.textContent = track.id === state.currentTrackId && state.isPlaying ? "Ⅱ" : "▶";
      item.append(number, copy, action);
      el.queueList.append(item);
    });
    if (tracks.length === 0) {
      const note = document.createElement("p");
      note.className = "queue-artist";
      note.textContent = "导入音乐后，播放队列会显示在这里。";
      el.queueList.append(note);
    }
  }

  function updatePlayer() {
    const track = getTrack(state.currentTrackId);
    const playing = state.isPlaying && !el.audio.paused;
    el.playButton.textContent = playing ? "Ⅱ" : "▶";
    el.playButton.setAttribute("aria-label", playing ? "暂停" : "播放");
    el.playButton.title = playing ? "暂停" : "播放";
    el.currentTime.textContent = formatTime(el.audio.currentTime || 0);
    el.duration.textContent = formatTime(Number.isFinite(el.audio.duration) ? el.audio.duration : (track ? track.durationSeconds : 0));
    const actualDuration = Number.isFinite(el.audio.duration) && el.audio.duration > 0 ? el.audio.duration : 0;
    el.progress.value = actualDuration ? String(Math.round((el.audio.currentTime / actualDuration) * 1000)) : "0";
    el.progress.disabled = !track || actualDuration <= 0;
    el.volume.value = String(state.volume);
    el.shuffleButton.classList.toggle("is-active", state.shuffle);
    el.repeatButton.classList.toggle("is-active", state.repeat !== "off");
    el.repeatButton.textContent = state.repeat === "one" ? "↻¹" : "↻";
    el.repeatButton.title = state.repeat === "off" ? "循环关闭" : state.repeat === "one" ? "单曲循环" : "列表循环";
    el.shuffleButton.title = state.shuffle ? "关闭随机播放" : "随机播放";
    el.miniCover.classList.toggle("is-spinning", playing);
    el.heroVinyl.classList.toggle("is-spinning", playing);
    el.nowLike.classList.toggle("is-liked", !!track && state.favorites.includes(track.id));
    el.nowLike.textContent = track && state.favorites.includes(track.id) ? "♥" : "♡";
    el.nowLike.disabled = !track;

    if (!track) {
      el.nowTitle.textContent = "选择一首歌曲";
      el.nowArtist.textContent = "荣景音乐";
      el.miniCover.style.setProperty("--cover-color", "#9b493e");
      el.heroVinyl.style.setProperty("--cover-color", "#9b493e");
      el.heroTrackIndex.textContent = "— / —";
      return;
    }

    el.nowTitle.textContent = track.title;
    el.nowArtist.textContent = track.artist || "荣景音乐";
    el.miniCover.style.setProperty("--cover-color", track.color || "#9b493e");
    el.heroVinyl.style.setProperty("--cover-color", track.color || "#9b493e");
    const queue = state.queue.length ? state.queue : allTracks();
    const index = queue.findIndex((item) => item.id === track.id);
    el.heroTrackIndex.textContent = String(Math.max(0, index) + 1).padStart(2, "0") + " / " + String(queue.length).padStart(2, "0");

    updateMediaSession(track);
  }

  function updateMediaSession(track) {
    if (!track) {
      lastMediaSessionTrackId = null;
      return;
    }
    if (lastMediaSessionTrackId === track.id) return;
    lastMediaSessionTrackId = track.id;
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist || "荣景音乐",
          album: track.album || "荣景音乐"
        });
        navigator.mediaSession.setActionHandler("play", () => {
          if (el.audio.paused) void togglePlayback();
        });
        navigator.mediaSession.setActionHandler("pause", () => {
          if (!el.audio.paused) el.audio.pause();
        });
        navigator.mediaSession.setActionHandler("previoustrack", () => void playPrevious());
        navigator.mediaSession.setActionHandler("nexttrack", () => void playNext());
      } catch (_) {
        // Media Session is an enhancement; playback must work without it.
      }
    }
  }

  function recordRecent(trackId) {
    state.recent = [trackId].concat(state.recent.filter((id) => id !== trackId)).slice(0, 30);
    localStorage.setItem(STORAGE.recent, JSON.stringify(state.recent));
  }

  function toggleFavorite(trackId) {
    if (!trackId) return;
    if (state.favorites.includes(trackId)) {
      state.favorites = state.favorites.filter((id) => id !== trackId);
      toast("已从喜欢的歌曲中移除");
    } else {
      state.favorites = [trackId].concat(state.favorites);
      toast("已加入我喜欢的");
    }
    localStorage.setItem(STORAGE.favorites, JSON.stringify(state.favorites));
    renderLibrary();
  }

  async function playTrack(trackId, sourceList, forceRestart) {
    const track = getTrack(trackId);
    if (!track) {
      toast("没有找到这首歌曲");
      return;
    }

    if (sourceList && sourceList.length) {
      state.queue = sourceList.slice();
    } else if (!state.queue.some((item) => item.id === trackId)) {
      state.queue = allTracks();
    }
    state.queueIndex = state.queue.findIndex((item) => item.id === trackId);

    if (state.currentTrackId === trackId && !forceRestart) {
      await togglePlayback();
      return;
    }

    state.currentTrackId = trackId;
    state.isPlaying = false;
    el.audio.pause();
    el.audio.src = track.src;
    el.audio.load();
    renderLibrary();

    try {
      await el.audio.play();
      state.isPlaying = true;
      recordRecent(trackId);
      renderLibrary();
    } catch (error) {
      state.isPlaying = false;
      renderLibrary();
      console.warn("Playback could not start.", error);
      toast("暂时无法播放这首歌曲。请检查音源地址，或尝试导入本地文件。");
    }
  }

  async function togglePlayback() {
    if (!state.currentTrackId) {
      const tracks = tracksForView();
      if (tracks.length) await playTrack(tracks[0].id, tracks);
      else if (allTracks().length) await playTrack(allTracks()[0].id, allTracks());
      else toast("曲库还没有歌曲，请先导入音乐。");
      return;
    }

    if (el.audio.paused) {
      try {
        await el.audio.play();
        state.isPlaying = true;
        recordRecent(state.currentTrackId);
      } catch (error) {
        state.isPlaying = false;
        console.warn("Playback could not start.", error);
        toast("暂时无法播放。请检查音源地址，或尝试导入本地文件。");
      }
    } else {
      el.audio.pause();
      state.isPlaying = false;
    }
    renderLibrary();
  }

  async function playNext() {
    const tracks = state.queue.length ? state.queue : allTracks();
    if (tracks.length === 0) {
      toast("曲库还没有歌曲");
      return;
    }
    let index = tracks.findIndex((track) => track.id === state.currentTrackId);
    if (state.shuffle && tracks.length > 1) {
      let nextIndex = index;
      while (nextIndex === index) nextIndex = Math.floor(Math.random() * tracks.length);
      index = nextIndex;
    } else {
      index += 1;
      if (index >= tracks.length) {
        if (state.repeat === "all") index = 0;
        else {
          el.audio.pause();
          el.audio.currentTime = 0;
          state.isPlaying = false;
          updatePlayer();
          return;
        }
      }
    }
    await playTrack(tracks[index].id, tracks, true);
  }

  async function playPrevious() {
    if (el.audio.currentTime > 3) {
      el.audio.currentTime = 0;
      updatePlayer();
      return;
    }
    const tracks = state.queue.length ? state.queue : allTracks();
    if (tracks.length === 0) return;
    let index = tracks.findIndex((track) => track.id === state.currentTrackId) - 1;
    if (index < 0) index = state.repeat === "all" ? tracks.length - 1 : 0;
    await playTrack(tracks[index].id, tracks, true);
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) =>
      file.type.startsWith("audio/") || /\.(mp3|wav|flac|m4a|ogg|aac|opus|aiff?)$/i.test(file.name)
    );
    if (files.length === 0) {
      toast("没有选择可识别的音频文件");
      return;
    }

    let imported = 0;
    for (const file of files) {
      const id = makeId();
      const title = file.name.replace(/\.[^.]+$/, "");
      const color = palette[(state.localTracks.length + imported) % palette.length];
      const record = {
        id,
        title,
        artist: "本地音乐",
        album: "本地导入",
        tag: "本地导入",
        durationSeconds: 0,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        color,
        createdAt: Date.now() + imported,
        blob: file
      };
      const track = {
        ...record,
        src: URL.createObjectURL(file),
        isLocal: true
      };
      state.localTracks.unshift(track);
      try {
        await writeLocalRecord(record);
      } catch (error) {
        state.databaseAvailable = false;
        console.warn("Could not persist imported audio.", error);
      }
      imported += 1;
    }

    state.queue = allTracks();
    state.filter = "local";
    state.view = "library";
    $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "library"));
    $$(".filter-chip").forEach((button) => button.classList.toggle("is-selected", button.dataset.filter === "local"));
    el.pageHeading.textContent = "全部曲库";
    el.sectionTitle.textContent = "全部曲库";
    el.sectionEyebrow.textContent = "YOUR MUSIC";
    el.hero.hidden = true;
    el.search.value = "";
    state.query = "";
    renderLibrary();
    if (state.databaseAvailable) {
      toast("已导入 " + imported + " 首音乐");
    } else {
      toast("已加入当前曲库，但浏览器无法持久保存；刷新前请先备份原文件。");
    }
  }

  async function removeLocalTrack(trackId) {
    const track = state.localTracks.find((item) => item.id === trackId);
    if (!track) return;
    if (!window.confirm("从本地曲库移除“" + track.title + "”？")) return;
    if (state.currentTrackId === trackId) {
      el.audio.pause();
      el.audio.removeAttribute("src");
      el.audio.load();
      state.currentTrackId = null;
      state.isPlaying = false;
    }
    state.localTracks = state.localTracks.filter((item) => item.id !== trackId);
    state.favorites = state.favorites.filter((id) => id !== trackId);
    state.recent = state.recent.filter((id) => id !== trackId);
    state.queue = state.queue.filter((item) => item.id !== trackId);
    localStorage.setItem(STORAGE.favorites, JSON.stringify(state.favorites));
    localStorage.setItem(STORAGE.recent, JSON.stringify(state.recent));
    try {
      await deleteLocalRecord(trackId);
    } catch (error) {
      console.warn("Could not remove local music record.", error);
    }
    URL.revokeObjectURL(track.src);
    renderLibrary();
    toast("已从本地曲库移除");
  }

  function handleTrackListClick(event) {
    const actionButton = event.target.closest("button[data-action]");
    if (actionButton) {
      const trackId = actionButton.dataset.trackId || actionButton.closest("[data-track-id]")?.dataset.trackId;
      if (actionButton.dataset.action === "favorite") toggleFavorite(trackId);
      if (actionButton.dataset.action === "play") {
        const track = getTrack(trackId);
        if (track) void playTrack(trackId, state.visibleTracks.length ? state.visibleTracks : allTracks());
      }
      if (actionButton.dataset.action === "delete") void removeLocalTrack(trackId);
      return;
    }
    const row = event.target.closest("[data-track-id]");
    if (row) void playTrack(row.dataset.trackId, state.visibleTracks.length ? state.visibleTracks : allTracks());
  }

  function setupEvents() {
    $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    $$(".filter-chip").forEach((button) => button.addEventListener("click", () => setFilter(button.dataset.filter)));
    $("#view-all").addEventListener("click", () => setView("library"));
    $("#hero-play").addEventListener("click", () => {
      const tracks = tracksForView();
      if (state.currentTrackId && state.isPlaying) void togglePlayback();
      else if (tracks.length) void playTrack(tracks[0].id, tracks);
      else toast("曲库还没有可播放的作品");
    });

    [$("#import-button"), $("#import-sidebar"), $("#card-import"), $("#empty-import")].forEach((button) => {
      button.addEventListener("click", () => el.fileInput.click());
    });
    el.fileInput.addEventListener("change", (event) => {
      void importFiles(event.target.files);
      el.fileInput.value = "";
    });

    el.search.addEventListener("input", () => {
      state.query = el.search.value.trim();
      renderLibrary();
    });

    el.trackList.addEventListener("click", handleTrackListClick);
    el.queueList.addEventListener("click", (event) => {
      const item = event.target.closest("[data-track-id]");
      if (item) void playTrack(item.dataset.trackId, state.queue.length ? state.queue : allTracks());
    });

    $("#play-button").addEventListener("click", () => void togglePlayback());
    $("#next-button").addEventListener("click", () => void playNext());
    $("#previous-button").addEventListener("click", () => void playPrevious());
    el.nowLike.addEventListener("click", () => toggleFavorite(state.currentTrackId));

    el.shuffleButton.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      localStorage.setItem(STORAGE.shuffle, String(state.shuffle));
      updatePlayer();
      toast(state.shuffle ? "随机播放已开启" : "随机播放已关闭");
    });
    el.repeatButton.addEventListener("click", () => {
      state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
      localStorage.setItem(STORAGE.repeat, state.repeat);
      updatePlayer();
      toast(state.repeat === "off" ? "循环已关闭" : state.repeat === "all" ? "列表循环已开启" : "单曲循环已开启");
    });

    el.progress.addEventListener("input", () => {
      const duration = Number.isFinite(el.audio.duration) ? el.audio.duration : 0;
      el.currentTime.textContent = formatTime(duration * (Number(el.progress.value) / 1000));
    });
    el.progress.addEventListener("change", () => {
      const duration = Number.isFinite(el.audio.duration) ? el.audio.duration : 0;
      if (duration > 0) el.audio.currentTime = duration * (Number(el.progress.value) / 1000);
    });
    el.volume.addEventListener("input", () => {
      state.volume = Number(el.volume.value);
      el.audio.volume = state.volume;
      localStorage.setItem(STORAGE.volume, String(state.volume));
    });
    $("#queue-toggle").addEventListener("click", () => {
      $(".queue-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    el.audio.addEventListener("play", () => {
      state.isPlaying = true;
      updatePlayer();
      renderTrackList(state.visibleTracks);
      renderQueue();
    });
    el.audio.addEventListener("pause", () => {
      state.isPlaying = false;
      updatePlayer();
      renderTrackList(state.visibleTracks);
      renderQueue();
    });
    el.audio.addEventListener("timeupdate", updatePlayer);
    el.audio.addEventListener("loadedmetadata", () => {
      const track = getTrack(state.currentTrackId);
      if (track && Number.isFinite(el.audio.duration) && el.audio.duration > 0) {
        track.durationSeconds = el.audio.duration;
        if (track.isLocal) {
          void writeLocalRecord({
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            tag: track.tag,
            durationSeconds: track.durationSeconds,
            fileName: track.fileName,
            mimeType: track.mimeType,
            color: track.color,
            createdAt: track.createdAt,
            blob: track.blob
          }).catch(() => {});
        }
      }
      updatePlayer();
      renderTrackList(state.visibleTracks);
      renderQueue();
    });
    el.audio.addEventListener("ended", () => {
      if (state.repeat === "one") {
        el.audio.currentTime = 0;
        void el.audio.play().catch(() => {
          state.isPlaying = false;
          updatePlayer();
        });
      } else {
        void playNext();
      }
    });
    el.audio.addEventListener("error", () => {
      if (state.currentTrackId) {
        state.isPlaying = false;
        updatePlayer();
      }
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (
        target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName)
      );
      if (typing) {
        if (event.key === "Escape" && target === el.search) {
          el.search.value = "";
          state.query = "";
          renderLibrary();
          el.search.blur();
        }
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        el.search.focus();
      } else if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
      } else if (event.key === "ArrowRight" && state.currentTrackId) {
        el.audio.currentTime = Math.min(el.audio.duration || 0, el.audio.currentTime + 5);
      } else if (event.key === "ArrowLeft" && state.currentTrackId) {
        el.audio.currentTime = Math.max(0, el.audio.currentTime - 5);
      }
    });
  }

  async function init() {
    el.audio.volume = state.volume;
    el.volume.value = String(state.volume);
    setupEvents();
    await loadCatalog();
    await loadLocalLibrary();
    state.queue = allTracks();
    renderLibrary();
    if (!state.databaseAvailable) {
      console.info("Local audio imports will work for this session, but persistent browser storage is unavailable.");
    }
  }

  void init();
})();
