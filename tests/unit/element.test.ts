import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMusicPill } from '../../src/index';
import { POSITIONS, SIZES, THEMES } from '../../src/parse';
import type { MusicPillElement } from '../../src/types';
import { FakeAudioContext, flush } from './fakes';

const URL_ = 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8';

let playOutcome: 'resolve' | 'reject' = 'resolve';

beforeAll(() => {
  (globalThis as Record<string, unknown>).AudioContext = class extends FakeAudioContext {
    constructor() {
      super('running');
    }
  };
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    if (playOutcome === 'reject') return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  registerMusicPill();
});

beforeEach(() => {
  playOutcome = 'resolve';
  sessionStorage.clear();
});
afterEach(async () => {
  document.body.innerHTML = '';
  await flush();
});

async function mount(attrs: Record<string, string>): Promise<MusicPillElement> {
  const el = document.createElement('music-pill');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  await flush();
  return el;
}

const $ = <T extends Element = HTMLElement>(el: MusicPillElement, sel: string) =>
  el.shadowRoot!.querySelector(sel) as T;

const linkName = (el: MusicPillElement) => $(el, 'a').getAttribute('aria-label');

describe('registration', () => {
  it('guards duplicate definitions', () => {
    const first = customElements.get('music-pill');
    expect(registerMusicPill()).toBe(first);
    expect(() => registerMusicPill()).not.toThrow();
  });
});

