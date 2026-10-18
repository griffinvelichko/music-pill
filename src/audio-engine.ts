// Browser audio engine: one HTMLAudioElement routed through a Web Audio
// GainNode for fades. It is only constructed by the custom element at runtime;
// importing this module evaluates no browser globals.

import { planEnvelope, QUICK_RAMP_SECONDS, type GainEvent } from './fade.js';
import type { AudioCoordinator, AudioOwner, SoundPreference } from './session.js';
import type {
  MusicPillAutoplayBlockedDetail,
  MusicPillErrorCode,
  PlaybackState,
  StateChangeReason,
} from './types.js';

export type EngineSettings = {
  volume: number;
  fade: number;
};

export type EngineHost = {
  onState(state: PlaybackState, previous: PlaybackState, reason: StateChangeReason): void;
  onAutoplayBlocked(reason: MusicPillAutoplayBlockedDetail['reason']): void;
  onError(code: MusicPillErrorCode, message: string): void;
};

export type EngineEnv = {
  doc: Document;
  prefs: SoundPreference;
  coordinator: AudioCoordinator;
  /** Returns a new AudioContext, or null when Web Audio is unavailable. */
  createContext: () => AudioContext | null;
  /**
   * How long to wait for a suspended AudioContext to start running before
   * declaring the attempt blocked (default 2500 ms; 1.6× that after a user
   * gesture, where a slow start is load rather than policy). A context that
   * stays suspended is never treated as successful playback.
   */
  contextWaitMs?: number;
};

/** No media-time progress for this long while "playing" counts as a stall. */
const STALL_TIMEOUT_MS = 6000;

const NETWORK_MESSAGE =
  'The audio could not be loaded. Check that the file exists and, for audio on another origin, that the server sends Access-Control-Allow-Origin.';

const DECODE_MESSAGE =
  'The audio file could not be decoded. It may be damaged or use a codec this browser does not support.';

const UNSUPPORTED_MESSAGE =
  'This browser could not play the audio file. Try an MP3, M4A/AAC, OGG, or WAV file.';

const LOAD_FAILED_MESSAGE =
  'The audio could not be loaded. Check the URL and file format; for audio on another origin, the server must send Access-Control-Allow-Origin.';

export class AudioEngine implements AudioOwner {
  readonly audio: HTMLAudioElement;
  readonly #env: EngineEnv;
  readonly #host: EngineHost;
  #settings: EngineSettings;
  #state: PlaybackState = 'idle';

  #ctx: AudioContext | null = null;
  #source: MediaElementAudioSourceNode | null = null;
  #gain: GainNode | null = null;

  /** Incremented by every start/stop/teardown; stale async work compares it. */
  #op = 0;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  /** Pending context waits; cancelled (resolved false) by #clearTimers. */
  #waiters = new Set<() => void>();
  /** Single re-armed progress watchdog (never more than one pending). */
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #lastMediaTime = -1;
  #listeners = new AbortController();
  #destroyed = false;
  #restarting = false;
  #resumeOnVisible = false;
  #errorReported = false;

