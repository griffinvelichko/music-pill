// The <music-pill> element. The class is created inside createMusicPillClass(),
// which only runs from registerMusicPill() in a browser, so importing this
// module never evaluates HTMLElement.

import { AudioEngine } from './audio-engine.js';
import {
  PLACEHOLDER_ICON,
  SOUND_ERROR_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
  SOUND_PAUSE_ICON,
  SPOTIFY_ICON,
} from './icons.js';
import {
  isSpotifyArtworkHost,
  normalizeSpotifyTrackUrl,
  parseAutoplay,
  parseFadeDuration,
  parsePosition,
  parseSize,
  parseSoundControl,
  parseTheme,
  parseVolume,
  resolveResourceUrl,
  sanitizeText,
} from './parse.js';
import type { AudioCoordinator, SoundPreference } from './session.js';
import {
  DROPPED_AUDIO_SOURCE_MESSAGE,
  INVALID_AUDIO_SOURCES_MESSAGE,
  INVALID_AUDIO_SRC_MESSAGE,
  MAX_AUDIO_SOURCES,
  NO_PLAYABLE_SOURCE_MESSAGE,
  parseAudioSourcesAttribute,
  selectAudioSource,
  type AudioSourceSelection,
} from './sources.js';
import { STYLES } from './styles.js';
import type {
  MusicPillAudioSource,
  MusicPillElement,
  MusicPillElementConstructor,
  MusicPillErrorCode,
  MusicPillEventMap,
  PlaybackState,
  StateChangeReason,
} from './types.js';

export const OBSERVED_ATTRIBUTES = [
  'spotify-url',
  'song-title',
  'artist',
  'artwork',
  'audio-src',
  'audio-sources',
  'position',
  'size',
  'theme',
  'autoplay',
  'volume',
  'fade-duration',
  'sound-control',
] as const;

export type SharedState = {
  prefs: SoundPreference;
  coordinator: AudioCoordinator;
  createContext: () => AudioContext | null;
};

const TEMPLATE = `
<div class="root" part="container" hidden>
  <a class="pill" part="pill" target="_blank" rel="noopener noreferrer">
    <span class="art" part="artwork"><img alt="" decoding="async" hidden>${PLACEHOLDER_ICON}</span>
    <span class="text">
      <span class="title" part="title"></span>
      <span class="artist" part="artist" hidden></span>
    </span>
    ${SPOTIFY_ICON}
  </a>
  <span class="sep" aria-hidden="true" hidden></span>
  <button class="sound" part="sound-button" type="button" hidden>${SOUND_OFF_ICON}${SOUND_ON_ICON}${SOUND_PAUSE_ICON}${SOUND_ERROR_ICON}<span class="spinner" hidden aria-hidden="true"></span></button>
  <span class="status" id="status" part="status" role="status" hidden></span>
</div>`;

type Parts = {
  root: HTMLDivElement;
  link: HTMLAnchorElement;
  art: HTMLSpanElement;
  img: HTMLImageElement;
  placeholder: SVGElement;
  text: HTMLSpanElement;
  title: HTMLSpanElement;
  artist: HTMLSpanElement;
  sep: HTMLSpanElement;
  sound: HTMLButtonElement;
  status: HTMLSpanElement;
  spinner: HTMLSpanElement;
  iconOn: SVGElement;
  iconOff: SVGElement;
  iconPause: SVGElement;
  iconError: SVGElement;
};

type CollectedSources = {
  sources: MusicPillAudioSource[];
  /** Stable identity of the configured list, including invalid attribute text. */
  signature: string;
  invalidAttribute: boolean;
};

let sheetCache: CSSStyleSheet | null | undefined;
function sharedSheet(): CSSStyleSheet | null {
  if (sheetCache !== undefined) return sheetCache;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    sheetCache = 'adoptedStyleSheets' in ShadowRoot.prototype ? sheet : null;
  } catch {
    sheetCache = null;
  }
  return sheetCache;
}

function sourceSignature(sources: readonly MusicPillAudioSource[]): string {
  return sources.map((source) => `${source.src}\0${source.type ?? ''}`).join('\n');
}

function cloneSource(source: MusicPillAudioSource): MusicPillAudioSource | null {
  if (!source || typeof source.src !== 'string') return null;
  const src = source.src.trim();
  if (!src) return null;
  const type = typeof source.type === 'string' && source.type.trim() ? source.type.trim() : undefined;
  return type ? { src, type } : { src };
}

