import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARTIST_UNAVAILABLE_NOTE,
  SPOTIFY_OEMBED_ENDPOINT,
  parseTrackPageArtist,
  resolveSpotifyMetadata,
  toMusicPillSnippet,
  type SpotifyTrackMetadata,
} from '../../src/resolve';

const URL_ = 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8';
const STROBE_URL = 'https://open.spotify.com/track/5GjUhwxykUVYCYkiNo4BEM';
const strobeHtml = readFileSync(new URL('../fixtures/resolve/strobe-track.html', import.meta.url), 'utf8');
const peachesHtml = readFileSync(new URL('../fixtures/resolve/peaches-track.html', import.meta.url), 'utf8');

const fakeFetch = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

const strobeOEmbed = {
  title: 'Strobe',
  thumbnail_url: 'https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e0288187e12b8a3a1063eb0dd80',
  thumbnail_width: 300,
  thumbnail_height: 300,
  html: '<iframe src="https://open.spotify.com/embed/track/5GjUhwxykUVYCYkiNo4BEM"></iframe>',
  author_name: 'Spotify',
};

type MockResult = { ok: boolean; json?: unknown; text?: string; contentType?: string };

function mockFetch(handler: (url: string) => MockResult | 'throw') {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const result = handler(url);
    if (result === 'throw') throw new TypeError('Failed to fetch');
    return {
      ok: result.ok,
      json: async () => result.json,
      ...(result.text !== undefined ? { text: async () => result.text } : {}),
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (result.contentType ?? null) : null) },
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('parseTrackPageArtist', () => {
  it('reads music:musician_description and ignores media tags', () => {
    expect(parseTrackPageArtist(strobeHtml)).toBe('deadmau5');
    expect(parseTrackPageArtist(strobeHtml)).not.toContain('example.invalid');
  });

  it('keeps several artists as one comma-separated value', () => {
    expect(parseTrackPageArtist(peachesHtml)).toBe('Justin Bieber, Daniel Caesar, GIVĒON');
  });

  it('joins repeated musician_description tags in order', () => {
    const html = `
      <meta name="music:musician_description" content="The Kid LAROI">
      <meta name="music:musician_description" content="Justin Bieber">
    `;
    expect(parseTrackPageArtist(html)).toBe('The Kid LAROI, Justin Bieber');
  });

  it('falls back to the English document title and decodes entities', () => {
    const html = peachesHtml.replace(/<meta name="music:musician_description"[^>]*>/i, '');
    expect(parseTrackPageArtist(html)).toBe('Justin Bieber, Daniel Caesar, GIVĒON');
    const video = '<title>Song - Song, Lyrics, and Music Video by Shawn Mendes, Camila Cabello | Spotify</title>';
    expect(parseTrackPageArtist(video)).toBe('Shawn Mendes, Camila Cabello');
  });

  it('rejects scheme-like values and missing markup', () => {
    const html = `
      <meta name="music:musician_description" content="https://open.spotify.com/artist/abc"/>
      <title>Song - song and lyrics by https://evil.example/a | Spotify</title>
    `;
    expect(parseTrackPageArtist(html)).toBeNull();
    expect(parseTrackPageArtist('<title>Strobe | Spotify</title>')).toBeNull();
  });
});

