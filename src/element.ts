// The <music-pill> element. The class is created inside createMusicPillClass(),
// which only runs from registerMusicPill() in a browser, so importing this
// module never evaluates HTMLElement.

import { AudioEngine } from './audio-engine.js';
import { PLACEHOLDER_ICON, SOUND_OFF_ICON, SOUND_ON_ICON, SPOTIFY_ICON } from './icons.js';
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
import { STYLES } from './styles.js';
import type {
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
  <button class="sound" part="sound-button" type="button" hidden>${SOUND_OFF_ICON}${SOUND_ON_ICON}</button>
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
  iconOn: SVGElement;
  iconOff: SVGElement;
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
    #invalidAudioReported: string | null = null;

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
        iconOn: q('[data-icon="on"]'),
        iconOff: q('[data-icon="off"]'),
      };
      this.#p.sound.addEventListener('click', () => this.#onSoundClick());
      this.#updateSoundButton('none');
    }

    get playbackState(): PlaybackState {
      return this.#engine?.state ?? 'none';
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
      this.#queueRender();
    }

    disconnectedCallback(): void {
      // Defer teardown: a synchronous move (remove + insert, as frameworks do
      // when reordering) reconnects before this runs and keeps audio intact.
      queueMicrotask(() => {
        if (!this.isConnected) this.#teardownAudio(false);
      });
    }

    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue !== newValue) this.#queueRender();
    }

    // -------------------------------------------------------------------------

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

      // Audio.
      const base = this.ownerDocument.baseURI;
      const rawAudio = this.getAttribute('audio-src');
      const audio = resolveResourceUrl(rawAudio, base, 'audio/');
      if (rawAudio && rawAudio.trim() && !audio) {
        if (this.#invalidAudioReported !== rawAudio) {
          this.#invalidAudioReported = rawAudio;
          this.#emitError('invalid-audio-src', 'audio-src must be an http(s), blob: or data:audio/ URL.');
        }
      } else {
        this.#invalidAudioReported = null;
      }
      const builtInControl = parseSoundControl(this.getAttribute('sound-control')) === 'built-in';
      const showButton = Boolean(audio) && builtInControl;
      p.sound.hidden = !showButton;
      p.sep.hidden = !showButton;
      if (showButton) p.root.dataset.sound = '';
      else delete p.root.dataset.sound;

      const settings = {
        volume: parseVolume(this.getAttribute('volume')),
        fade: parseFadeDuration(this.getAttribute('fade-duration')),
      };
      const songKey = `${spotifyUrl}\n${audio?.href ?? ''}`;
      p.root.hidden = false;

      if (songKey === this.#songKey && (this.#engine || !audio)) {
        this.#engine?.update(settings);
        return;
      }

      // The song changed (or this is the first render): invalidate all audio
      // work belonging to the previous song before starting anything new.
      const hadEngine = this.#teardownAudio(true);
      this.#songKey = songKey;
      if (audio) {
        const el = this.ownerDocument.createElement('audio');
        el.hidden = true;
        this.#shadow.append(el);
        this.#engine = new AudioEngine(
          el,
          audio,
          settings,
          {
            doc: this.ownerDocument,
            prefs: shared.prefs,
            coordinator: shared.coordinator,
            createContext: shared.createContext,
          },
          {
            onState: (state, previous, reason) => this.#onEngineState(state, previous, reason),
            onAutoplayBlocked: (reason) => this.#emit('music-pill-autoplay-blocked', { reason }),
            onError: (code, message) => this.#emitError(code, message),
          },
        );
      }
      this.#updateSoundButton(this.playbackState);
      this.#emit('music-pill-ready', { spotifyUrl, hasAudio: Boolean(audio) });
      if (hadEngine && !audio) {
        this.#emit('music-pill-statechange', { state: 'none', previousState: hadEngine, reason: 'source-changed' });
      }
      this.#engine?.begin(parseAutoplay(this.getAttribute('autoplay')) === 'attempt');
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
      this.#updateSoundButton('none');
      return previous;
    }

    #onSoundClick(): void {
      const engine = this.#engine;
      if (!engine) return;
      const state = engine.state;
      if (state === 'playing' || state === 'starting') engine.mute();
      else void engine.enableSound();
    }

    #onEngineState(state: PlaybackState, previous: PlaybackState, reason: StateChangeReason): void {
      this.#updateSoundButton(state);
      this.#emit('music-pill-statechange', { state, previousState: previous, reason });
    }

    #updateSoundButton(state: PlaybackState): void {
      const { sound, iconOn, iconOff } = this.#p;
      const on = state === 'playing' || state === 'starting';
      sound.disabled = state === 'error';
      sound.setAttribute(
        'aria-label',
        state === 'error' ? 'Website sound unavailable' : on ? 'Mute website sound' : 'Enable website sound',
      );
      iconOn.toggleAttribute('hidden', !on);
      iconOff.toggleAttribute('hidden', on);
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