export function createMusicPillClass(shared: SharedState): MusicPillElementConstructor {
  class MusicPill extends HTMLElement implements MusicPillElement {
    static get observedAttributes(): readonly string[] {
      return OBSERVED_ATTRIBUTES;
    }

    readonly #shadow: ShadowRoot;
    readonly #p: Parts;
    #engine: AudioEngine | null = null;
    #songKey: string | null = null;
    #renderQueued = false;
    #artHref: string | null = null;
    #artToken = 0;
    #invalidReported: string | null = null;
    /** Set when selection failed before an engine exists, so playbackState is `error`. */
    #configError = false;
    #statusText: string | null = null;
    /** When non-null, replaces audio-src, audio-sources, and <source> children. */
    #sourceOverride: MusicPillAudioSource[] | null = null;
    #sourcesObserver: MutationObserver | null = null;
    #probe: HTMLAudioElement | null = null;
    #gestureAbort: AbortController | null = null;
    /** The one automatic gesture unlock has already been used for this song. */
    #gestureUsed = false;

    constructor() {
      super();
      this.#shadow = this.attachShadow({ mode: 'open' });
      // Constructable stylesheets are not subject to CSP style-src, so the
      // component works under a strict policy without 'unsafe-inline'.
      const sheet = sharedSheet();
      if (sheet) this.#shadow.adoptedStyleSheets = [sheet];
      else {
        const style = document.createElement('style');
        style.textContent = STYLES;
        this.#shadow.append(style);
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = TEMPLATE; // static markup only
      this.#shadow.append(tpl.content.cloneNode(true));
      const q = <T extends Element>(sel: string) => this.#shadow.querySelector(sel) as T;
      this.#p = {
        root: q('.root'),
        link: q('.pill'),
        art: q('.art'),
        img: q('.art img'),
        placeholder: q('.art svg'),
        text: q('.text'),
        title: q('.title'),
        artist: q('.artist'),
        sep: q('.sep'),
        sound: q('.sound'),
        status: q('.status'),
        spinner: q('.spinner'),
        iconOn: q('[data-icon="on"]'),
        iconOff: q('[data-icon="off"]'),
        iconPause: q('[data-icon="pause"]'),
        iconError: q('[data-icon="error"]'),
      };
      this.#p.sound.addEventListener('click', () => this.#onSoundClick());
      this.#syncChrome('none');
    }

    get playbackState(): PlaybackState {
      if (this.#engine) return this.#engine.state;
      if (this.#configError) return 'error';
      return 'none';
    }

    get audioSources(): readonly MusicPillAudioSource[] {
      return this.#collectSources().sources.map((source) => ({ ...source }));
    }

    set audioSources(value: readonly MusicPillAudioSource[] | null) {
      if (value == null) {
        this.#sourceOverride = null;
      } else {
        const next: MusicPillAudioSource[] = [];
        for (const item of value) {
          const source = cloneSource(item);
          if (!source) continue;
          next.push(source);
          if (next.length >= MAX_AUDIO_SOURCES) break;
        }
        this.#sourceOverride = next;
      }
      this.#queueRender();
    }

    enableSound(): Promise<boolean> {
      // Render synchronously if a queued update has not run yet, so a gesture
      // that arrives right after insertion still reaches the audio element.
      if (this.#renderQueued && this.isConnected) this.#render();
      return this.#engine ? this.#engine.enableSound() : Promise.resolve(false);
    }

    mute(): void {
      if (this.#engine) this.#engine.mute();
      else shared.prefs.setMuted(true);
    }

    connectedCallback(): void {
      this.#observeSources();
      this.#queueRender();
    }

    disconnectedCallback(): void {
      // Defer teardown: a synchronous move (remove + insert, as frameworks do
      // when reordering) reconnects before this runs and keeps audio intact.
      this.#disarmGestureUnlock();
      queueMicrotask(() => {
        if (this.isConnected) {
          if (this.playbackState === 'blocked') this.#armGestureUnlock();
          return;
        }
        this.#sourcesObserver?.disconnect();
        this.#sourcesObserver = null;
        this.#teardownAudio(false);
      });
    }

    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue !== newValue) this.#queueRender();
    }

    // -------------------------------------------------------------------------

    #observeSources(): void {
      if (this.#sourcesObserver) return;
      this.#sourcesObserver = new MutationObserver(() => this.#queueRender());
      // Light-DOM <source> children only. The shadow tree is a separate root,
      // so this does not observe the component's own markup.
      this.#sourcesObserver.observe(this, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'type'],
      });
    }

    #canPlay(mime: string): string {
      try {
        this.#probe ??= this.ownerDocument.createElement('audio');
        return this.#probe.canPlayType(mime) ?? '';
      } catch {
        return '';
      }
    }

    /**
     * Source list, highest precedence first:
     * 1. `audioSources` property, when assigned (including an empty array)
     * 2. `audio-sources` attribute, when non-blank
     * 3. `audio-src`, then direct `<source>` children
     */
    #collectSources(): CollectedSources {
      if (this.#sourceOverride) {
        const sources = this.#sourceOverride.map((source) => ({ ...source }));
        return { sources, signature: `override\0${sourceSignature(sources)}`, invalidAttribute: false };
      }
      const attr = this.getAttribute('audio-sources');
      if (attr !== null && attr.trim() !== '') {
        const parsed = parseAudioSourcesAttribute(attr);
        if (!parsed.ok) return { sources: [], signature: `invalid-attribute\0${attr}`, invalidAttribute: true };
        return {
          sources: parsed.sources,
          signature: `attribute\0${sourceSignature(parsed.sources)}`,
          invalidAttribute: false,
        };
      }
      const sources: MusicPillAudioSource[] = [];
      const single = this.getAttribute('audio-src');
      if (single && single.trim()) sources.push({ src: single.trim() });
      for (const child of this.children) {
        if (child.localName !== 'source') continue;
        const src = child.getAttribute('src');
        if (!src || !src.trim()) continue;
        const type = child.getAttribute('type');
        sources.push(type && type.trim() ? { src: src.trim(), type: type.trim() } : { src: src.trim() });
        if (sources.length >= MAX_AUDIO_SOURCES) break;
      }
      return { sources, signature: `inline\0${sourceSignature(sources)}`, invalidAttribute: false };
    }

    #selectSources(collected: CollectedSources): AudioSourceSelection {
      if (collected.invalidAttribute) return { status: 'invalid' };
      return selectAudioSource(collected.sources, this.ownerDocument.baseURI, (mime) => this.#canPlay(mime));
    }

    #queueRender(): void {
      if (this.#renderQueued) return;
      this.#renderQueued = true;
      // Batch attribute changes made in the same task (frameworks often set
      // several at once) into one update.
      queueMicrotask(() => {
        if (this.#renderQueued && this.isConnected) this.#render();
        this.#renderQueued = false;
      });
    }

    #render(): void {
      this.#renderQueued = false;
      const p = this.#p;
      const rawUrl = this.getAttribute('spotify-url');
      const spotifyUrl = normalizeSpotifyTrackUrl(rawUrl);

      if (!spotifyUrl) {
        p.root.hidden = true;
        p.link.removeAttribute('href');
        this.#teardownAudio(true);
        this.#songKey = null;
        p.sound.hidden = true;
        p.sep.hidden = true;
        delete p.root.dataset.sound;
        this.#syncChrome('none');
        const key = rawUrl ?? '';
        if (this.#invalidReported !== key) {
          this.#invalidReported = key;
          this.#emitError(
            'invalid-spotify-url',
            'spotify-url must be an https://open.spotify.com/track/… URL or a spotify:track:… URI.',
          );
        }
        return;
      }
      this.#invalidReported = null;

      // Presentation: these never touch audio.
      p.root.dataset.position = parsePosition(this.getAttribute('position'));
      p.root.dataset.size = parseSize(this.getAttribute('size'));
      p.root.dataset.theme = parseTheme(this.getAttribute('theme'));
      p.link.href = spotifyUrl;
      this.#renderText();
      this.#renderArtwork();

      const collected = this.#collectSources();
      const selection = this.#selectSources(collected);
      const builtInControl = parseSoundControl(this.getAttribute('sound-control')) === 'built-in';
      const showButton = (selection.status === 'selected' || selection.status === 'none-playable') && builtInControl;
      p.sound.hidden = !showButton;
      p.sep.hidden = !showButton;
      if (showButton) p.root.dataset.sound = '';
      else delete p.root.dataset.sound;

      const settings = {
        volume: parseVolume(this.getAttribute('volume')),
        fade: parseFadeDuration(this.getAttribute('fade-duration')),
      };
      const songKey = `${spotifyUrl}\0${collected.signature}`;
      p.root.hidden = false;

      if (songKey === this.#songKey) {
        this.#engine?.update(settings);
        this.#syncChrome(this.playbackState);
        return;
      }

      this.#installAudio(
        spotifyUrl,
        selection,
        collected.invalidAttribute,
        settings,
        parseAutoplay(this.getAttribute('autoplay')) === 'attempt',
        songKey,
      );
    }

    #installAudio(
      spotifyUrl: string,
      selection: AudioSourceSelection,
      invalidAttribute: boolean,
      settings: { volume: number; fade: number },
      autoplay: boolean,
      songKey: string,
    ): void {
      const hadEngine = this.#teardownAudio(true);
      this.#gestureUsed = false;
      this.#songKey = songKey;
      const previous: PlaybackState = hadEngine ?? 'none';

      if (selection.status === 'empty' || selection.status === 'invalid') {
        this.#syncChrome('none');
        if (selection.status === 'invalid') {
          this.#emitError(
            invalidAttribute ? 'invalid-audio-sources' : 'invalid-audio-src',
            invalidAttribute ? INVALID_AUDIO_SOURCES_MESSAGE : INVALID_AUDIO_SRC_MESSAGE,
          );
        }
        this.#emit('music-pill-ready', { spotifyUrl, hasAudio: false });
        if (hadEngine) {
          this.#emit('music-pill-statechange', { state: 'none', previousState: hadEngine, reason: 'source-changed' });
        }
        return;
      }

      if (selection.status === 'none-playable') {
        this.#configError = true;
        this.#statusText = NO_PLAYABLE_SOURCE_MESSAGE;
        this.#syncChrome('error');
        this.#emitError('no-playable-source', NO_PLAYABLE_SOURCE_MESSAGE);
        this.#emit('music-pill-ready', { spotifyUrl, hasAudio: true });
        this.#emit('music-pill-statechange', { state: 'error', previousState: previous, reason: 'error' });
        return;
      }

      if (selection.droppedInvalid > 0) {
        this.#emitError('invalid-audio-src', DROPPED_AUDIO_SOURCE_MESSAGE);
      }
      const el = this.ownerDocument.createElement('audio');
      el.hidden = true;
      this.#shadow.append(el);
      this.#engine = new AudioEngine(
        el,
        selection.source,
        settings,
        {
          doc: this.ownerDocument,
          prefs: shared.prefs,
          coordinator: shared.coordinator,
          createContext: shared.createContext,
        },
        {
          onState: (state, prev, reason) => this.#onEngineState(state, prev, reason),
          onAutoplayBlocked: (reason) => this.#emit('music-pill-autoplay-blocked', { reason }),
          onError: (code, message) => {
            this.#statusText = message;
            this.#syncChrome(this.playbackState);
            this.#emitError(code, message);
          },
        },
      );
      this.#syncChrome(this.playbackState);
      this.#emit('music-pill-ready', { spotifyUrl, hasAudio: true });
      this.#engine.begin(autoplay);
    }

    #renderText(): void {
      const p = this.#p;
      const title = sanitizeText(this.getAttribute('song-title'));
      const artist = sanitizeText(this.getAttribute('artist'));
      p.title.textContent = title ?? 'Listen on Spotify';
      p.artist.textContent = artist ?? '';
      p.artist.hidden = !artist;
      // The accessible name starts with the visible title (WCAG "label in
      // name") and adds the artist, the Spotify destination and new-tab note:
      // "Song by Artist, listen on Spotify (opens in a new tab)". An explicit
      // label avoids engines inserting stray spaces between the text blocks.
      p.link.setAttribute(
        'aria-label',
        title
          ? `${title}${artist ? ` by ${artist}` : ''}, listen on Spotify (opens in a new tab)`
          : `Listen on Spotify${artist ? `, ${artist}` : ''} (opens in a new tab)`,
      );
      // Full text on hover for sighted mouse users when it is truncated.
      const full = [title ?? 'Listen on Spotify', artist].filter(Boolean).join(' — ');
      p.text.title = full;
    }

    #renderArtwork(): void {
      const p = this.#p;
      const resolved = resolveResourceUrl(this.getAttribute('artwork'), this.ownerDocument.baseURI, 'image/');
      const href = resolved?.href ?? null;
      if (href === this.#artHref) return;
      this.#artHref = href;
      const token = ++this.#artToken;
      p.img.hidden = true;
      p.placeholder.toggleAttribute('hidden', false);
      p.img.onload = p.img.onerror = null;
      if (href && isSpotifyArtworkHost(href)) p.art.dataset.spotify = '';
      else delete p.art.dataset.spotify;
      if (!href) {
        p.img.removeAttribute('src');
        return;
      }
      p.img.onload = () => {
        if (token !== this.#artToken) return;
        p.img.hidden = false;
        p.placeholder.toggleAttribute('hidden', true);
      };
      p.img.onerror = () => {
        if (token !== this.#artToken) return;
        // Broken artwork is a normal fallback: keep the neutral placeholder.
        p.img.hidden = true;
        p.placeholder.toggleAttribute('hidden', false);
      };
      p.img.src = href;
    }

    /** Stops and releases audio. Returns the previous state if an engine existed. */
    #teardownAudio(sourceChanged: boolean): PlaybackState | null {
      this.#configError = false;
      this.#statusText = null;
      this.#disarmGestureUnlock();
      const engine = this.#engine;
      if (!engine) {
        if (!sourceChanged) this.#songKey = null;
        return null;
      }
      const previous = engine.state;
      this.#engine = null;
      engine.destroy();
      engine.audio.remove();
      if (!sourceChanged) this.#songKey = null; // reconnecting starts fresh
      this.#syncChrome('none');
      return previous;
    }

    #onSoundClick(): void {
      const engine = this.#engine;
      if (!engine) return;
      const state = engine.state;
      if (state === 'playing' || state === 'starting') engine.mute();
      else void engine.enableSound();
    }

    /**
     * After autoplay is blocked, the next click or key press on the page starts
     * sound once. play() runs synchronously inside that gesture. Scrolls do
     * not count, and the sound button is left to its own handler so a click
     * there cannot both start and immediately mute.
     */
    #armGestureUnlock(): void {
      if (this.#gestureAbort || this.#gestureUsed || !this.isConnected) return;
      const abort = new AbortController();
      this.#gestureAbort = abort;
      const options = { signal: abort.signal };
      this.ownerDocument.addEventListener('click', (event) => this.#onGesture(event), options);
      this.ownerDocument.addEventListener('keydown', (event) => this.#onGesture(event), options);
    }

    #disarmGestureUnlock(): void {
      this.#gestureAbort?.abort();
      this.#gestureAbort = null;
    }

    #onGesture(event: Event): void {
      if (this.#gestureUsed) return;
      if (event.type === 'keydown') {
        const key = (event as KeyboardEvent).key;
        if (key === 'Tab' || key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'Escape' || key === 'CapsLock') {
          return;
        }
      }
      if (event.composedPath().includes(this.#p.sound)) return;
      const engine = this.#engine;
      if (!engine || engine.state !== 'blocked') {
        this.#disarmGestureUnlock();
        return;
      }
      this.#gestureUsed = true;
      this.#disarmGestureUnlock();
      void engine.enableSound();
    }

    #onEngineState(state: PlaybackState, previous: PlaybackState, reason: StateChangeReason): void {
      if (state !== 'error') this.#statusText = null;
      this.#syncChrome(state);
      if (state === 'blocked') this.#armGestureUnlock();
      else this.#disarmGestureUnlock();
      this.#emit('music-pill-statechange', { state, previousState: previous, reason });
    }

    #statusFor(state: PlaybackState): string | null {
      switch (state) {
        case 'starting':
          return 'Loading audio';
        case 'playing':
          return 'Playing';
        case 'muted':
          return 'Muted';
        case 'paused':
          return 'Paused';
        case 'blocked':
          return 'Sound off';
        case 'error':
          return this.#statusText ?? 'Audio unavailable';
        default:
          return null;
      }
    }

    #syncChrome(state: PlaybackState): void {
      const { root, sound, status, spinner, iconOn, iconOff, iconPause, iconError } = this.#p;
      root.dataset.playback = state;
      const audible = state === 'playing' || state === 'starting';
      const showPause = state === 'paused';
      const showError = state === 'error';
      sound.disabled = showError;
      if (state === 'starting') sound.setAttribute('aria-busy', 'true');
      else sound.removeAttribute('aria-busy');
      sound.setAttribute(
        'aria-label',
        showError ? 'Website sound unavailable' : audible ? 'Mute website sound' : 'Enable website sound',
      );
      if (showError || state === 'none' || state === 'idle') sound.removeAttribute('aria-pressed');
      else sound.setAttribute('aria-pressed', audible ? 'true' : 'false');
      iconOn.toggleAttribute('hidden', state !== 'playing');
      iconOff.toggleAttribute('hidden', audible || showPause || showError);
      iconPause.toggleAttribute('hidden', !showPause);
      iconError.toggleAttribute('hidden', !showError);
      spinner.toggleAttribute('hidden', state !== 'starting');

      const text = this.#statusFor(state);
      if (text) {
        status.hidden = false;
        status.textContent = text;
        status.setAttribute('role', showError ? 'alert' : 'status');
        sound.setAttribute('aria-describedby', 'status');
      } else {
        status.hidden = true;
        status.textContent = '';
        status.setAttribute('role', 'status');
        sound.removeAttribute('aria-describedby');
      }
    }

    #emitError(code: MusicPillErrorCode, message: string): void {
      this.#emit('music-pill-error', { code, message });
    }

    #emit<K extends keyof MusicPillEventMap>(type: K, detail: MusicPillEventMap[K]['detail']): void {
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }
  }

  return MusicPill as unknown as MusicPillElementConstructor;
}