describe('resolveSpotifyMetadata', () => {
  it('uses only documented oEmbed fields and ignores html', async () => {
    const meta = await resolveSpotifyMetadata(URL_, {
      fetch: fakeFetch({
        title: 'Song',
        thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/x',
        thumbnail_width: 300,
        thumbnail_height: 300,
        html: '<iframe src="evil"></iframe>',
        author_name: 'Not the artist',
      }),
    });
    expect(meta).toEqual({
      spotifyUrl: URL_,
      title: 'Song',
      artist: null,
      artworkUrl: 'https://image-cdn-ak.spotifycdn.com/image/x',
      artworkWidth: 300,
      artworkHeight: 300,
      status: 'ok',
    });
    expect(JSON.stringify(meta)).not.toContain('iframe');
    expect(JSON.stringify(meta)).not.toContain('Not the artist');
  });

  it('reads the artist from the track page and title/artwork from oEmbed', async () => {
    const { fetchImpl, calls } = mockFetch((url) => {
      if (url.startsWith(SPOTIFY_OEMBED_ENDPOINT)) return { ok: true, json: strobeOEmbed };
      if (url === STROBE_URL) return { ok: true, text: strobeHtml, contentType: 'text/html; charset=utf-8' };
      return { ok: false };
    });
    const meta = await resolveSpotifyMetadata(STROBE_URL, { fetch: fetchImpl });
    expect(meta).toEqual({
      spotifyUrl: STROBE_URL,
      title: 'Strobe',
      artist: 'deadmau5',
      artworkUrl: strobeOEmbed.thumbnail_url,
      artworkWidth: 300,
      artworkHeight: 300,
      status: 'ok',
    });
    expect(calls).toHaveLength(2);
    expect(calls).toContain(`${SPOTIFY_OEMBED_ENDPOINT}?url=${encodeURIComponent(STROBE_URL)}`);
    expect(calls).toContain(STROBE_URL);
    expect(JSON.stringify(meta)).not.toContain('example.invalid');
    expect(JSON.stringify(meta)).not.toContain('iframe');
    expect(JSON.stringify(meta)).not.toContain('Spotify');
  });

  it('keeps a resolved artist when oEmbed fails', async () => {
    const { fetchImpl } = mockFetch((url) => {
      if (url.startsWith(SPOTIFY_OEMBED_ENDPOINT)) return { ok: false };
      if (url === STROBE_URL) return { ok: true, text: strobeHtml };
      return { ok: false };
    });
    const meta = await resolveSpotifyMetadata(STROBE_URL, { fetch: fetchImpl });
    expect(meta.status).toBe('unavailable');
    expect(meta.title).toBeNull();
    expect(meta.artworkUrl).toBeNull();
    expect(meta.artist).toBe('deadmau5');
  });

  it('does not fail the lookup when the track page cannot be read', async () => {
    const { fetchImpl } = mockFetch((url) => {
      if (url.startsWith(SPOTIFY_OEMBED_ENDPOINT)) return { ok: true, json: { title: 'Strobe', thumbnail_url: strobeOEmbed.thumbnail_url } };
      return 'throw';
    });
    const meta = await resolveSpotifyMetadata(STROBE_URL, { fetch: fetchImpl });
    expect(meta.status).toBe('ok');
    expect(meta.title).toBe('Strobe');
    expect(meta.artist).toBeNull();
  });

  it('ignores a non-HTML track response', async () => {
    const { fetchImpl } = mockFetch((url) => {
      if (url.startsWith(SPOTIFY_OEMBED_ENDPOINT)) return { ok: true, json: { title: 'Strobe' } };
      return { ok: true, text: 'not page markup', contentType: 'audio/mpeg' };
    });
    const meta = await resolveSpotifyMetadata(STROBE_URL, { fetch: fetchImpl });
    expect(meta.artist).toBeNull();
    expect(meta.status).toBe('ok');
    expect(JSON.stringify(meta)).not.toContain('not page markup');
  });

  it('treats network/HTTP/CORS failures as a normal fallback', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const failed = await resolveSpotifyMetadata(URL_, { fetch: failing });
    expect(failed.status).toBe('unavailable');
    expect(failed.artist).toBeNull();
    expect((await resolveSpotifyMetadata(URL_, { fetch: fakeFetch({}, false) })).status).toBe('unavailable');
  });

  it('rejects non-HTTPS thumbnails and invalid track URLs', async () => {
    const meta = await resolveSpotifyMetadata(URL_, { fetch: fakeFetch({ title: 'x', thumbnail_url: 'javascript:1' }) });
    expect(meta.artworkUrl).toBeNull();
    await expect(resolveSpotifyMetadata('https://example.com')).rejects.toThrow(TypeError);
  });
});

describe('toMusicPillSnippet', () => {
  const base: SpotifyTrackMetadata = {
    spotifyUrl: URL_,
    title: 'A "quoted" <title> & more',
    artist: null,
    artworkUrl: null,
    artworkWidth: null,
    artworkHeight: null,
    status: 'ok',
  };

  it('escapes attributes and notes a missing artist', () => {
    const snippet = toMusicPillSnippet(base);
    expect(snippet).toContain('song-title="A &quot;quoted&quot; &lt;title&gt; &amp; more"');
    expect(snippet).toContain('artist=""');
    expect(snippet).toContain(ARTIST_UNAVAILABLE_NOTE);
  });

  it('uses the resolved artist unless an option overrides it', () => {
    const snippet = toMusicPillSnippet({ ...base, artist: 'deadmau5', title: 'Strobe' });
    expect(snippet).toContain('artist="deadmau5"');
    expect(snippet).not.toContain(ARTIST_UNAVAILABLE_NOTE);
    expect(toMusicPillSnippet({ ...base, artist: 'deadmau5' }, { artist: 'Override' })).toContain('artist="Override"');
    const cleared = toMusicPillSnippet({ ...base, artist: 'deadmau5' }, { artist: '' });
    expect(cleared).toContain('artist=""');
    expect(cleared).toContain(ARTIST_UNAVAILABLE_NOTE);
  });
});

describe('sample track page', () => {
  it('is generated from resolver output and the template does not name the artist', () => {
    const template = readFileSync(new URL('../../examples/sample-track/index.template.html', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../../scripts/generate-sample-track.mjs', import.meta.url), 'utf8');
    const resolved = JSON.parse(readFileSync(new URL('../../examples/sample-track/resolved.json', import.meta.url), 'utf8')) as {
      spotifyUrl: string;
      title: string;
      artist: string;
      artworkUrl: string;
    };
    const html = readFileSync(new URL('../../examples/sample-track/index.html', import.meta.url), 'utf8');
    expect(template).not.toContain('deadmau5');
    expect(script).not.toContain('deadmau5');
    expect(html).toContain(`spotify-url="${resolved.spotifyUrl}"`);
    expect(html).toContain(`song-title="${resolved.title}"`);
    expect(html).toContain(`artist="${resolved.artist}"`);
    expect(html).toContain(`artwork="${resolved.artworkUrl}"`);
    expect(html).toContain('fixtures/audio/test-tone.wav');
  });
});
