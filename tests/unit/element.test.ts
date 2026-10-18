import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMusicPill } from '../../src/index';
import { POSITIONS, SIZES, THEMES } from '../../src/parse';
import type { MusicPillElement } from '../../src/types';
import { FakeAudioContext, flush } from './fakes';

const URL_ = 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8';

let playOutcome: 'resolve' | 'reject' | 'pending' = 'resolve';
let releasePlay: (() => void) | null = null;

beforeAll(() => {
  (globalThis as Record<string, unknown>).AudioContext = class extends FakeAudioContext {
    constructor() {
      super('running');
    }
  };
  // Deterministic type detection. happy-dom's canPlayType is not a real browser.
  HTMLMediaElement.prototype.canPlayType = function (type: string) {
    const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (
      base === 'audio/mpeg' ||
      base === 'audio/wav' ||
      base === 'audio/wave' ||
      base === 'audio/mp4' ||
      base === 'audio/ogg' ||
      base === 'audio/aac'
    ) {
      return 'probably';
    }
    return '';
  };
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    if (playOutcome === 'reject') return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    if (playOutcome === 'pending') {
      return new Promise((resolve) => {
        releasePlay = () => {
          Object.defineProperty(this, 'paused', { configurable: true, value: false });
          resolve();
        };
      });
    }
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
  releasePlay = null;
  sessionStorage.clear();
});
afterEach(async () => {
  document.body.innerHTML = '';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
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
    expect($(el, '.status').textContent).toBe('Playing');
    expect($(el, '.status').closest('a')).toBeNull();
    button.click();
    expect(el.playbackState).toBe('muted');
    expect(button.getAttribute('aria-label')).toBe('Enable website sound');
    expect($(el, '.status').textContent).toBe('Muted');
    expect($(el, '[data-icon="off"]').hasAttribute('hidden')).toBe(false);
    expect($(el, '[data-icon="pause"]').hasAttribute('hidden')).toBe(true);
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
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
  });

  it('error details carry only a code and a generic message', async () => {
    const details: unknown[] = [];
    document.addEventListener('music-pill-error', (e) => details.push((e as CustomEvent).detail), { once: true });
    await mount({ 'spotify-url': 'nope' });
    expect(Object.keys(details[0] as object).sort()).toEqual(['code', 'message']);
  });

  it('shows a loading state outside the Spotify link, then Playing', async () => {
    playOutcome = 'pending';
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav', autoplay: 'off' });
    $(el, 'button').click();
    await flush();
    expect(el.playbackState).toBe('starting');
    const status = $(el, '.status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Loading audio');
    expect(status.closest('a')).toBeNull();
    expect($(el, 'button').contains(status)).toBe(false);
    expect($(el, '.spinner').hasAttribute('hidden')).toBe(false);
    expect($(el, 'button').getAttribute('aria-busy')).toBe('true');
    expect(linkName(el)).not.toContain('Loading');
    releasePlay?.();
    await flush(10);
    expect(el.playbackState).toBe('playing');
    expect($(el, '.status').textContent).toBe('Playing');
    expect($(el, '.spinner').hasAttribute('hidden')).toBe(true);
    expect($(el, 'button').hasAttribute('aria-busy')).toBe(false);
  });

  it('shows a specific decode error without putting it on the Spotify link', async () => {
    const details: { code: string; message: string }[] = [];
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav', autoplay: 'off' });
    el.addEventListener('music-pill-error', (e) => details.push((e as CustomEvent).detail));
    const audio = el.shadowRoot!.querySelector('audio')!;
    Object.defineProperty(audio, 'error', { configurable: true, get: () => ({ code: 3 }) });
    audio.dispatchEvent(new Event('error'));
    expect(el.playbackState).toBe('error');
    expect(details.map((d) => d.code)).toEqual(['audio-decode-failed']);
    expect(details[0]!.message).toMatch(/decode/i);
    expect(details[0]!.message).not.toMatch(/https?:|\/tone\.wav|DOMException/i);
    const status = $(el, '.status');
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.textContent).toBe(details[0]!.message);
    expect(status.closest('a')).toBeNull();
    expect($<HTMLButtonElement>(el, 'button').disabled).toBe(true);
    expect($(el, 'button').getAttribute('aria-label')).toBe('Website sound unavailable');
    expect($(el, '[data-icon="error"]').hasAttribute('hidden')).toBe(false);
    expect(linkName(el)).toBe('Listen on Spotify (opens in a new tab)');
  });

  it('distinguishes paused from muted', async () => {
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav' });
    await flush(10);
    expect(el.playbackState).toBe('playing');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(el.playbackState).toBe('paused');
    expect($(el, '.status').textContent).toBe('Paused');
    expect($(el, '[data-icon="pause"]').hasAttribute('hidden')).toBe(false);
    expect($(el, '[data-icon="off"]').hasAttribute('hidden')).toBe(true);
    expect($(el, 'button').getAttribute('aria-label')).toBe('Enable website sound');
  });
});

