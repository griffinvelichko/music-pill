import { describe, expect, it } from 'vitest';
import { resolveSpotifyMetadata, toMusicPillSnippet } from '../../src/resolve';

const URL_ = 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8';
const fakeFetch = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('resolveSpotifyMetadata', () => {
  it('uses only documented fields and ignores html', async () => {
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
      artworkUrl: 'https://image-cdn-ak.spotifycdn.com/image/x',
      artworkWidth: 300,
      artworkHeight: 300,
      status: 'ok',
    });
    expect(JSON.stringify(meta)).not.toContain('iframe');
  });

  it('treats network/HTTP/CORS failures as a normal fallback', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect((await resolveSpotifyMetadata(URL_, { fetch: failing })).status).toBe('unavailable');
    expect((await resolveSpotifyMetadata(URL_, { fetch: fakeFetch({}, false) })).status).toBe('unavailable');
  });

  it('rejects non-HTTPS thumbnails and invalid track URLs', async () => {
    const meta = await resolveSpotifyMetadata(URL_, { fetch: fakeFetch({ title: 'x', thumbnail_url: 'javascript:1' }) });
    expect(meta.artworkUrl).toBeNull();
    await expect(resolveSpotifyMetadata('https://example.com')).rejects.toThrow(TypeError);
  });
});

describe('toMusicPillSnippet', () => {
  it('escapes attributes and leaves artist explicitly editable', () => {
    const snippet = toMusicPillSnippet({
      spotifyUrl: URL_,
      title: 'A "quoted" <title> & more',
      artworkUrl: null,
      artworkWidth: null,
      artworkHeight: null,
      status: 'ok',
    });
    expect(snippet).toContain('song-title="A &quot;quoted&quot; &lt;title&gt; &amp; more"');
    expect(snippet).toContain('artist=""');
    expect(snippet).toContain('Fill in artist yourself');
  });
});
