// Optional metadata helper for local/build-time use (Node 20+ or a browser).
// Title and artwork come from documented oEmbed fields (`title`, `thumbnail_url`).
// oEmbed has no artist field. The artist is read from the public track page's
// `music:musician_description` meta tag (several artists stay as Spotify writes
// them, usually comma-separated). The page title is a fallback. The returned
// iframe `html` is ignored. No audio, preview, or embed URL is read or returned.

import { normalizeSpotifyTrackUrl } from './parse.js';

export const SPOTIFY_OEMBED_ENDPOINT = 'https://open.spotify.com/oembed';

/** Shown when the artist meta tag is missing and the title fallback does not match. */
export const ARTIST_UNAVAILABLE_NOTE =
  'Artist could not be read from the public Spotify track page. Fill it in. Browsers cannot read that page (CORS); run music-pill-resolve in Node 20 or newer.';

export type SpotifyTrackMetadata = {
  /** Canonical https://open.spotify.com/track/… URL. */
  spotifyUrl: string;
  /** oEmbed `title`, if provided. For tracks this is normally the track name. */
  title: string | null;
  /**
   * Artist name from the public track page, or null when that page could not
   * be read. Not an oEmbed field.
   */
  artist: string | null;
  /** oEmbed `thumbnail_url` (Spotify-provided artwork), if provided and HTTPS. */
  artworkUrl: string | null;
  artworkWidth: number | null;
  artworkHeight: number | null;
  /** `ok` when oEmbed answered; `unavailable` on network/HTTP/CORS/parse failure. */
  status: 'ok' | 'unavailable';
};

/** @deprecated Use `SpotifyTrackMetadata`. Kept so existing imports stay valid. */
export type SpotifyOEmbedMetadata = SpotifyTrackMetadata;

export type ResolveOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

const TITLE_ARTIST =
  / - (?:song and lyrics|song, lyrics, and music video) by (.+) \| Spotify\s*$/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (NAMED_ENTITIES[lower]) return NAMED_ENTITIES[lower];
    const hex = lower.startsWith('#x');
    const decimal = lower.startsWith('#') && !hex;
    if (!hex && !decimal) return entity;
    const codePoint = Number.parseInt(lower.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff) return entity;
    return String.fromCodePoint(codePoint);
  });
}

function tagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s=/<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(re)) {
    const name = match[1]?.toLowerCase();
    if (!name || name === 'meta') continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    if (!attrs.has(name)) attrs.set(name, decodeHtml(raw));
  }
  return attrs;
}

function plainText(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || /^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  return text;
}

/**
 * Reads an artist name from a public Spotify track page.
 * Prefers every `music:musician_description` value, in order, joined with
 * ", ". Otherwise uses the English document title ("… by Artist | Spotify").
 * Returns null when neither is present. Ignores every other tag, including
 * any media URL.
 */
export function parseTrackPageArtist(html: string): string | null {
  const names: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = tagAttributes(tag);
    if (attrs.get('name')?.toLowerCase() !== 'music:musician_description') continue;
    const content = plainText(attrs.get('content') ?? null);
    if (content) names.push(content);
  }
  if (names.length > 0) return names.join(', ');

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const fromTitle = plainText(title ? decodeHtml(title) : null);
  const match = fromTitle ? TITLE_ARTIST.exec(fromTitle) : null;
  return plainText(match?.[1] ?? null);
}

type Fetched = {
  ok?: boolean;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  headers?: { get?: (name: string) => string | null };
};

function isHtmlResponse(res: Fetched): boolean {
  const type = res.headers?.get?.('content-type');
  if (!type) return true;
  return /text\/html|application\/xhtml\+xml/i.test(type);
}