describe('audio sources', () => {
  async function mountWith(
    attrs: Record<string, string>,
    setup?: (el: MusicPillElement) => void,
  ): Promise<MusicPillElement> {
    const el = document.createElement('music-pill') as MusicPillElement;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    setup?.(el);
    document.body.append(el);
    await flush();
    return el;
  }

  it('keeps a single audio-src and infers audio/wav', async () => {
    const el = await mountWith({ 'spotify-url': URL_, 'audio-src': '/tone.wav', autoplay: 'off' });
    expect(el.audioSources).toEqual([{ src: '/tone.wav' }]);
    expect(el.shadowRoot!.querySelector('audio')!.getAttribute('src')).toContain('/tone.wav');
    expect(el.playbackState).toBe('idle');
  });

  it('plays the first source whose type the browser accepts', async () => {
    const el = await mountWith({ 'spotify-url': URL_, autoplay: 'off' }, (node) => {
      node.insertAdjacentHTML(
        'beforeend',
        '<source src="/nope.mp3" type="audio/x-music-pill-unsupported"><source src="/tone.wav" type="audio/wav">',
      );
    });
    const audio = el.shadowRoot!.querySelector('audio')!;
    expect(audio.getAttribute('src')).toContain('/tone.wav');
    expect(audio.getAttribute('src')).not.toContain('nope.mp3');
  });

  it('skips an audio-src extension the browser cannot play and uses the next <source>', async () => {
    const previous = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type: string) {
      return type.split(';')[0]?.trim().toLowerCase() === 'audio/wav' ? 'probably' : '';
    };
    try {
      const el = await mountWith({ 'spotify-url': URL_, 'audio-src': '/song.mp3', autoplay: 'off' }, (node) => {
        node.insertAdjacentHTML('beforeend', '<source src="/tone.wav" type="audio/wav">');
      });
      expect(el.shadowRoot!.querySelector('audio')!.getAttribute('src')).toContain('/tone.wav');
    } finally {
      HTMLMediaElement.prototype.canPlayType = previous;
    }
  });

  it('uses the audio-sources attribute instead of audio-src', async () => {
    const el = await mountWith({
      'spotify-url': URL_,
      autoplay: 'off',
      'audio-src': '/ignored.wav',
      'audio-sources': JSON.stringify([
        { src: '/nope.ogg', type: 'audio/x-music-pill-unsupported' },
        { src: '/from-list.wav', type: 'audio/wav' },
      ]),
    });
    expect(el.shadowRoot!.querySelector('audio')!.getAttribute('src')).toContain('/from-list.wav');
  });

  it('lets the audioSources property override attributes and children', async () => {
    const el = await mountWith({ 'spotify-url': URL_, 'audio-src': '/ignored.wav', autoplay: 'off' }, (node) => {
      node.insertAdjacentHTML('beforeend', '<source src="/child.wav" type="audio/wav">');
    });
    el.audioSources = [
      { src: '/nope.m4a', type: 'audio/x-music-pill-unsupported' },
      { src: '/property.wav', type: 'audio/wav' },
    ];
    await flush();
    expect(el.shadowRoot!.querySelector('audio')!.getAttribute('src')).toContain('/property.wav');
    el.audioSources = null;
    await flush();
    expect(el.shadowRoot!.querySelector('audio')!.getAttribute('src')).toContain('/ignored.wav');
  });

  it('picks up a <source> added after connect', async () => {
    const el = await mountWith({ 'spotify-url': URL_, autoplay: 'off' });
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
    const source = document.createElement('source');
    source.setAttribute('src', '/tone.wav');
    source.setAttribute('type', 'audio/wav');
    el.append(source);
    await flush();
    expect(el.shadowRoot!.querySelector('audio')!.getAttribute('src')).toContain('/tone.wav');
  });

  it('reports no-playable-source with an accessible error and a working link', async () => {
    const details: { code: string; message: string }[] = [];
    document.addEventListener('music-pill-error', (e) => details.push((e as CustomEvent).detail));
    const el = await mountWith({ 'spotify-url': URL_, 'song-title': 'Tone', autoplay: 'off' }, (node) => {
      node.insertAdjacentHTML(
        'beforeend',
        '<source src="/tone.wav" type="audio/x-music-pill-unsupported">',
      );
    });
    expect(el.playbackState).toBe('error');
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
    expect(details.map((d) => d.code)).toEqual(['no-playable-source']);
    expect(details[0]!.message).toMatch(/MP3/);
    expect(details[0]!.message).not.toMatch(/https?:|tone\.wav/);
    const status = $(el, '.status');
    expect(status.hidden).toBe(false);
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.textContent).toBe(details[0]!.message);
    expect(status.closest('a')).toBeNull();
    expect($<HTMLButtonElement>(el, 'button').disabled).toBe(true);
    expect($(el, 'a').getAttribute('href')).toBe(URL_);
    expect(linkName(el)).toBe('Tone, listen on Spotify (opens in a new tab)');
    expect(linkName(el)).not.toContain('MP3');
  });

  it('rejects a malformed audio-sources attribute', async () => {
    const codes: string[] = [];
    document.addEventListener('music-pill-error', (e) => codes.push((e as CustomEvent).detail.code), { once: true });
    const el = await mountWith({ 'spotify-url': URL_, 'audio-sources': '{not json' });
    expect(codes).toEqual(['invalid-audio-sources']);
    expect(el.playbackState).toBe('none');
    expect($(el, 'button').hidden).toBe(true);
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
  });

  it('treats audio-sources="[]" as link-only', async () => {
    const errors: string[] = [];
    document.addEventListener('music-pill-error', (e) => errors.push((e as CustomEvent).detail.code));
    const el = await mountWith({ 'spotify-url': URL_, 'audio-sources': '[]', 'audio-src': '/tone.wav' });
    expect(el.playbackState).toBe('none');
    expect(el.shadowRoot!.querySelector('audio')).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe('blocked autoplay gesture', () => {
  it('starts on the next click or key, and ignores scroll, Tab, and autoplay off', async () => {
    playOutcome = 'reject';
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav' });
    await flush(10);
    expect(el.playbackState).toBe('blocked');
    expect($(el, '.status').textContent).toBe('Sound off');

    document.dispatchEvent(new Event('wheel', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await flush(10);
    expect(el.playbackState).toBe('blocked');

    playOutcome = 'resolve';
    document.body.click();
    await flush(10);
    expect(el.playbackState).toBe('playing');
    expect($(el, '.status').textContent).toBe('Playing');

    const quiet = await mount({ 'spotify-url': URL_, 'audio-src': '/other.wav', autoplay: 'off' });
    document.body.click();
    await flush(10);
    expect(quiet.playbackState).toBe('idle');
  });

  it('a click on the sound button starts sound once and does not immediately mute', async () => {
    playOutcome = 'reject';
    const el = await mount({ 'spotify-url': URL_, 'audio-src': '/tone.wav' });
    await flush(10);
    expect(el.playbackState).toBe('blocked');
    playOutcome = 'resolve';
    $(el, 'button').click();
    await flush(10);
    expect(el.playbackState).toBe('playing');
    expect($(el, 'button').getAttribute('aria-label')).toBe('Mute website sound');
  });
});

describe('reduced motion stylesheet', () => {
  it('drops UI motion and leaves the rule where audio fades are not mentioned', async () => {
    const { STYLES } = await import('../../src/styles');
    expect(STYLES).toContain('@media (prefers-reduced-motion: reduce)');
    expect(STYLES).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.spinner\s*\{[^}]*animation:\s*none/);
    expect(STYLES).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition:\s*none/);
  });
});
