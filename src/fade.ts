// Pure gain-envelope planning. The audio engine turns these plans into
// AudioParam automation scheduled against AudioContext.currentTime, so the
// math can be unit-tested without a browser.

/** Fade-outs finish this long before the media's end, to avoid an end click. */
export const END_GUARD_SECONDS = 0.03;
/** Short ramp used for mute, hide, and other "stop now" transitions. */
export const QUICK_RAMP_SECONDS = 0.06;

/**
 * Clamps a requested fade so that the fade-in and fade-out of one loop never
 * overlap. Unknown or infinite durations (e.g. live streams) leave the request
 * unchanged; such sources only fade in.
 */
export function effectiveFade(requested: number, duration: number): number {
  const fade = Number.isFinite(requested) ? Math.max(0, requested) : 0;
  if (!Number.isFinite(duration) || duration <= 0) return fade;
  const usable = Math.max(0, duration - END_GUARD_SECONDS);
  return Math.min(fade, usable / 2);
}

export type GainEvent =
  | { kind: 'set'; value: number; time: number }
  | { kind: 'ramp'; value: number; time: number };

export type EnvelopeInput = {
  /** AudioContext.currentTime when the plan is applied. */
  now: number;
  /** Gain value right now (after holding any in-flight automation). */
  currentGain: number;
  /** Target listening level (the `volume` attribute). */
  target: number;
  /** Requested fade, already sanitised. */
  fade: number;
  /** HTMLMediaElement.currentTime. */
  mediaTime: number;
  /** HTMLMediaElement.duration (NaN/Infinity allowed). */
  duration: number;
  /** HTMLMediaElement.playbackRate. */
  playbackRate: number;
};

/**
 * Plans the gain envelope for the rest of the current loop iteration, starting
 * from the present gain: fade up to `target`, hold, then fade to zero just
 * before the media ends. Every segment is a linear ramp anchored by an initial
 * `set` at the current value, so applying a plan never introduces a jump.
 */
export function planEnvelope(input: EnvelopeInput): GainEvent[] {
  const { now, target } = input;
  const current = clamp01(input.currentGain);
  const rate = input.playbackRate > 0 && Number.isFinite(input.playbackRate) ? input.playbackRate : 1;
  const fade = effectiveFade(input.fade, input.duration);
  const events: GainEvent[] = [{ kind: 'set', value: current, time: now }];

  // Fade-in time is proportional to the distance left to travel, so resuming
  // from a partial level (after a stall, say) does not restart the whole fade.
  const upDistance = target > 0 ? Math.max(0, target - current) / target : 0;
  const upSeconds = target > current ? Math.max(fade * upDistance, QUICK_RAMP_SECONDS) : QUICK_RAMP_SECONDS;

  if (!Number.isFinite(input.duration) || input.duration <= 0) {
    events.push({ kind: 'ramp', value: target, time: now + upSeconds });
    return events;
  }

  const remaining = (input.duration - input.mediaTime - END_GUARD_SECONDS) / rate;
  if (remaining <= QUICK_RAMP_SECONDS) {
    events.push({ kind: 'ramp', value: 0, time: now + QUICK_RAMP_SECONDS });
    return events;
  }
  const end = now + remaining;
  const downStart = end - fade / rate;

  if (downStart <= now) {
    // Already inside the fade-out window: ramp from wherever we are to zero.
    events.push({ kind: 'ramp', value: 0, time: end });
    return events;
  }

  const upEnd = Math.min(now + upSeconds, downStart);
  events.push({ kind: 'ramp', value: target, time: upEnd });
  if (downStart > upEnd) events.push({ kind: 'ramp', value: target, time: downStart });
  events.push({ kind: 'ramp', value: 0, time: end });
  return events;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
