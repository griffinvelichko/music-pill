// SSR-safe root entry. Importing this module evaluates no browser globals
// (HTMLElement, window, document, customElements). Call registerMusicPill()
// in the browser, or import "music-pill/auto" from browser-only code.

export { registerMusicPill, DEFAULT_TAG_NAME } from './register.js';
export {
  AUTOPLAY_MODES,
  DEFAULTS,
  MAX_FADE_SECONDS,
  POSITIONS,
  SIZES,
  SOUND_CONTROL_MODES,
  THEMES,
  normalizeSpotifyTrackUrl,
  parseFadeDuration,
  parseVolume,
} from './parse.js';
export { effectiveFade } from './fade.js';
export type * from './types.js';
