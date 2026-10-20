# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-19

First public release on npm.

### Added

- `<music-pill>` custom element: a fixed-position link to a Spotify track
  with artwork, title and artist, in six positions, three sizes and
  auto/light/dark themes.
- Optional site-owner-hosted audio played through Web Audio, with fade-in,
  fade-out and restart looping. Autoplay is attempted once, at most one
  instance plays at a time, mute is remembered for the session, and playback
  pauses while the page is hidden.
- A separate, accessible sound on/off button, or `sound-control="host"` if
  you provide your own control.
- `enableSound()`, `mute()` and a read-only `playbackState`, plus typed
  `music-pill-ready`, `music-pill-statechange`, `music-pill-autoplay-blocked`
  and `music-pill-error` events.
- SSR-safe root entry (`registerMusicPill()`), a browser-only `auto` entry,
  opt-in React JSX types, and the `music-pill/resolve` helper with the
  `music-pill-resolve` CLI for oEmbed metadata.

- Multiple audio sources. `audio-src` still plays one file. Direct `<source>`
  children, an `audio-sources` JSON attribute, or the `audioSources` property
  can list MP3, M4A/AAC, OGG, and WAV. The first source the browser can play
  is used: an explicit MIME type, otherwise the extension, checked with
  `canPlayType`.
- Loading and error UI next to the sound button (never inside the Spotify
  link): **Loading audio**, and an alert when audio cannot be played, loaded,
  or decoded. New error codes: `no-playable-source`, `invalid-audio-sources`,
  `audio-decode-failed`, and `audio-unsupported`.
- When autoplay is blocked, the next click or key press on the page starts
  sound once. Scrolling does not. The status tells playing, muted, paused,
  and sound off apart, including for screen readers.
- `prefers-reduced-motion` removes UI transitions and stops the loading
  spinner. Audio fade-in and fade-out are unchanged.
- `examples/sources/` and a playground **Sources** tab, using the generated
  test tone, for one source, several sources, and the unplayable-type error.

### Changed

- Media failures now say whether the file could not be fetched, decoded, or
  played. `audio-load-failed` remains the network and generic code.
- The README now matches the shipped API: source precedence and the 12-source
  cap, every error code and what triggers it, playback states and status text,
  the first-gesture start, reduced motion, the resolver CLI, bundle size, and
  the limit that a decode or network failure does not try the next file.

[Unreleased]: https://github.com/griffinvelichko/music-pill/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/griffinvelichko/music-pill/releases/tag/v0.1.0
