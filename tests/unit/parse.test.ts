import { describe, expect, it } from 'vitest';
import {
  isSpotifyArtworkHost,
  normalizeSpotifyTrackUrl,
  parseAutoplay,
  parseFadeDuration,
  parsePosition,
  parseSize,
  parseTheme,
  parseVolume,
  resolveResourceUrl,
  sanitizeText,
  MAX_TEXT_LENGTH,
} from '../../src/parse';

const ID = '4PTG3Z6ehGkBFwjybzWkR8';
const CANON = `https://open.spotify.com/track/${ID}`;

describe('normalizeSpotifyTrackUrl', () => {
  it.each([
    [CANON],
    [`${CANON}?si=abc123`],
    [`${CANON}/`],
    [`https://open.spotify.com/intl-de/track/${ID}`],
    [`https://open.spotify.com/intl-pt-br/track/${ID}?si=x#frag`],
    [`  ${CANON}  `],
    [`spotify:track:${ID}`],
    [`https://OPEN.SPOTIFY.COM/track/${ID}`],
  ])('accepts %s', (input) => {
    expect(normalizeSpotifyTrackUrl(input)).toBe(CANON);
  });

  it.each([
    [null],
    [''],
    ['not a url'],
    [`http://open.spotify.com/track/${ID}`],
    [`https://open.spotify.com/album/${ID}`],
    [`https://open.spotify.com/playlist/${ID}`],
    [`https://open.spotify.com/track/${ID.slice(1)}`],
    [`https://open.spotify.com/track/${ID}x`],
    [`https://evil.example/track/${ID}`],
    [`https://open.spotify.com.evil.example/track/${ID}`],
    [`https://user:pass@open.spotify.com/track/${ID}`],
    [`https://open.spotify.com:8443/track/${ID}`],
    [`javascript:alert(1)//open.spotify.com/track/${ID}`],
    [`spotify:album:${ID}`],
    [`spotify:track:${ID}<script>`],
    [`https://open.spotify.com/track/${ID}/extra`],
  ])('rejects %s', (input) => {
    expect(normalizeSpotifyTrackUrl(input as string | null)).toBeNull();
  });
});

describe('enumerated attributes', () => {
  it('parses known values case-insensitively and falls back otherwise', () => {
    expect(parsePosition('TOP-LEFT')).toBe('top-left');
    expect(parsePosition('middle')).toBe('bottom-right');
    expect(parseSize(' lg ')).toBe('lg');
    expect(parseSize('xl')).toBe('md');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme(null)).toBe('auto');
  });

  it('uses enumerated, not boolean, semantics for autoplay', () => {
    expect(parseAutoplay('off')).toBe('off');
    expect(parseAutoplay('attempt')).toBe('attempt');
    // `<music-pill autoplay>` (empty string) is not "on"; it is the default.
    expect(parseAutoplay('')).toBe('attempt');
    expect(parseAutoplay('false')).toBe('attempt');
    expect(parseAutoplay(null)).toBe('attempt');
  });
});

describe('numeric attributes', () => {
  it('sanitises and clamps volume', () => {
    expect(parseVolume(null)).toBe(0.25);
    expect(parseVolume('0.5')).toBe(0.5);
    expect(parseVolume('2')).toBe(1);
    expect(parseVolume('-1')).toBe(0);
    expect(parseVolume('0.5abc')).toBe(0.25);
    expect(parseVolume('NaN')).toBe(0.25);
    expect(parseVolume('Infinity')).toBe(0.25);
    expect(parseVolume('')).toBe(0.25);
  });

  it('sanitises and clamps fade duration', () => {
    expect(parseFadeDuration(null)).toBe(1.5);
    expect(parseFadeDuration('3')).toBe(3);
    expect(parseFadeDuration('-2')).toBe(0);
    expect(parseFadeDuration('999')).toBe(10);
    expect(parseFadeDuration('1e2')).toBe(10);
    expect(parseFadeDuration('slow')).toBe(1.5);
  });
});

describe('sanitizeText', () => {
  it('returns null for empty values', () => {
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText('   ')).toBeNull();
  });
  it('strips control and bidi override characters and collapses whitespace', () => {
    expect(sanitizeText('a\u0000b‮c\n\td')).toBe('a b c d');
  });
  it('keeps markup as literal text (rendering uses textContent)', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
  it('limits length without splitting surrogate pairs', () => {
    const long = '🎵'.repeat(500);
    const out = sanitizeText(long)!;
    expect(Array.from(out).length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('resolveResourceUrl', () => {
  const base = 'https://site.example/page/';
  it('resolves relative URLs and detects cross-origin', () => {
    expect(resolveResourceUrl('/a.mp3', base, 'audio/')).toEqual({
      href: 'https://site.example/a.mp3',
      crossOrigin: false,
    });
    expect(resolveResourceUrl('https://cdn.example/a.mp3', base, 'audio/')).toEqual({
      href: 'https://cdn.example/a.mp3',
      crossOrigin: true,
    });
  });
  it('rejects dangerous or mismatched schemes', () => {
    expect(resolveResourceUrl('javascript:alert(1)', base, 'image/')).toBeNull();
    expect(resolveResourceUrl('data:text/html,<script>', base, 'image/')).toBeNull();
    expect(resolveResourceUrl('data:audio/wav;base64,AAAA', base, 'image/')).toBeNull();
    expect(resolveResourceUrl('data:image/png;base64,AAAA', base, 'image/')).not.toBeNull();
    expect(resolveResourceUrl('https://u:p@cdn.example/a.mp3', base, 'audio/')).toBeNull();
    expect(resolveResourceUrl('', base, 'audio/')).toBeNull();
  });
  it('detects Spotify artwork hosts', () => {
    expect(isSpotifyArtworkHost('https://i.scdn.co/image/abc')).toBe(true);
    expect(isSpotifyArtworkHost('https://image-cdn-ak.spotifycdn.com/image/abc')).toBe(true);
    expect(isSpotifyArtworkHost('https://notspotifycdn.com/x')).toBe(false);
    expect(isSpotifyArtworkHost('https://site.example/album.jpg')).toBe(false);
  });
});
