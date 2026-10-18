import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, type EngineHost } from '../../src/audio-engine';
import { AudioCoordinator, SoundPreference } from '../../src/session';
import type { PlaybackState } from '../../src/types';
import { FakeAudioContext, FakeMedia, flush, trackCorsOrder } from './fakes';

type Log = { states: [PlaybackState, string][]; blocked: string[]; errors: string[] };

function setup(opts: {
  ctxState?: AudioContextState;
  resume?: 'run' | 'hang';
  crossOrigin?: boolean;
  prefs?: SoundPreference;
  coordinator?: AudioCoordinator;
  noWebAudio?: boolean;
  contextWaitMs?: number;
} = {}) {
  const media = trackCorsOrder(new FakeMedia());
  const log: Log = { states: [], blocked: [], errors: [] };
  const host: EngineHost = {
    onState: (s, _p, r) => log.states.push([s, r]),
    onAutoplayBlocked: (r) => log.blocked.push(r),
    onError: (c) => log.errors.push(c),
  };
  let ctx: FakeAudioContext | null = null;
  const prefs = opts.prefs ?? new SoundPreference(() => null);
  const coordinator = opts.coordinator ?? new AudioCoordinator();
  const engine = new AudioEngine(
    media as unknown as HTMLAudioElement,
    { href: 'https://cdn.example/a.wav', crossOrigin: opts.crossOrigin ?? false },
    { volume: 0.25, fade: 1.5 },
    {
      doc: document,
      prefs,
      coordinator,
      contextWaitMs: opts.contextWaitMs ?? 50,
      createContext: () => {
        if (opts.noWebAudio) return null;
        ctx = new FakeAudioContext(opts.ctxState ?? 'running', opts.resume ?? 'run');
        return ctx as unknown as AudioContext;
      },
    },
    host,
  );
  return { engine, media, log, prefs, coordinator, ctx: () => ctx! };
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  FakeAudioContext.instances = [];
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('AudioEngine startup', () => {
  it('sets crossOrigin before src for cross-origin audio', () => {
    const { media } = setup({ crossOrigin: true });
    expect(media.crossOrigin).toBe('anonymous');
    expect(media.srcSetBeforeCrossOrigin).toBe(false);
    expect(media.loop).toBe(false);
  });

  it('does no audio work when autoplay is off', () => {
    const { engine, media, log } = setup();
    engine.begin(false);
    expect(media.playCalls).toBe(0);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(media.preload).toBe('none');
    expect(engine.state).toBe('idle');
    expect(log.states).toEqual([]); // already idle: no redundant statechange
  });

  it('reaches playing only when play() resolves and the context runs', async () => {
    const { engine, ctx, log } = setup();
    engine.begin(true);
    await flush(10);
    expect(engine.state).toBe('playing');
    expect(log.states.map((s) => s[0])).toEqual(['starting', 'playing']);
    // Fade-in starts from zero and ramps to the target volume.
    const calls = ctx().gainNode!.gain.calls;
    expect(calls.some((c) => c.method === 'set' && c.value === 0)).toBe(true);
    expect(calls.some((c) => c.method === 'ramp' && c.value === 0.25)).toBe(true);
  });

  it('reports blocked when play() is rejected, and does not retry', async () => {
    const { engine, media, log } = setup();
    media.nextPlay = 'reject-not-allowed';
    engine.begin(true);
    await flush(10);
    expect(engine.state).toBe('blocked');
    expect(log.blocked).toEqual(['play-rejected']);
    // Unrelated page interaction must not start audio.
    document.body.click();
    window.dispatchEvent(new Event('scroll'));
    await flush(10);
    expect(media.playCalls).toBe(1);
    expect(engine.state).toBe('blocked');
  });

  it('treats a context that stays suspended as blocked, not playing', async () => {
    const { engine, media, ctx, log } = setup({ ctxState: 'suspended', resume: 'hang', contextWaitMs: 20 });
    engine.begin(true);
    await flush(10);
    expect(engine.state).toBe('starting');
    await new Promise((r) => setTimeout(r, 40));
    await flush();
    expect(engine.state).toBe('blocked');
    expect(log.blocked).toEqual(['context-suspended']);
    expect(media.paused).toBe(true);
    // If the pending resume later lets the context run, it is re-suspended.
    ctx().setState('running');
    await flush();
    expect(ctx().state).toBe('suspended');
  });

  it('enableSound() calls play() and resume() synchronously inside the gesture', () => {
    const { engine, media, ctx } = setup({ ctxState: 'suspended' });
    engine.begin(false);
    void engine.enableSound();
    // Nothing awaited yet: both calls already happened.
    expect(media.playCalls).toBe(1);
    expect(ctx().resumeCalls).toBe(1);
  });

  it('activation works when media readiness arrives later', async () => {
    const { engine, media } = setup();
    media.nextPlay = 'pending';
    engine.begin(false);
    const result = engine.enableSound();
    await flush();
    expect(engine.state).toBe('starting');
    media.pendingResolve!();
    expect(await result).toBe(true);
    expect(engine.state).toBe('playing');
  });

  it('reports fade-unavailable and stays silent without Web Audio', async () => {
    const { engine, media, log } = setup({ noWebAudio: true });
    engine.begin(true);
    await flush();
    expect(engine.state).toBe('error');
    expect(log.errors).toEqual(['fade-unavailable']);
    expect(media.playCalls).toBe(0);
  });

  it('reports a load failure from the media error event once', async () => {
    const { engine, media, log } = setup();
    media.nextPlay = 'pending';
    engine.begin(true);
    media.fail();
    media.fail();
    await flush();
    expect(engine.state).toBe('error');
    expect(log.errors).toEqual(['audio-load-failed']);
  });
});

describe('AudioEngine mute and preference', () => {
  it('mutes promptly, persists for the session, and wins over autoplay', async () => {
    vi.useFakeTimers();
    const prefs = new SoundPreference(() => sessionStorage);
    const a = setup({ prefs });
    a.engine.begin(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(a.engine.state).toBe('playing');
    a.engine.mute();
    expect(a.engine.state).toBe('muted');
    expect(a.ctx().gainNode!.gain.lastRampTarget()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(a.media.paused).toBe(true);
    expect(sessionStorage.getItem('music-pill:sound-off')).toBe('1');

    // A later page/instance in the same session does not autoplay.
    const b = setup({ prefs: new SoundPreference(() => sessionStorage) });
    b.engine.begin(true);
    expect(b.engine.state).toBe('muted');
    expect(b.media.playCalls).toBe(0);
  });

  it('mute stays in force across the loop restart', async () => {
    vi.useFakeTimers();
    const { engine, media } = setup();
    engine.begin(true);
    await vi.advanceTimersByTimeAsync(200);
    engine.mute();
    await vi.advanceTimersByTimeAsync(200);
    const plays = media.playCalls;
    media.finish();
    await vi.advanceTimersByTimeAsync(200);
    expect(media.playCalls).toBe(plays);
    expect(engine.state).toBe('muted');
  });

  it('enableSound clears the session mute', async () => {
    const prefs = new SoundPreference(() => sessionStorage);
    prefs.setMuted(true);
    const { engine } = setup({ prefs });
    engine.begin(true);
    expect(engine.state).toBe('muted');
    expect(await engine.enableSound()).toBe(true);
    expect(prefs.muted).toBe(false);
  });

  it('falls back to memory when storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const prefs = new SoundPreference(() => throwing);
    expect(prefs.muted).toBe(false);
    prefs.setMuted(true);
    expect(prefs.muted).toBe(true);
  });
});

describe('AudioEngine loop', () => {
  it('holds gain at zero across the restart and fades in only after playback resumes', async () => {
    const { engine, media, ctx } = setup();
    engine.begin(true);
    await flush(10);
    const gain = ctx().gainNode!.gain;
    media.nextPlay = 'pending';
    gain.calls = [];
    media.finish();
    expect(media.currentTime).toBe(0);
    expect(gain.calls.at(-1)).toMatchObject({ method: 'set', value: 0 });
    expect(gain.calls.some((c) => c.method === 'ramp' && (c.value ?? 0) > 0)).toBe(false);
    media.pendingResolve!();
    await flush();
    expect(gain.calls.some((c) => c.method === 'ramp' && c.value === 0.25)).toBe(true);
    expect(engine.state).toBe('playing');
  });

  it('does not accumulate timers across many loops', async () => {
    vi.useFakeTimers();
    const { engine, media } = setup();
    engine.begin(true);
    await vi.advanceTimersByTimeAsync(200);
    for (let i = 0; i < 20; i++) {
      media.finish();
      await vi.advanceTimersByTimeAsync(200);
    }
    // Only the single progress watchdog may be pending.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    expect(engine.state).toBe('playing');
  });

  it('stops claiming playing when media time silently stops advancing', async () => {
    vi.useFakeTimers();
    const { engine, media } = setup();
    engine.begin(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.state).toBe('playing');
    // Progress keeps it alive...
    for (let i = 0; i < 10; i++) {
      media.currentTime += 0.25;
      media.dispatchEvent(new Event('timeupdate'));
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(engine.state).toBe('playing');
    // ...a silent freeze does not.
    await vi.advanceTimersByTimeAsync(6500);
    expect(engine.state).toBe('paused');
  });

  it('holds gain while buffering instead of letting the fade-out drift', async () => {
    const { engine, media, ctx } = setup();
    engine.begin(true);
    await flush(10);
    const gain = ctx().gainNode!.gain;
    gain.calls = [];
    media.dispatchEvent(new Event('waiting'));
    expect(gain.calls[0]).toMatchObject({ method: 'hold' });
    expect(gain.calls.some((c) => c.method === 'ramp')).toBe(false);
  });

  it('reports restart-failed if the loop cannot restart', async () => {
    const { engine, media, log } = setup();
    engine.begin(true);
    await flush(10);
    media.nextPlay = 'reject-not-supported';
    media.finish();
    await flush(10);
    expect(engine.state).toBe('error');
    expect(log.errors).toEqual(['restart-failed']);
  });
});

describe('AudioEngine context suspended underneath playback', () => {
  it('resumes once if the browser suspends the context while playing', async () => {
    const { engine, ctx } = setup();
    engine.begin(true);
    await flush(10);
    ctx().setState('suspended'); // e.g. WebKit auto-suspend
    await flush(10);
    expect(ctx().state).toBe('running');
    expect(engine.state).toBe('playing');
  });

  it('reports paused, not playing, if that resume does not take', async () => {
    const { engine, ctx } = setup({ contextWaitMs: 20 });
    engine.begin(true);
    await flush(10);
    ctx().resumeBehaviour = 'hang';
    ctx().setState('suspended');
    await new Promise((r) => setTimeout(r, 200));
    expect(engine.state).toBe('paused');
    expect(ctx().resumeCalls).toBe(1); // a single attempt, no retry loop
  });
});

describe('AudioEngine page visibility', () => {
  it('pauses when hidden and resumes once when visible again', async () => {
    vi.useFakeTimers();
    const { engine, media } = setup();
    engine.begin(true);
    await vi.advanceTimersByTimeAsync(200);
    setVisibility('hidden');
    expect(engine.state).toBe('paused');
    await vi.advanceTimersByTimeAsync(200);
    expect(media.paused).toBe(true);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(200);
    expect(engine.state).toBe('playing');
  });

  it('does not resume on return if muted, or if it was not playing', async () => {
    vi.useFakeTimers();
    const blocked = setup();
    blocked.media.nextPlay = 'reject-not-allowed';
    blocked.engine.begin(true);
    await vi.advanceTimersByTimeAsync(200);
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(200);
    expect(blocked.media.playCalls).toBe(1);
    expect(blocked.engine.state).toBe('blocked');
    blocked.engine.destroy();

    const muted = setup();
    muted.engine.begin(true);
    await vi.advanceTimersByTimeAsync(200);
    setVisibility('hidden');
    muted.engine.mute();
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(200);
    expect(muted.engine.state).toBe('muted');
  });
});

describe('AudioEngine ownership and lifecycle', () => {
  it('lets only the first instance autoplay; explicit activation transfers ownership', async () => {
    vi.useFakeTimers();
    const coordinator = new AudioCoordinator();
    const a = setup({ coordinator });
    const b = setup({ coordinator });
    a.engine.begin(true);
    b.engine.begin(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(a.engine.state).toBe('playing');
    expect(b.engine.state).toBe('idle');
    expect(b.media.playCalls).toBe(0);

    await b.engine.enableSound();
    await vi.advanceTimersByTimeAsync(200);
    expect(b.engine.state).toBe('playing');
    expect(a.engine.state).toBe('paused');
    expect(a.media.paused).toBe(true);

    // Removing the owner never starts the other one.
    b.engine.destroy();
    await vi.advanceTimersByTimeAsync(200);
    expect(a.engine.state).toBe('paused');
    expect(coordinator.owner).toBeNull();
  });

  it('destroy invalidates in-flight work and releases resources', async () => {
    const { engine, media, ctx, log } = setup();
    media.nextPlay = 'pending';
    engine.begin(true);
    engine.destroy();
    media.pendingResolve?.();
    await flush(10);
    expect(log.states.map((s) => s[0])).toEqual(['starting']);
    expect(media.src).toBe('');
    expect(ctx().state).toBe('closed');
    // Listeners are gone: events after destroy do nothing.
    media.dispatchEvent(new Event('ended'));
    setVisibility('hidden');
    expect(log.states).toHaveLength(1);
  });

  it('mute during startup cancels the pending start', async () => {
    const { engine, media } = setup();
    media.nextPlay = 'pending';
    engine.begin(true);
    engine.mute();
    expect(media.pendingResolve).toBeNull(); // pause() aborted the pending play
    await flush(10);
    expect(engine.state).toBe('muted');
    expect(media.paused).toBe(true);
  });
});
