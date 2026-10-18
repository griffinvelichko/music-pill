// Optional metadata helper for local/build-time use (Node 18+ or a browser).
// Uses only documented Spotify oEmbed fields: `title` and `thumbnail_url`
// (+ dimensions). oEmbed has no separate artist field and no audio URL, so the
// artist stays a value you type yourself, and audio is never resolved.
// The returned iframe `html` is ignored and never injected anywhere.

import { normalizeSpotifyTrackUrl } from './parse.js';

export const SPOTIFY_OEMBED_ENDPOINT = 'https://open.spotify.com/oembed';

export type SpotifyOEmbedMetadata = {
  /** Canonical https://open.spotify.com/track/… URL. */
  spotifyUrl: string;
  /** oEmbed `title`, if provided. For tracks this is normally the track name. */
  title: string | null;
  /** oEmbed `thumbnail_url` (Spotify-provided artwork), if provided and HTTPS. */
  artworkUrl: string | null;
  artworkWidth: number | null;
  artworkHeight: number | null;
  /** `ok` when oEmbed answered; `unavailable` on network/HTTP/CORS/parse failure. */
  status: 'ok' | 'unavailable';
};

export type ResolveOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

/**
 * Looks up oEmbed metadata for a Spotify track. Failure is a normal outcome:
 * it resolves with `status: 'unavailable'` and null fields rather than
 * throwing. Throws a TypeError only for an invalid track URL.
 */
export async function resolveSpotifyMetadata(
  trackUrl: string,
  options: ResolveOptions = {},
): Promise<SpotifyOEmbedMetadata> {
  const spotifyUrl = normalizeSpotifyTrackUrl(trackUrl);
  if (!spotifyUrl) throw new TypeError('Expected an https://open.spotify.com/track/… URL or spotify:track:… URI.');
  const empty: SpotifyOEmbedMetadata = {
    spotifyUrl,
    title: null,
    artworkUrl: null,
    artworkWidth: null,
    artworkHeight: null,
    status: 'unavailable',
  };
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return empty;

  let body: unknown;
  try {
    const init: RequestInit = { headers: { accept: 'application/json' } };
    if (options.signal) init.signal = options.signal;
    const res = await doFetch(`${SPOTIFY_OEMBED_ENDPOINT}?url=${encodeURIComponent(spotifyUrl)}`, init);
    if (!res.ok) return empty;
    body = await res.json();
  } catch {
    return empty;
  }
  if (!body || typeof body !== 'object') return empty;
  const data = body as Record<string, unknown>;
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
  let artworkUrl: string | null = null;
  if (typeof data.thumbnail_url === 'string') {
    try {
      const u = new URL(data.thumbnail_url);
      if (u.protocol === 'https:') artworkUrl = u.href;
    } catch {
      artworkUrl = null;
    }
  }
  const dim = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return {
    spotifyUrl,
    title,
    artworkUrl,
    artworkWidth: artworkUrl ? dim(data.thumbnail_width) : null,
    artworkHeight: artworkUrl ? dim(data.thumbnail_height) : null,
    status: 'ok',
  };
}

/** Escapes a value for a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type SnippetOptions = {
  /** Artist name you supply. oEmbed does not provide one. */
  artist?: string;
};

/** Formats resolved metadata as a copy/paste `<music-pill>` tag. */
export function toMusicPillSnippet(meta: SpotifyOEmbedMetadata, options: SnippetOptions = {}): string {
  const lines = [`  spotify-url="${escapeAttribute(meta.spotifyUrl)}"`];
  if (meta.title) lines.push(`  song-title="${escapeAttribute(meta.title)}"`);
  lines.push(`  artist="${escapeAttribute(options.artist ?? '')}"`);
  if (meta.artworkUrl) lines.push(`  artwork="${escapeAttribute(meta.artworkUrl)}"`);
  const notes = [
    options.artist ? null : 'Fill in artist yourself: Spotify oEmbed does not provide a separate artist field.',
    meta.status === 'unavailable' ? 'oEmbed was unavailable; add song-title and artwork yourself.' : null,
    meta.artworkUrl ? 'artwork is Spotify-provided: keep the built-in Spotify attribution and link.' : null,
  ].filter(Boolean);
  const comment = notes.length ? `<!-- ${notes.join(' ')} -->\n` : '';
  return `${comment}<music-pill\n${lines.join('\n')}\n></music-pill>`;
}