  constructor(
    audio: HTMLAudioElement,
    src: { href: string; crossOrigin: boolean },
    settings: EngineSettings,
    env: EngineEnv,
    host: EngineHost,
  ) {
    this.audio = audio;
    this.#settings = { ...settings };
    this.#env = env;
    this.#host = host;

    // CORS mode must be set before src: changing it later does not refetch,
    // and Web Audio outputs silence for cross-origin media fetched without it.
    if (src.crossOrigin) audio.crossOrigin = 'anonymous';
    audio.preload = 'none';
    audio.loop = false; // looping is handled on `ended` so fades can bracket it
    audio.setAttribute('playsinline', '');
    audio.src = src.href;

    const signal = this.#listeners.signal;
    const on = (target: EventTarget, type: string, fn: () => void) =>
      target.addEventListener(type, fn, { signal });
    on(audio, 'playing', () => this.#onPlaying());
    on(audio, 'waiting', () => this.#holdGain());
    on(audio, 'seeking', () => this.#holdGain());
    on(audio, 'seeked', () => this.#onSeeked());
    on(audio, 'durationchange', () => this.#reschedule());
    on(audio, 'pause', () => this.#onExternalPause());
    on(audio, 'ended', () => this.#onEnded());
    on(audio, 'error', () => this.#onMediaError());
    on(audio, 'timeupdate', () => this.#onTimeUpdate());
    // `stalled` only means the network is slow; playback may continue from the
    // buffer. When the buffer actually runs dry the element fires `waiting`.
    on(env.doc, 'visibilitychange', () =>
      env.doc.visibilityState === 'hidden' ? this.#onHidden() : this.#onVisible(),
    );
    const win = env.doc.defaultView;
    if (win) {
      on(win, 'pagehide', () => this.#onHidden());
      on(win, 'pageshow', () => this.#onVisible());
    }
  }

  get state(): PlaybackState {
    return this.#state;
  }

  /** Runs the configured startup policy once. Never retries on its own. */
  begin(autoplay: boolean): void {
    if (this.#env.prefs.muted) {
      this.#setState('muted', 'session-muted');
      return;
    }
    if (!autoplay) {
      this.#setState('idle', 'configured');
      return;
    }
    if (!this.#env.coordinator.claimForAutoplay(this)) {
      this.#setState('idle', 'another-instance-owns-audio');
      return;
    }
    this.audio.preload = 'auto';
    void this.#start(false, 'autoplay-attempt');
  }

  /** Must be called from inside a user gesture handler. */
  enableSound(): Promise<boolean> {
    if (this.#destroyed || this.#state === 'error') return Promise.resolve(false);
    this.#env.prefs.setMuted(false);
    this.#env.coordinator.claimForUser(this);
    return this.#start(true, 'user-gesture');
  }

  mute(): void {
    this.#env.prefs.setMuted(true);
    if (this.#destroyed) return;
    this.#silence('muted', 'user-muted');
  }

  preempt(): void {
    if (this.#destroyed) return;
    if (this.#state === 'playing' || this.#state === 'starting') {
      this.#silence('paused', 'other-instance');
    } else if (this.#state !== 'muted' && this.#state !== 'error') {
      this.#op++;
      this.#setState('idle', 'other-instance');
    }
  }

  update(settings: EngineSettings): void {
    this.#settings = { ...settings };
    if (this.#state === 'playing') this.#reschedule();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#op++;
    this.#clearTimers();
    this.#listeners.abort();
    this.#env.coordinator.release(this);
    try {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load(); // releases the network connection and decoder
    } catch {
      // Ignore: element may already be detached in some environments.
    }
    try {
      this.#source?.disconnect();
      this.#gain?.disconnect();
    } catch {
      // Already disconnected.
    }
    const ctx = this.#ctx;
    this.#ctx = this.#source = this.#gain = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------

  async #start(gesture: boolean, reason: StateChangeReason): Promise<boolean> {
    if (this.#destroyed) return false;
    const token = ++this.#op;
    this.#clearTimers();
    this.#resumeOnVisible = false;
    if (!this.#ensureGraph()) return false;
    const ctx = this.#ctx!;

    this.#setGainNow(0);
    this.#setState('starting', reason);
    this.audio.preload = 'auto';

    // Both calls happen synchronously so a user gesture still counts for them,
    // even when the media has not loaded yet (play() resolves when it has).
    let play: Promise<void>;
    try {
      play = this.audio.play() ?? Promise.resolve();
    } catch (err) {
      play = Promise.reject(err);
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);

    try {
      await play;
    } catch (err) {
      if (token !== this.#op || this.#destroyed) return false;
      const name = err instanceof Error || (typeof err === 'object' && err) ? (err as { name?: unknown }).name : undefined;
      if (name === 'NotAllowedError') {
        this.#blocked('play-rejected');
      } else if (name === 'NotSupportedError') {
        this.#fail('audio-unsupported', UNSUPPORTED_MESSAGE);
      } else if (name !== 'AbortError') {
        this.#fail('audio-load-failed', LOAD_FAILED_MESSAGE);
      } else {
        this.#setState('idle', 'error');
      }
      return false;
    }
    if (token !== this.#op || this.#destroyed) return false;

    const running = await this.#waitForRunning(ctx, token, gesture);
    if (token !== this.#op || this.#destroyed) return false;
    if (!running) {
      // Media "plays" but the graph is suspended: nothing is audible. That is
      // not success. Pause so a later, unrelated resume stays silent.
      this.#blocked('context-suspended');
      return false;
    }
    this.#setState('playing', 'started');
    this.#reschedule();
    this.#armWatchdog();
    return true;
  }

  #ensureGraph(): boolean {
    if (this.#ctx && this.#gain) return true;
    let ctx: AudioContext | null = null;
    try {
      ctx = this.#env.createContext();
      if (!ctx) throw new Error('unavailable');
      const source = ctx.createMediaElementSource(this.audio);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(ctx.destination);
      this.#ctx = ctx;
      this.#source = source;
      this.#gain = gain;
    } catch {
      if (ctx) void ctx.close().catch(() => undefined);
      this.#fail(
        'fade-unavailable',
        'This browser cannot route the audio through Web Audio, so the fade and loop behaviour is unavailable. The link still works.',
      );
      return false;
    }
    // If a suspended context starts later (e.g. a pending resume() resolves on
    // some unrelated click), keep it silent unless we are meant to be playing.
    ctx.addEventListener('statechange', () => this.#onContextState(ctx), { signal: this.#listeners.signal });
    return true;
  }

  #onContextState(ctx: AudioContext): void {
    const state = ctx.state as string; // includes Safari's 'interrupted'
    if (state === 'running') {
      if (this.#state !== 'playing' && this.#state !== 'starting') void ctx.suspend().catch(() => undefined);
      return;
    }
    if (state === 'closed' || this.#state !== 'playing') return;
    // The browser suspended the graph underneath us (WebKit does this shortly
    // after the media pauses; iOS on audio interruptions). Try one resume; if
    // it does not run again, report it honestly rather than claim "playing".
    const token = this.#op;
    void ctx.resume().catch(() => undefined);
    void this.#waitForRunning(ctx, token).then((ok) => {
      if (token !== this.#op || this.#destroyed || this.#state !== 'playing') return;
      if (ok) this.#reschedule();
      else this.#silence('paused', 'interrupted');
    });
  }

  #waitForRunning(ctx: AudioContext, token: number, gesture = false): Promise<boolean> {
    if (ctx.state === 'running') return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        ctx.removeEventListener('statechange', check);
        clearTimeout(timer);
        this.#timers.delete(timer);
        this.#waiters.delete(cancel);
        resolve(ok);
      };
      const cancel = () => done(false);
      const check = () => {
        if (token !== this.#op) done(false);
        else if (ctx.state === 'running') done(true);
      };
      const base = this.#env.contextWaitMs ?? 2500;
      const timer = setTimeout(() => done(ctx.state === 'running'), gesture ? base * 1.6 : base);
      this.#timers.add(timer);
      this.#waiters.add(cancel);
      ctx.addEventListener('statechange', check);
    });
  }

  #blocked(reason: MusicPillAutoplayBlockedDetail['reason']): void {
    this.#op++;
    try {
      this.audio.pause();
    } catch {
      /* noop */
    }
    this.#setGainNow(0);
    this.#setState('blocked', 'autoplay-blocked');
    this.#host.onAutoplayBlocked(reason);
  }

  #fail(code: MusicPillErrorCode, message: string): void {
    this.#op++;
    this.#clearTimers();
    try {
      this.audio.pause();
    } catch {
      /* noop */
    }
    this.#setGainNow(0);
    this.#setState('error', 'error');
    if (!this.#errorReported) {
      this.#errorReported = true;
      this.#host.onError(code, message);
    }
  }

  /** Fades out quickly, then pauses. Used for mute, hide and preemption. */
  #silence(next: PlaybackState, reason: StateChangeReason): void {
    const wasAudible = this.#state === 'playing';
    this.#op++;
    this.#clearTimers();
    this.#restarting = false;
    if (this.#state !== 'error') this.#setState(next, reason);
    if (this.#ctx && this.#gain) {
      const now = this.#ctx.currentTime;
      this.#holdGain();
      this.#gain.gain.linearRampToValueAtTime(0, now + QUICK_RAMP_SECONDS);
    }
    const pause = () => {
      if (this.#destroyed || this.#state === 'playing' || this.#state === 'starting') return;
      try {
        this.audio.pause();
      } catch {
        /* noop */
      }
    };
    if (wasAudible) this.#after(QUICK_RAMP_SECONDS * 1000 + 20, pause);
    else pause();
  }

  #onPlaying(): void {
    if (this.#state !== 'playing') return;
    this.#restarting = false;
    this.#reschedule();
  }

  #onSeeked(): void {
    if (this.#state === 'playing' && !this.audio.paused) this.#reschedule();
  }

  #onExternalPause(): void {
    // Our own pauses change state first; `pause` also fires just before `ended`.
    if (this.#state !== 'playing' || this.audio.ended || this.#restarting) return;
    this.#op++;
    this.#holdGain();
    this.#setState('paused', 'interrupted');
  }

  #onEnded(): void {
    if (this.#state !== 'playing' || this.#destroyed) return;
    const token = this.#op;
    this.#restarting = true;
    this.#setGainNow(0); // stays at zero until playback has actually resumed
    // play() on an ended element restarts from the beginning (HTML spec), so no
    // explicit seek is needed; WebKit can stall after seek-then-play.
    let play: Promise<void>;
    try {
      play = this.audio.play() ?? Promise.resolve();
    } catch (err) {
      play = Promise.reject(err);
    }
    play.then(
      () => {
        // `playing` normally fires and reschedules; this covers browsers where
        // the promise settles after the event.
        if (token === this.#op && this.#state === 'playing' && this.#restarting) {
          this.#restarting = false;
          this.#reschedule();
        }
      },
      () => {
        if (token !== this.#op || this.#destroyed) return;
        this.#restarting = false;
        this.#fail('restart-failed', 'The audio could not restart after it finished.');
      },
    );
  }

  #onTimeUpdate(): void {
    if (this.#state !== 'playing') return;
    const t = this.audio.currentTime;
    if (t !== this.#lastMediaTime) {
      this.#lastMediaTime = t;
      this.#armWatchdog();
    }
  }

  /**
   * If media time stops advancing without a pause (a decoder or network stall
   * that never reports itself), stop claiming "playing" after a while. One
   * timer, re-armed on progress: no polling loop and nothing accumulates.
   */
  #armWatchdog(): void {
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => {
      this.#watchdog = null;
      if (this.#state === 'playing' && !this.#destroyed) this.#silence('paused', 'interrupted');
    }, STALL_TIMEOUT_MS);
  }

  #onMediaError(): void {
    if (this.#destroyed || !this.audio.error) return;
    // MediaError codes: 1 aborted, 2 network, 3 decode, 4 source not supported.
    switch (this.audio.error.code) {
      case 3:
        this.#fail('audio-decode-failed', DECODE_MESSAGE);
        break;
      case 4:
        this.#fail('audio-unsupported', UNSUPPORTED_MESSAGE);
        break;
      case 2:
        this.#fail('audio-load-failed', NETWORK_MESSAGE);
        break;
      default:
        this.#fail('audio-load-failed', LOAD_FAILED_MESSAGE);
    }
  }

  #onHidden(): void {
    if (this.#state === 'playing' || this.#state === 'starting') {
      this.#resumeOnVisible = true;
      this.#silence('paused', 'page-hidden');
      const ctx = this.#ctx;
      if (ctx) this.#after(QUICK_RAMP_SECONDS * 1000 + 40, () => void ctx.suspend().catch(() => undefined));
    }
  }

  #onVisible(): void {
    if (this.#env.doc.visibilityState === 'hidden') return;
    if (!this.#resumeOnVisible || this.#state !== 'paused') return;
    this.#resumeOnVisible = false;
    if (this.#env.prefs.muted || this.#env.coordinator.owner !== this) return;
    // A single attempt; if the browser refuses, we report blocked and stop.
    void this.#start(false, 'page-visible');
  }

  // --- gain automation --------------------------------------------------------

  #reschedule(): void {
    if (this.#state !== 'playing' || !this.#ctx || !this.#gain || this.#restarting) return;
    const ctx = this.#ctx;
    const param = this.#gain.gain;
    const now = ctx.currentTime;
    const held = this.#holdGain();
    const plan = planEnvelope({
      now,
      currentGain: held,
      target: this.#settings.volume,
      fade: this.#settings.fade,
      mediaTime: this.audio.currentTime,
      duration: this.audio.duration,
      playbackRate: this.audio.playbackRate,
    });
    applyPlan(param, plan);
  }

  /**
   * Freezes the gain at its present value and drops future automation without
   * a discontinuity. Returns that value.
   */
  #holdGain(): number {
    if (!this.#ctx || !this.#gain) return 0;
    const param = this.#gain.gain;
    const now = this.#ctx.currentTime;
    const value = param.value;
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      // Firefox: no cancelAndHoldAtTime. `value` reports the last computed
      // automation value, so re-anchoring there keeps the curve continuous.
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
    return value;
  }

  #setGainNow(value: number): void {
    if (!this.#ctx || !this.#gain) return;
    const param = this.#gain.gain;
    const now = this.#ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
  }

  #setState(next: PlaybackState, reason: StateChangeReason): void {
    const previous = this.#state;
    if (previous === next && reason !== 'source-changed') return;
    this.#state = next;
    this.#host.onState(next, previous, reason);
  }

  #after(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      fn();
    }, ms);
    this.#timers.add(timer);
  }

  #clearTimers(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    for (const cancel of [...this.#waiters]) cancel();
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    this.#watchdog = null;
  }
}

function applyPlan(param: AudioParam, plan: GainEvent[]): void {
  for (const event of plan) {
    if (event.kind === 'set') param.setValueAtTime(event.value, event.time);
    else param.linearRampToValueAtTime(event.value, event.time);
  }
}
