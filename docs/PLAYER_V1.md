# Rongjing Music Player V1 — Product Boundary and Acceptance Checklist

## Product role

Rongjing Music is the public music catalogue and listening surface for Rongjing Culture. Its first responsibility is to make the catalogue easy to browse and music reliable to play.

Sonviaf remains a separate music-workflow product for AI music management, stem separation, covers, and audio processing. Do not merge those workflows into this player.

## V1 architecture

- Static frontend: index.html, assets/player.css, assets/player.js.
- Public catalogue: data/catalog.json.
- Playback: native HTMLAudioElement.
- Local library: IndexedDB stores imported audio blobs; object URLs are created at runtime.
- Preferences: localStorage stores favorites, recent-play IDs, volume, shuffle and repeat mode.
- No backend, authentication, cloud upload, account sync, or external JavaScript playback dependency.

## Acceptance checklist for Codex

Run the appropriate checks and report actual outcomes. Do not mark a check as passed without evidence.

### Static and accessibility checks

- [ ] The site loads through an HTTP server without console errors.
- [ ] All referenced CSS, JavaScript, SVG and JSON resources return successfully.
- [ ] Catalogue JSON parses and every track has a unique ID, title and source URL.
- [ ] Search, navigation and filters work with empty, single-result and no-result states.
- [ ] Buttons are keyboard reachable and have accessible names.
- [ ] The layout remains usable at desktop, tablet and mobile viewport widths.
- [ ] Reduced-motion preference disables continuous vinyl animation.

### Playback checks

- [ ] Each public catalogue track has a reachable audio URL and can be played.
- [ ] Play/pause, previous/next, seek and volume work.
- [ ] Progress and duration update from the actual media element.
- [ ] Next-track behavior works at the beginning and end of the queue.
- [ ] Shuffle, list-repeat and single-track-repeat behavior match the selected state.
- [ ] Missing, blocked or unsupported audio produces a useful message rather than a broken interface.
- [ ] Audio URL behavior is checked for CORS, byte-range requests, and the production origin.
- [ ] Browser Media Session controls are optional and do not break playback if unavailable.

### Library and persistence checks

- [ ] Favorite state persists after reload.
- [ ] Recent-play order persists after reload.
- [ ] Importing multiple audio files adds them to the local library.
- [ ] Imported file blobs survive reload through IndexedDB where browser storage is available.
- [ ] Local files can be played, favorited and removed.
- [ ] Removing the currently playing local file stops playback and clears the active selection safely.
- [ ] Storage failure is handled without losing the ability to use the current session.
- [ ] The application never uploads local file contents to a server.

### Catalogue source audit

The five initial catalogue entries were adapted from the track list in the earlier Moodify web player at commit e24b29f57276999b378f46a478c1914f6198e685. Their audio URLs currently point to play.rongjingmusic.com/audio/cadeau10-album1/.

- [ ] Confirm that the production hostname is correct and each file still exists.
- [ ] Confirm response status, content type, CORS behavior and range support.
- [ ] If a source is unavailable, update data/catalog.json only after finding the canonical audio asset.
- [ ] Do not fabricate replacement audio URLs or silently mark missing tracks as playable.

## Known limitations

- Local music is stored per browser and device, not in a cloud account.
- Public catalogue entries are edited in JSON; there is no content-management interface yet.
- The repository does not contain audio binaries.
- Browser support for FLAC and other formats varies. File selection is not proof that the browser can decode a given file.
- The current implementation has not been run or tested as part of the authoring task. Codex owns verification and follow-up fixes.

## Next sensible milestone

After V1 is verified, choose one next task only:

1. Fix verified playback or library defects.
2. Add a small catalogue-management workflow.
3. Design a server-side catalogue API and publishing workflow.

Do not add accounts, social features, payments, recommendations, or cloud storage before the basic catalogue-to-playback loop is reliable.