describe('link-only pill', () => {
  it('renders a generic Listen on Spotify link from the minimal tag', async () => {
    const el = await mount({ 'spotify-url': URL_ });
    const a = $<HTMLAnchorElement>(el, 'a');
    expect(a.getAttribute('href')).toBe(URL_);
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(linkName(el)).toBe('Listen on Spotify (opens in a new tab)');
    expect($(el, '.sound').hidden).toBe(true);
    expect(el.playbackState).toBe('none');
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
    expect($(el, '.art img').hidden).toBe(true); // placeholder shown
  });

  it('normalises spotify:track URIs', async () => {
    const el = await mount({ 'spotify-url': 'spotify:track:4PTG3Z6ehGkBFwjybzWkR8' });
    expect($(el, 'a').getAttribute('href')).toBe(URL_);
  });

  it('builds an accessible name that identifies song, artist, Spotify, and new tab', async () => {
    const el = await mount({ 'spotify-url': URL_, 'song-title': 'Song', artist: 'Artist' });
    expect(linkName(el)).toBe('Song by Artist, listen on Spotify (opens in a new tab)');
    expect($(el, '.art img').getAttribute('alt')).toBe('');
    expect($(el, '.mark').getAttribute('aria-hidden')).toBe('true');
  });

  it('hides and reports an invalid spotify-url without rendering a link', async () => {
    const errors: string[] = [];
    document.addEventListener('music-pill-error', (e) => errors.push((e as CustomEvent).detail.code), { once: true });
    const el = await mount({ 'spotify-url': 'https://evil.example/track/4PTG3Z6ehGkBFwjybzWkR8' });
    expect($(el, '.root').hidden).toBe(true);
    expect($(el, 'a').hasAttribute('href')).toBe(false);
    expect(errors).toEqual(['invalid-spotify-url']);
  });

  it('renders hostile metadata as inert text', async () => {
    const el = await mount({
      'spotify-url': URL_,
      'song-title': '<img src=x onerror="window.__pwned=1">',
      artist: '"><script>window.__pwned=1</script>',
    });
    expect(el.shadowRoot!.querySelectorAll('script, .title img')).toHaveLength(0);
    expect($(el, '.title').textContent).toBe('<img src=x onerror="window.__pwned=1">');
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('truncates long text visually but keeps the full name available', async () => {
    const long = 'A very long song title '.repeat(5).trim();
    const el = await mount({ 'spotify-url': URL_, 'song-title': long, artist: 'Artist' });
    expect($(el, '.title').textContent).toBe(long);
    expect($(el, '.text').title).toBe(`${long} — Artist`);
  });

  it('ignores javascript: artwork and falls back to the placeholder on image error', async () => {
    const el = await mount({ 'spotify-url': URL_, artwork: 'javascript:alert(1)' });
    expect($(el, '.art img').hasAttribute('src')).toBe(false);
    el.setAttribute('artwork', '/missing.jpg');
    await flush();
    const img = $<HTMLImageElement>(el, '.art img');
    img.dispatchEvent(new Event('error'));
    expect(img.hidden).toBe(true);
    expect($(el, '.art svg').hasAttribute('hidden')).toBe(false);
  });

  it('applies the Spotify artwork radius rule for Spotify-hosted artwork', async () => {
    const el = await mount({ 'spotify-url': URL_, artwork: 'https://i.scdn.co/image/abc' });
    expect($(el, '.art').hasAttribute('data-spotify')).toBe(true);
    el.setAttribute('artwork', '/local.jpg');
    await flush();
    expect($(el, '.art').hasAttribute('data-spotify')).toBe(false);
  });

  it.each(POSITIONS)('supports position %s', async (position) => {
    const el = await mount({ 'spotify-url': URL_, position });
    expect($(el, '.root').dataset.position).toBe(position);
  });

  it('supports every size and theme, defaulting invalid values', async () => {
    for (const size of SIZES) {
      for (const theme of THEMES) {
        const el = await mount({ 'spotify-url': URL_, size, theme });
        expect($(el, '.root').dataset.size).toBe(size);
        expect($(el, '.root').dataset.theme).toBe(theme);
        el.remove();
      }
    }
    const el = await mount({ 'spotify-url': URL_, size: 'huge', theme: 'neon', position: 'middle' });
    expect($(el, '.root').dataset).toMatchObject({ size: 'md', theme: 'auto', position: 'bottom-right' });
  });

  it('emits a bubbling, composed ready event about UI readiness only', async () => {
    const seen: CustomEvent[] = [];
    document.addEventListener('music-pill-ready', (e) => seen.push(e as CustomEvent), { once: true });
    await mount({ 'spotify-url': URL_ });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.bubbles).toBe(true);
    expect(seen[0]!.composed).toBe(true);
    expect(seen[0]!.detail).toEqual({ spotifyUrl: URL_, hasAudio: false });
  });
});

describe('audio pill', () => {
  it('puts the sound button beside the link, never inside it', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav', autoplay: 'off' });
    const button = $<HTMLButtonElement>(el, 'button');
    expect(button.hidden).toBe(false);
    expect(button.closest('a')).toBeNull();
    expect($(el, 'a').querySelector('button')).toBeNull();
    expect(button.parentElement).toBe($(el, 'a').parentElement);
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Enable website sound');
    expect(el.playbackState).toBe('idle');
  });

  it('toggles accurate button names through the real states', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav', autoplay: 'off' });
    const button = $<HTMLButtonElement>(el, 'button');
    button.click();
    await flush(10);
    expect(el.playbackState).toBe('playing');
    expect(button.getAttribute('aria-label')).toBe('Mute website sound');
    button.click();
    expect(el.playbackState).toBe('muted');
    expect(button.getAttribute('aria-label')).toBe('Enable website sound');
  });

  it('reports blocked autoplay and keeps an Enable label (no false playing indicator)', async () => {
    playOutcome = 'reject';
    const blocked: string[] = [];
    document.addEventListener('music-pill-autoplay-blocked', (e) => blocked.push((e as CustomEvent).detail.reason), {
      once: true,
    });
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav' });
    await flush(10);
    expect(el.playbackState).toBe('blocked');
    expect(blocked).toEqual(['play-rejected']);
    expect($(el, 'button').getAttribute('aria-label')).toBe('Enable website sound');
    expect($(el, '[data-icon="on"]').hasAttribute('hidden')).toBe(true);
  });

  it('changes position, size, theme, volume without restarting audio', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav' });
    await flush(10);
    expect(el.playbackState).toBe('playing');
    const audio = el.shadowRoot!.querySelector('audio');
    const states: string[] = [];
    el.addEventListener('music-pill-statechange', (e) => states.push((e as CustomEvent).detail.state));
    el.setAttribute('position', 'top-left');
    el.setAttribute('size', 'lg');
    el.setAttribute('theme', 'dark');
    el.setAttribute('volume', '0.6');
    el.setAttribute('song-title', 'Renamed');
    await flush(10);
    expect(el.shadowRoot!.querySelector('audio')).toBe(audio);
    expect(states).toEqual([]);
    expect(el.playbackState).toBe('playing');
  });

  it('fully resets when the audio source changes', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/one.wav' });
    await flush(10);
    const first = el.shadowRoot!.querySelector('audio')!;
    el.setAttribute('audio-src', '/two.wav');
    await flush(10);
    const audios = el.shadowRoot!.querySelectorAll('audio');
    expect(audios).toHaveLength(1);
    expect(audios[0]).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(audios[0]!.src).toContain('/two.wav');
  });

  it('removing audio-src returns to a link-only pill', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/one.wav' });
    await flush(10);
    el.removeAttribute('audio-src');
    await flush(10);
    expect(el.playbackState).toBe('none');
    expect($(el, 'button').hidden).toBe(true);
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
  });

  it('a synchronous move keeps audio; real removal tears it down', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/one.wav' });
    await flush(10);
    const audio = el.shadowRoot!.querySelector('audio');
    const other = document.createElement('div');
    document.body.append(other);
    other.append(el); // disconnect + connect in one task
    await flush(10);
    expect(el.shadowRoot!.querySelector('audio')).toBe(audio);
    expect(el.playbackState).toBe('playing');
    el.remove();
    await flush(10);
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
    expect(el.playbackState).toBe('none');
  });

  it('remounting does not duplicate audio', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/one.wav' });
    await flush(10);
    el.remove();
    await flush(10);
    document.body.append(el);
    await flush(10);
    expect(el.shadowRoot!.querySelectorAll('audio')).toHaveLength(1);
  });

  it('only one of several instances autoplays', async () => {
    const a = await mount({ 'spotify-url': URL_, 'audio-src': '/one.wav' });
    const b = await mount({ 'spotify-url': URL_, 'audio-src': '/two.wav' });
    await flush(10);
    expect(a.playbackState).toBe('playing');
    expect(b.playbackState).toBe('idle');
    await b.enableSound();
    expect(b.playbackState).toBe('playing');
    expect(a.playbackState).toBe('paused');
  });

  it('sound-control="host" hides the built-in button but keeps the API', async () => {
    const el = await mount({
      'spotify-url': URL_,
      'audio-src': '/one.wav',
      autoplay: 'off',
      'sound-control': 'host',
    });
    expect($(el, 'button').hidden).toBe(true);
    expect(await el.enableSound()).toBe(true);
    el.mute();
    expect(el.playbackState).toBe('muted');
  });

  it('rejects unsafe audio-src values', async () => {
    const codes: string[] = [];
    document.addEventListener('music-pill-error', (e) => codes.push((e as CustomEvent).detail.code), { once: true });
    const el = await mount({ 'spotify-url': URL_, 'audio-src': 'javascript:alert(1)' });
    expect(codes).toEqual(['invalid-audio-src']);
    expect(el.playbackState).toBe('none');
    expect($(el, 'button').hidden).toBe(true);
  });

  it('error details carry only a code and a generic message', async () => {
    const details: unknown[] = [];
    document.addEventListener('music-pill-error', (e) => details.push((e as CustomEvent).detail), { once: true });
    await mount({ 'spotify-url': 'nope' });
    expect(Object.keys(details[0] as object).sort()).toEqual(['code', 'message']);
  });
});
