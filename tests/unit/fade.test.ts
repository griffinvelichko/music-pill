import { describe, expect, it } from 'vitest';
import { effectiveFade, END_GUARD_SECONDS, planEnvelope, type GainEvent } from '../../src/fade';

const base = { now: 100, currentGain: 0, target: 0.25, fade: 1.5, mediaTime: 0, duration: 6, playbackRate: 1 };

function valueAt(events: GainEvent[], t: number): number {
  let prev = events[0]!;
  for (const e of events.slice(1)) {
    if (t <= e.time) {
      const span = e.time - prev.time;
      return span <= 0 ? e.value : prev.value + ((e.value - prev.value) * (t - prev.time)) / span;
    }
    prev = e;
  }
  return prev.value;
}

describe('effectiveFade', () => {
  it('keeps the requested fade for long or unknown durations', () => {
    expect(effectiveFade(1.5, 180)).toBe(1.5);
    expect(effectiveFade(1.5, NaN)).toBe(1.5);
    expect(effectiveFade(1.5, Infinity)).toBe(1.5);
  });
  it('clamps so fade-in and fade-out never overlap in short tracks', () => {
    expect(effectiveFade(1.5, 1)).toBeCloseTo((1 - END_GUARD_SECONDS) / 2);
    expect(effectiveFade(10, 0.5)).toBeLessThanOrEqual(0.25);
    expect(effectiveFade(-1, 10)).toBe(0);
  });
});

describe('planEnvelope', () => {
  it('fades in from zero, holds, then fades to zero before the end', () => {
    const plan = planEnvelope(base);
    expect(plan[0]).toEqual({ kind: 'set', value: 0, time: 100 });
    expect(valueAt(plan, 100.75)).toBeCloseTo(0.125);
    expect(valueAt(plan, 101.5)).toBeCloseTo(0.25);
    expect(valueAt(plan, 103)).toBeCloseTo(0.25);
    const end = 100 + 6 - END_GUARD_SECONDS;
    expect(plan.at(-1)).toEqual({ kind: 'ramp', value: 0, time: end });
    expect(valueAt(plan, end - 0.75)).toBeCloseTo(0.125);
  });

  it('is continuous: starts exactly at the current gain', () => {
    const plan = planEnvelope({ ...base, currentGain: 0.1, mediaTime: 2 });
    expect(plan[0]).toEqual({ kind: 'set', value: 0.1, time: 100 });
    // Proportional fade: 60% of the way left -> 0.9 s.
    expect(plan[1]!.time).toBeCloseTo(100.9);
  });

  it('never overlaps fades in a 1 s track', () => {
    const plan = planEnvelope({ ...base, duration: 1 });
    const times = plan.map((e) => e.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Math.max(...plan.map((e) => e.value))).toBeCloseTo(0.25);
  });

  it('ramps straight to zero when resuming inside the fade-out window', () => {
    const plan = planEnvelope({ ...base, currentGain: 0.25, mediaTime: 5 });
    expect(plan).toHaveLength(2);
    expect(plan[1]).toMatchObject({ kind: 'ramp', value: 0 });
  });

  it('only fades in for unknown or infinite durations', () => {
    const plan = planEnvelope({ ...base, duration: Infinity });
    expect(plan).toHaveLength(2);
    expect(plan[1]).toMatchObject({ kind: 'ramp', value: 0.25 });
  });

  it('accounts for playback rate', () => {
    const plan = planEnvelope({ ...base, playbackRate: 2 });
    expect(plan.at(-1)!.time).toBeCloseTo(100 + (6 - END_GUARD_SECONDS) / 2);
  });

  it('ramps down quickly when lowering the volume', () => {
    const plan = planEnvelope({ ...base, currentGain: 0.8, target: 0.2, mediaTime: 1 });
    expect(plan[1]).toMatchObject({ kind: 'ramp', value: 0.2 });
    expect(plan[1]!.time - 100).toBeLessThan(0.1);
  });
});
