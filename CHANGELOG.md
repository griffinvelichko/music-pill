# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-17

First version. Not yet published to npm.

### Added

- `<music-pill>` custom element: a fixed-position link to a Spotify track
  with artwork, title and artist, in six positions, three sizes and
  auto/light/dark themes.
- Optional `audio-src` playback through Web Audio with fade-in, fade-out
  and restart looping. Autoplay is attempted once, at most one instance plays
  at a time, mute is remembered for the session, and playback pauses while the
  page is hidden.
- A separate, accessible sound on/off button, or `sound-control="host"` if
  you provide your own control.
- `enableSound()`, `mute()` and a read-only `playbackState`, plus typed
  `music-pill-ready`, `music-pill-statechange`, `music-pill-autoplay-blocked`
  and `music-pill-error` events.
- SSR-safe root entry (`registerMusicPill()`), a browser-only `auto` entry,
  opt-in React JSX types, and the `music-pill/resolve` helper with the
  `music-pill-resolve` CLI for oEmbed metadata.
