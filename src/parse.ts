// Pure parsing and sanitising helpers. Nothing in this module touches the DOM,
// `window`, or any other browser global, so it is safe to import during SSR.

export const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export const SIZES = ['sm', 'md', 'lg'] as const;
export const THEMES = ['auto', 'light', 'dark'] as const;
export const AUTOPLAY_MODES = ['attempt', 'off'] as const;
export const SOUND_CONTROL_MODES = ['built-in', 'host'] as const;

export type MusicPillPosition = (typeof POSITIONS)[number];
export type MusicPillSize = (typeof SIZES)[number];
export type MusicPillTheme = (typeof THEMES)[number];
export type MusicPillAutoplay = (typeof AUTOPLAY_MODES)[number];
export type MusicPillSoundControl = (typeof SOUND_CONTROL_MODES)[number];

export const DEFAULTS = {
  position: 'bottom-right',
  size: 'md',
  theme: 'auto',
  autoplay: 'attempt',
  soundControl: 'built-in',
  volume: 0.25,
  fadeDuration: 1.5,
} as const;

/** Upper bound on any configured fade, before it is further clamped to the track. */
export const MAX_FADE_SECONDS = 10;
/** Visible metadata is clipped to this many characters (the accessible name is too). */
export const MAX_TEXT_LENGTH = 200;

/**
 * Parses an enumerated string attribute. Matching is case-insensitive and
 * whitespace-tolerant; anything else (including `""`, which is what HTML
 * boolean-style usage produces) falls back to the default.
 */
export function parseEnum<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export const parsePosition = (v: string | null | undefined): MusicPillPosition =>
  parseEnum(v, POSITIONS, DEFAULTS.position);
export const parseSize = (v: string | null | undefined): MusicPillSize =>
  parseEnum(v, SIZES, DEFAULTS.size);
export const parseTheme = (v: string | null | undefined): MusicPillTheme =>
  parseEnum(v, THEMES, DEFAULTS.theme);
export const parseAutoplay = (v: string | null | undefined): MusicPillAutoplay =>
  parseEnum(v, AUTOPLAY_MODES, DEFAULTS.autoplay);
export const parseSoundControl = (v: string | null | undefined): MusicPillSoundControl =>
  parseEnum(v, SOUND_CONTROL_MODES, DEFAULTS.soundControl);

function parseFiniteNumber(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  // Number() rejects things like "0.5abc" that parseFloat would accept.
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/** Volume 0–1, default 0.25. Out-of-range values are clamped; junk falls back. */
export function parseVolume(value: string | null | undefined): number {
  const n = parseFiniteNumber(value);
  if (n === null) return DEFAULTS.volume;
  return Math.min(1, Math.max(0, n));
}

/** Fade duration in seconds, default 1.5, clamped to 0–MAX_FADE_SECONDS. */
export function parseFadeDuration(value: string | null | undefined): number {
  const n = parseFiniteNumber(value);
  if (n === null) return DEFAULTS.fadeDuration;
  return Math.min(MAX_FADE_SECONDS, Math.max(0, n));
}

// Spotify IDs are 22 base-62 characters.
const TRACK_ID = /^[0-9A-Za-z]{22}$/;
// Optional localisation prefix such as /intl-de/ that open.spotify.com adds.
const TRACK_PATH = /^\/(?:intl-[a-z]{2}(?:-[a-z0-9]+)?\/)?track\/([0-9A-Za-z]{22})\/?$/i;

/**
 * Validates a Spotify track reference and returns the canonical
 * `https://open.spotify.com/track/<id>` URL, or `null` if invalid.
 *
 * Accepts an HTTPS open.spotify.com track URL (query strings such as `?si=`
 * and `/intl-xx/` prefixes are dropped) or a `spotify:track:<id>` URI.
 * Albums, playlists, artists, other hosts and non-HTTPS URLs are rejected.
 *
 * This is a link destination only. It is never fetched or played.
 */
export function normalizeSpotifyTrackUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '' || raw.length > 2048) return null;

  const uri = /^spotify:track:([0-9A-Za-z]{22})$/.exec(raw);
  if (uri) return `https://open.spotify.com/track/${uri[1]}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
  if (url.username || url.password || url.port) return null;
  const match = TRACK_PATH.exec(url.pathname);
  if (!match || !match[1] || !TRACK_ID.test(match[1])) return null;
  return `https://open.spotify.com/track/${match[1]}`;
}

/** Extracts the track ID from a URL already returned by normalizeSpotifyTrackUrl. */
export function spotifyTrackId(normalizedUrl: string): string {
  return normalizedUrl.slice(normalizedUrl.lastIndexOf('/') + 1);
}

/**
 * Normalises untrusted metadata for display via `textContent`: strips control
 * and bidi-override characters, collapses whitespace, and limits length.
 * Returns `null` for empty values so callers can fall back cleanly.
 */
export function sanitizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // C0/C1 controls, plus bidi embedding/override/isolate characters that
    // could visually reorder the surrounding accessible name.
    .replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return null;
  if (cleaned.length <= MAX_TEXT_LENGTH) return cleaned;
  return `${Array.from(cleaned).slice(0, MAX_TEXT_LENGTH - 1).join('').trimEnd()}…`;
}

export type ResolvedResource = {
  /** Absolute URL. */
  href: string;
  /** True when the resource origin differs from the page origin. */
  crossOrigin: boolean;
};

/**
 * Resolves a developer-supplied resource URL (artwork or audio) against the
 * page base URL and enforces a protocol allowlist. `data:` URLs are accepted
 * only for the given media type prefix (e.g. `image/` or `audio/`).
 */
export function resolveResourceUrl(
  value: string | null | undefined,
  baseUrl: string,
  dataPrefix: 'image/' | 'audio/',
): ResolvedResource | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  let url: URL;
  let base: URL;
  try {
    base = new URL(baseUrl);
    url = new URL(raw, base);
  } catch {
    return null;
  }
  switch (url.protocol) {
    case 'https:':
    case 'http:':
    case 'blob:':
      break;
    case 'data:':
      if (!url.pathname.toLowerCase().startsWith(dataPrefix)) return null;
      break;
    default:
      return null;
  }
  if (url.username || url.password) return null;
  const crossOrigin =
    url.protocol === 'data:' || url.protocol === 'blob:' ? false : url.origin !== base.origin;
  return { href: url.href, crossOrigin };
}

/**
 * Hosts that serve Spotify-provided artwork. Artwork from these hosts follows
 * Spotify's artwork corner-radius rule instead of the pill's nested radius.
 */
export function isSpotifyArtworkHost(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return (
      host === 'i.scdn.co' ||
      host.endsWith('.scdn.co') ||
      host === 'spotifycdn.com' ||
      host.endsWith('.spotifycdn.com')
    );
  } catch {
    return false;
  }
}
