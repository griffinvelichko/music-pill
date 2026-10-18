// Deterministic fakes for engine unit tests. These prove state-machine logic
// only; real playback is proven by the Playwright suite in tests/e2e.

export type ParamCall = { method: string; value?: number; time: number };

export class FakeParam {
  value = 1;
  calls: ParamCall[] = [];
  setValueAtTime(value: number, time: number) {
    this.calls.push({ method: 'set', value, time });
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: 'ramp', value, time });
  }
  cancelScheduledValues(time: number) {
    this.calls.push({ method: 'cancel', time });
  }
  cancelAndHoldAtTime(time: number) {
    this.calls.push({ method: 'hold', time });
  }
  lastRampTarget(): number | undefined {
    const ramps = this.calls.filter((c) => c.method === 'ramp');
    return ramps[ramps.length - 1]?.value;
  }
}

export class FakeNode {
  connected: unknown[] = [];
  connect(n: unknown) {
    this.connected.push(n);
    return n;
  }
  disconnect() {
    this.connected = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam();
}

export class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState;
  currentTime = 10;
  destination = new FakeNode();
  gainNode: FakeGain | null = null;
  resumeCalls = 0;
  /** What resume() does: 'run' starts immediately; 'hang' never settles. */
  resumeBehaviour: 'run' | 'hang';

  constructor(initial: AudioContextState = 'running', resumeBehaviour: 'run' | 'hang' = 'run') {
    super();
    this.state = initial;
    this.resumeBehaviour = resumeBehaviour;
    FakeAudioContext.instances.push(this);
  }
  createMediaElementSource() {
    return new FakeNode();
  }
  createGain() {
    this.gainNode = new FakeGain();
    return this.gainNode;
  }
  resume() {
    this.resumeCalls++;
    if (this.resumeBehaviour === 'hang') return new Promise<void>(() => undefined);
    this.setState('running');
    return Promise.resolve();
  }
  suspend() {
    this.setState('suspended');
    return Promise.resolve();
  }
  close() {
    this.setState('closed');
    return Promise.resolve();
  }
  setState(s: AudioContextState) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new Event('statechange'));
  }
}

type PlayOutcome = 'resolve' | 'reject-not-allowed' | 'reject-not-supported' | 'pending';

export class FakeMedia extends EventTarget {
  src = '';
  crossOrigin: string | null = null;
  preload = '';
  loop = false;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 6;
  playbackRate = 1;
  error: { code: number } | null = null;
  playCalls = 0;
  pauseCalls = 0;
  srcSetBeforeCrossOrigin = false;
  nextPlay: PlayOutcome = 'resolve';
  pendingResolve: (() => void) | null = null;
  pendingReject: (() => void) | null = null;
  attributes = new Map<string, string>();

  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  }
  removeAttribute(k: string) {
    this.attributes.delete(k);
    if (k === 'src') this.src = '';
  }
  load() {}
  remove() {}
  play(): Promise<void> {
    this.playCalls++;
    if (this.ended) this.currentTime = 0; // play() on an ended element restarts
    this.ended = false;
    const outcome = this.nextPlay;
    if (outcome === 'reject-not-allowed') {
      return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    }
    if (outcome === 'reject-not-supported') {
      return Promise.reject(new DOMException('nope', 'NotSupportedError'));
    }
    if (outcome === 'pending') {
      return new Promise((resolve, reject) => {
        this.pendingReject = () => {
          this.pendingResolve = this.pendingReject = null;
          reject(new DOMException('interrupted', 'AbortError'));
        };
        this.pendingResolve = () => {
          this.pendingResolve = this.pendingReject = null;
          this.paused = false;
          resolve();
          this.dispatchEvent(new Event('playing'));
        };
      });
    }
    this.paused = false;
    this.ended = false;
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls++;
    // Like browsers: pausing rejects a pending play() with AbortError.
    this.pendingReject?.();
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  finish() {
    this.currentTime = this.duration;
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('ended'));
  }
  fail() {
    this.error = { code: 4 };
    this.dispatchEvent(new Event('error'));
  }
}

/** Wraps FakeMedia so assignment order of crossOrigin/src can be observed. */
export function trackCorsOrder(media: FakeMedia): FakeMedia {
  let src = '';
  Object.defineProperty(media, 'src', {
    get: () => src,
    set: (v: string) => {
      src = v;
      if (v && media.crossOrigin === null) media.srcSetBeforeCrossOrigin = true;
    },
  });
  return media;
}

export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};