async function readOEmbed(
  doFetch: typeof fetch,
  spotifyUrl: string,
  signal: AbortSignal | undefined,
): Promise<Pick<SpotifyTrackMetadata, 'title' | 'artworkUrl' | 'artworkWidth' | 'artworkHeight' | 'status'>> {
  const failed = {
    title: null,
    artworkUrl: null,
    artworkWidth: null,
    artworkHeight: null,
    status: 'unavailable' as const,
  };
  let body: unknown;
  try {
    const init: RequestInit = { headers: { accept: 'application/json' } };
    if (signal) init.signal = signal;
    const res = (await doFetch(`${SPOTIFY_OEMBED_ENDPOINT}?url=${encodeURIComponent(spotifyUrl)}`, init)) as Fetched;
    if (!res?.ok || typeof res.json !== 'function') return failed;
    body = await res.json();
  } catch {
    return failed;
  }
  if (!body || typeof body !== 'object') return failed;
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
    title,
    artworkUrl,
    artworkWidth: artworkUrl ? dim(data.thumbnail_width) : null,
    artworkHeight: artworkUrl ? dim(data.thumbnail_height) : null,
    status: 'ok',
  };
}

async function readArtist(
  doFetch: typeof fetch,
  spotifyUrl: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    const init: RequestInit = { headers: { accept: 'text/html', 'accept-language': 'en' } };
    if (signal) init.signal = signal;
    // The canonical track URL only. Nothing discovered in the HTML is requested.
    const res = (await doFetch(spotifyUrl, init)) as Fetched;
    if (!res?.ok || typeof res.text !== 'function' || !isHtmlResponse(res)) return null;
    return parseTrackPageArtist(await res.text());
  } catch {
    return null;
  }
}

/**
 * Looks up title, artwork, and artist for a Spotify track.
 * Title and artwork come from oEmbed. The artist comes from the public track
 * page, which browsers cannot fetch because Spotify does not send
 * Access-Control-Allow-Origin there; in a browser `artist` stays null.
 * Failure is a normal outcome: the promise resolves with
 * `status: 'unavailable'` and null title/artwork rather than throwing.
 * A missing artist does not fail the lookup. Throws a TypeError only for an
 * invalid track URL.
 */
export async function resolveSpotifyMetadata(
  trackUrl: string,
  options: ResolveOptions = {},
): Promise<SpotifyTrackMetadata> {
  const spotifyUrl = normalizeSpotifyTrackUrl(trackUrl);
  if (!spotifyUrl) throw new TypeError('Expected an https://open.spotify.com/track/… URL or spotify:track:… URI.');
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return {
      spotifyUrl,
      title: null,
      artist: null,
      artworkUrl: null,
      artworkWidth: null,
      artworkHeight: null,
      status: 'unavailable',
    };
  }
  const [oembed, artist] = await Promise.all([
    readOEmbed(doFetch, spotifyUrl, options.signal),
    readArtist(doFetch, spotifyUrl, options.signal),
  ]);
  return { spotifyUrl, artist, ...oembed };
}

/** Escapes a value for a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type SnippetOptions = {
  /** When set, replaces the artist the resolver read. */
  artist?: string;
};

/** Formats resolved metadata as a copy/paste `<music-pill>` tag. */
export function toMusicPillSnippet(meta: SpotifyTrackMetadata, options: SnippetOptions = {}): string {
  const artist = options.artist !== undefined ? options.artist : (meta.artist ?? '');
  const lines = [`  spotify-url="${escapeAttribute(meta.spotifyUrl)}"`];
  if (meta.title) lines.push(`  song-title="${escapeAttribute(meta.title)}"`);
  lines.push(`  artist="${escapeAttribute(artist)}"`);
  if (meta.artworkUrl) lines.push(`  artwork="${escapeAttribute(meta.artworkUrl)}"`);
  const notes = [
    artist ? null : ARTIST_UNAVAILABLE_NOTE,
    meta.status === 'unavailable' ? 'Metadata lookup failed; add song-title and artwork yourself.' : null,
    meta.artworkUrl ? 'artwork is Spotify-provided: keep the built-in Spotify attribution and link.' : null,
  ].filter(Boolean);
  const comment = notes.length ? `<!-- ${notes.join(' ')} -->\n` : '';
  return `${comment}<music-pill\n${lines.join('\n')}\n></music-pill>`;
}
