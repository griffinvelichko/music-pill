// Public types. Type-only; safe to import anywhere.

import type {
  MusicPillAutoplay,
  MusicPillPosition,
  MusicPillSize,
  MusicPillSoundControl,
  MusicPillTheme,
} from './parse.js';

export type {
  MusicPillAutoplay,
  MusicPillPosition,
  MusicPillSize,
  MusicPillSoundControl,
  MusicPillTheme,
};

/**
 * Read-only playback state exposed as `element.playbackState`.
 *
 * - `none`     no `audio-src`: link-only pill, no audio work is done.
 * - `idle`     audio configured but not started (autoplay off, another
 *              instance holds the page's audio, or waiting to start).
 * - `starting` a start attempt is in flight. Not yet audible.
 * - `playing`  the media element is playing *and* the audio path is running.
 * - `blocked`  the browser refused to start audio without a user gesture.
 * - `muted`    the visitor turned website sound off. Wins over everything.
 * - `paused`   stopped because the page was hidden or another instance took over.
 * - `error`    the audio could not be loaded or faded; the link still works.
 */
export type PlaybackState =
  | 'none'
  | 'idle'
  | 'starting'
  | 'playing'
  | 'blocked'
  | 'muted'
  | 'paused'
  | 'error';

export type StateChangeReason =
  | 'configured'
  | 'autoplay-attempt'
  | 'user-gesture'
  | 'started'
  | 'autoplay-blocked'
  | 'user-muted'
  | 'session-muted'
  | 'page-hidden'
  | 'page-visible'
  | 'other-instance'
  | 'interrupted'
  | 'another-instance-owns-audio'
  | 'source-changed'
  | 'restart'
  | 'error';

export type MusicPillErrorCode =
  /** spotify-url is missing or not an open.spotify.com track. Nothing renders. */
  | 'invalid-spotify-url'
  /** audio-src failed to load (404, network, unsupported codec, or CORS). */
  | 'audio-load-failed'
  /** audio-src was rejected by URL validation. */
  | 'invalid-audio-src'
  /** The browser lacks Web Audio, so the fade/loop path cannot run. */
  | 'fade-unavailable'
  /** The loop could not restart after the track ended. */
  | 'restart-failed';

export type MusicPillReadyDetail = {
  /** Canonical Spotify track URL that the pill links to. */
  spotifyUrl: string;
  /** Whether audio-src is configured. Says nothing about playback success. */
  hasAudio: boolean;
};

export type MusicPillStateChangeDetail = {
  state: PlaybackState;
  previousState: PlaybackState;
  reason: StateChangeReason;
};

export type MusicPillAutoplayBlockedDetail = {
  /**
   * `play-rejected`: HTMLMediaElement.play() rejected (NotAllowedError).
   * `context-suspended`: media started but the AudioContext stayed suspended,
   * so nothing would have been audible.
   */
  reason: 'play-rejected' | 'context-suspended';
};

export type MusicPillErrorDetail = {
  code: MusicPillErrorCode;
  /** Human-readable, generic message. Never includes raw browser error text. */
  message: string;
};

export type MusicPillEventMap = {
  'music-pill-ready': CustomEvent<MusicPillReadyDetail>;
  'music-pill-statechange': CustomEvent<MusicPillStateChangeDetail>;
  'music-pill-autoplay-blocked': CustomEvent<MusicPillAutoplayBlockedDetail>;
  'music-pill-error': CustomEvent<MusicPillErrorDetail>;
};

/** Attribute names accepted by `<music-pill>`. All values are strings. */
export type MusicPillAttributes = {
  'spotify-url': string;
  'song-title'?: string;
  artist?: string;
  artwork?: string;
  'audio-src'?: string;
  position?: MusicPillPosition;
  size?: MusicPillSize;
  theme?: MusicPillTheme;
  autoplay?: MusicPillAutoplay;
  volume?: string | number;
  'fade-duration'?: string | number;
  'sound-control'?: MusicPillSoundControl;
};

/** The element instance interface (`document.querySelector('music-pill')`). */
export interface MusicPillElement extends HTMLElement {
  /** Current playback state. Read-only. */
  readonly playbackState: PlaybackState;
  /**
   * Turns website sound on. Call this only from a genuine user gesture (a
   * click/keypress handler) so the browser allows audio. Resolves `true` once
   * audio is confirmed audible, `false` otherwise. Clears a session mute.
   */
  enableSound(): Promise<boolean>;
  /** Turns website sound off promptly and remembers that for the session. */
  mute(): void;

  addEventListener<K extends keyof MusicPillEventMap>(
    type: K,
    listener: (this: MusicPillElement, ev: MusicPillEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MusicPillEventMap>(
    type: K,
    listener: (this: MusicPillElement, ev: MusicPillEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

export type MusicPillElementConstructor = {
  new (): MusicPillElement;
  readonly observedAttributes: readonly string[];
};
