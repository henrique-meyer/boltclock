import { describe, expect, it } from 'vitest';
import {
  createDisplayState,
  displayView,
  type DisplayEvent,
  type DisplayInput,
  type DisplaySettings,
  type DisplayState,
  type Flash,
  type Heartbeat,
  formatCountdown,
  KM_PER_MILE,
  radiusKm,
  rebuildDisplayState,
  step,
  timeLimitMs,
} from '../../src/shared/display-state.js';
import { EARTH_RADIUS_KM } from '../../src/shared/geo.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 15, 20, 0, 0);
const POINT = { lat: 28.5, lon: -81.4 };
const KM_PER_DEGREE = (EARTH_RADIUS_KM * Math.PI) / 180;

function settings(overrides: Partial<DisplaySettings> = {}): DisplaySettings {
  return {
    point: POINT,
    radius: { value: 10, unit: 'mi' },
    timeLimitMinutes: 30,
    replayAudioDuringCountdown: false,
    ...overrides,
  };
}

/** A flash `km` due north of the point (great-circle distance along the meridian). */
function flash(id: string, timeMs: number, km: number): Flash {
  return { id, timeMs, lat: POINT.lat + km / KM_PER_DEGREE, lon: POINT.lon };
}

/** A heartbeat from a server whose newest GLM file ended `ageMs` before its clock read `serverTimeMs`. */
function hb(serverTimeMs: number, ageMs = 40_000): Heartbeat {
  return { latestFileEndMs: serverTimeMs - ageMs, serverTimeMs };
}

const heartbeat = (serverTimeMs: number, ageMs?: number): DisplayInput => ({
  type: 'heartbeat',
  heartbeat: hb(serverTimeMs, ageMs),
});

const flashes = (...list: Flash[]): DisplayInput => ({ type: 'flashes', flashes: list });
const tick: DisplayInput = { type: 'tick' };

/** Steps through [input, display time] pairs and collects every event. */
function run(state: DisplayState, inputs: [DisplayInput, number][]): { state: DisplayState; events: DisplayEvent[] } {
  const events: DisplayEvent[] = [];
  for (const [input, nowMs] of inputs) {
    const result = step(state, input, nowMs);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/** Fresh data from `start`: a heartbeat at that time, so the data is fresh for the next 2 min 20 s. */
function fresh(s: DisplaySettings, start = T0): DisplayState {
  return step(createDisplayState(s), heartbeat(start), start).state;
}

describe('NORMAL to ALERT', () => {
  it('starts NORMAL, and stale until the first heartbeat', () => {
    const state = createDisplayState(settings());
    expect(displayView(state, T0)).toEqual({
      mode: 'NORMAL',
      countdown: null,
      countdownRemainingMs: null,
      latestStrike: null,
      stale: true,
      sessionEnded: false,
    });
    expect(displayView(fresh(settings()), T0).stale).toBe(false);
  });

  it('alerts on a flash within the radius and counts down from the strike time, not the arrival time', () => {
    // Struck at T0, arrived a minute later.
    const { state, events } = run(fresh(settings()), [[flashes(flash('a', T0, 8)), T0 + MIN]]);
    expect(events).toEqual([{ type: 'alert', distance: 5, unit: 'mi', flashId: 'a' }]);
    expect(state.mode).toBe('ALERT');
    expect(state.countdownEndMs).toBe(T0 + 30 * MIN);
    expect(displayView(state, T0 + MIN)).toMatchObject({ mode: 'ALERT', countdown: '29:00', stale: false });
  });

  it('ignores flashes outside the radius', () => {
    const { state, events } = run(fresh(settings()), [[flashes(flash('far', T0, 17)), T0]]);
    expect(events).toEqual([]);
    expect(state.mode).toBe('NORMAL');
    expect(displayView(state, T0).latestStrike).toBeNull();
  });

  it('uses the radius in the unit it was entered in', () => {
    const km = settings({ radius: { value: 10, unit: 'km' } });
    expect(run(fresh(km), [[flashes(flash('out', T0, 12)), T0]]).events).toEqual([]);
    expect(run(fresh(km), [[flashes(flash('in', T0, 9)), T0]]).events).toEqual([
      { type: 'alert', distance: 9, unit: 'km', flashId: 'in' },
    ]);
  });

  it('caps the radius at 100 mi or the km equivalent', () => {
    expect(radiusKm(settings({ radius: { value: 150, unit: 'mi' } }))).toBeCloseTo(100 * KM_PER_MILE, 9);
    const km = settings({ radius: { value: 200, unit: 'km' } });
    expect(radiusKm(km)).toBeCloseTo(160.9344, 9);
    expect(run(fresh(km), [[flashes(flash('beyond-cap', T0, 162)), T0]]).events).toEqual([]);
    expect(run(fresh(km), [[flashes(flash('inside-cap', T0, 160)), T0]]).events).toHaveLength(1);
  });

  it('raises one alert per message, with the nearest new flash', () => {
    const { events } = run(fresh(settings()), [
      [flashes(flash('a', T0, 14), flash('b', T0 + 2_000, 3), flash('c', T0 + 4_000, 9)), T0 + 30_000],
    ]);
    expect(events).toEqual([{ type: 'alert', distance: 2, unit: 'mi', flashId: 'b' }]);
  });

  it('ignores flashes with missing coordinates or times', () => {
    const bad = { id: 'bad', timeMs: Number.NaN, lat: POINT.lat, lon: POINT.lon };
    expect(run(fresh(settings()), [[flashes(bad), T0]]).events).toEqual([]);
  });
});

describe('distance rounding', () => {
  // One degree north is 111.195 km, 69.09 mi.
  it('rounds miles to a whole number', () => {
    const s = settings({ radius: { value: 100, unit: 'mi' } });
    const { events, state } = run(fresh(s), [[flashes(flash('a', T0, KM_PER_DEGREE)), T0]]);
    expect(events[0]).toMatchObject({ distance: 69, unit: 'mi' });
    expect(displayView(state, T0).latestStrike).toEqual({ distance: 69, unit: 'mi' });
  });

  it('rounds kilometres to a whole number', () => {
    const s = settings({ radius: { value: 150, unit: 'km' } });
    const { events } = run(fresh(s), [[flashes(flash('a', T0, KM_PER_DEGREE)), T0]]);
    expect(events[0]).toMatchObject({ distance: 111, unit: 'km' });
  });

  it('rounds half up and reports 0 under half a unit', () => {
    const s = settings();
    expect(run(fresh(s), [[flashes(flash('a', T0, 2.51 * KM_PER_MILE)), T0]]).events[0]).toMatchObject({ distance: 3 });
    expect(run(fresh(s), [[flashes(flash('b', T0, 2.49 * KM_PER_MILE)), T0]]).events[0]).toMatchObject({ distance: 2 });
    expect(run(fresh(s), [[flashes(flash('c', T0, 0.3)), T0]]).events[0]).toMatchObject({ distance: 0 });
  });
});

describe('ALERT plus another flash', () => {
  it('extends the countdown to the newer strike time plus the limit, silently with replay off', () => {
    const { state, events } = run(fresh(settings()), [
      [flashes(flash('a', T0, 8)), T0],
      [flashes(flash('b', T0 + 5 * MIN, 12)), T0 + 5 * MIN],
    ]);
    expect(events.map((e) => e.type)).toEqual(['alert']);
    expect(state.countdownEndMs).toBe(T0 + 35 * MIN);
    expect(displayView(state, T0 + 5 * MIN).countdown).toBe('30:00');
  });

  it('raises a repeat with the new distance when replay is on', () => {
    const { events } = run(fresh(settings({ replayAudioDuringCountdown: true })), [
      [flashes(flash('a', T0, 8)), T0],
      [flashes(flash('b', T0 + MIN, 12)), T0 + MIN],
    ]);
    expect(events).toEqual([
      { type: 'alert', distance: 5, unit: 'mi', flashId: 'a' },
      { type: 'repeat', distance: 7, unit: 'mi', flashId: 'b' },
    ]);
  });

  it('never shortens the countdown when an earlier strike arrives late', () => {
    const { state } = run(fresh(settings()), [
      [flashes(flash('new', T0 + 2 * MIN, 8)), T0 + 2 * MIN],
      [flashes(flash('late', T0, 8)), T0 + 2 * MIN + 10_000],
    ]);
    expect(state.countdownEndMs).toBe(T0 + 32 * MIN);
  });
});

describe('all-clear', () => {
  it('returns to NORMAL once the countdown expires with fresh data', () => {
    const start = run(fresh(settings()), [[flashes(flash('a', T0, 8)), T0]]).state;
    const before = run(start, [[heartbeat(T0 + 30 * MIN - 1_000), T0 + 30 * MIN - 1_000]]);
    expect(before.events).toEqual([]);
    expect(displayView(before.state, T0 + 30 * MIN - 1_000).countdown).toBe('00:01');

    const at = run(before.state, [[tick, T0 + 30 * MIN]]);
    expect(at.events).toEqual([{ type: 'all-clear' }]);
    expect(displayView(at.state, T0 + 30 * MIN)).toMatchObject({ mode: 'NORMAL', countdown: null, latestStrike: null });

    // Only once.
    expect(run(at.state, [[tick, T0 + 30 * MIN + 1_000]]).events).toEqual([]);
  });

  it('clears before a new strike in the same step starts the next alert', () => {
    const { events } = run(fresh(settings()), [
      [flashes(flash('a', T0, 8)), T0],
      [heartbeat(T0 + 29 * MIN), T0 + 29 * MIN],
      [flashes(flash('b', T0 + 30 * MIN + 10_000, 8)), T0 + 30 * MIN + 30_000],
    ]);
    expect(events.map((e) => e.type)).toEqual(['alert', 'all-clear', 'alert']);
  });
});

describe('STALE overlay', () => {
  it('is fresh at exactly 3 minutes of data age and stale after it', () => {
    const state = step(createDisplayState(settings()), heartbeat(T0, 3 * MIN), T0).state;
    expect(displayView(state, T0).stale).toBe(false);
    expect(displayView(state, T0 + 1).stale).toBe(true);
  });

  it('goes stale when heartbeats stop, as the newest file ages on the clock', () => {
    const state = fresh(settings());
    expect(displayView(state, T0 + 2 * MIN).stale).toBe(false);
    expect(displayView(state, T0 + 3 * MIN).stale).toBe(true);
  });

  it('is stale while heartbeats arrive but the newest file is old', () => {
    const state = step(createDisplayState(settings()), heartbeat(T0, 10 * MIN), T0).state;
    expect(displayView(state, T0).stale).toBe(true);
  });

  it('suppresses all-clear while stale and announces it once fresh data returns', () => {
    const alert = run(fresh(settings()), [
      [flashes(flash('a', T0, 8)), T0],
      [heartbeat(T0 + 20 * MIN), T0 + 20 * MIN], // the last heartbeat for a while
    ]).state;

    const stale = run(alert, [
      [tick, T0 + 30 * MIN],
      [tick, T0 + 40 * MIN],
    ]);
    expect(stale.events).toEqual([]);
    expect(displayView(stale.state, T0 + 40 * MIN)).toMatchObject({ mode: 'ALERT', countdown: '00:00', stale: true });

    // A heartbeat that still reports old data does not clear.
    const stillStale = run(stale.state, [[heartbeat(T0 + 41 * MIN, 5 * MIN), T0 + 41 * MIN]]);
    expect(stillStale.events).toEqual([]);

    const recovered = run(stillStale.state, [[heartbeat(T0 + 45 * MIN), T0 + 45 * MIN]]);
    expect(recovered.events).toEqual([{ type: 'all-clear' }]);
    expect(displayView(recovered.state, T0 + 45 * MIN)).toMatchObject({ mode: 'NORMAL', stale: false });
  });

  it('never clears before the first heartbeat', () => {
    const { events, state } = run(createDisplayState(settings()), [
      [flashes(flash('a', T0, 8)), T0],
      [tick, T0 + 31 * MIN],
      [tick, T0 + 90 * MIN],
    ]);
    expect(events.map((e) => e.type)).toEqual(['alert']);
    expect(state.mode).toBe('ALERT');
  });

  it('stays stale after the session ends, whatever arrives later', () => {
    const { events, state } = run(fresh(settings()), [
      [flashes(flash('a', T0, 8)), T0],
      [{ type: 'session-ended' }, T0 + MIN],
      [heartbeat(T0 + 31 * MIN), T0 + 31 * MIN],
      [tick, T0 + 32 * MIN],
    ]);
    expect(events.map((e) => e.type)).toEqual(['alert']);
    expect(displayView(state, T0 + 32 * MIN)).toMatchObject({ mode: 'ALERT', stale: true, sessionEnded: true });
  });
});

describe('dedupe and old flashes', () => {
  it('ignores a flash it has already seen, even with replay on', () => {
    const s = settings({ replayAudioDuringCountdown: true });
    const { events } = run(fresh(s), [
      [flashes(flash('a', T0, 8)), T0],
      [flashes(flash('a', T0, 8)), T0 + 20_000],
    ]);
    expect(events.map((e) => e.type)).toEqual(['alert']);
  });

  it('ignores flashes older than the time limit', () => {
    const now = T0 + 31 * MIN;
    const old = run(fresh(settings(), now), [[flashes(flash('old', T0, 8)), now]]);
    expect(old.events).toEqual([]);
    expect(old.state.mode).toBe('NORMAL');

    // Exactly the limit old: its countdown would already be over.
    const edge = run(fresh(settings(), T0 + 30 * MIN), [[flashes(flash('edge', T0, 8)), T0 + 30 * MIN]]);
    expect(edge.events).toEqual([]);
  });

  it('honours a longer time limit', () => {
    const now = T0 + 45 * MIN;
    const { events, state } = run(fresh(settings({ timeLimitMinutes: 60 }), now), [[flashes(flash('a', T0, 8)), now]]);
    expect(events).toHaveLength(1);
    expect(displayView(state, now).countdown).toBe('15:00');
  });

  it('defaults the time limit to 30 minutes and caps it at 120', () => {
    expect(timeLimitMs(settings({ timeLimitMinutes: Number.NaN }))).toBe(30 * MIN);
    expect(timeLimitMs(settings({ timeLimitMinutes: 0 }))).toBe(30 * MIN);
    expect(timeLimitMs(settings({ timeLimitMinutes: 500 }))).toBe(120 * MIN);
  });

  it('shows the strike that last restarted the countdown, as the announcement does, not an earlier nearer one', () => {
    const s = settings({ replayAudioDuringCountdown: true });
    const first = run(fresh(s), [[flashes(flash('near', T0, 2)), T0]]);
    const { state, events } = run(first.state, [
      [flashes(flash('far', T0 + 10 * MIN, 12)), T0 + 10 * MIN],
      [heartbeat(T0 + 29 * MIN), T0 + 29 * MIN],
    ]);
    expect(events[0]).toMatchObject({ type: 'repeat', distance: 7, unit: 'mi' });
    expect(displayView(state, T0 + 29 * MIN).latestStrike).toEqual({ distance: 7, unit: 'mi' });

    // The nearer, older strike passing the time limit changes nothing.
    const later = run(state, [[heartbeat(T0 + 31 * MIN), T0 + 31 * MIN]]).state;
    expect(later.mode).toBe('ALERT');
    expect(displayView(later, T0 + 31 * MIN).latestStrike).toEqual({ distance: 7, unit: 'mi' });

    // Within one batch it is the nearest new flash, the one announced.
    const batch = run(later, [[flashes(flash('b1', T0 + 32 * MIN, 20), flash('b2', T0 + 32 * MIN, 4)), T0 + 32 * MIN]]);
    expect(batch.events[0]).toMatchObject({ distance: 2 });
    expect(displayView(batch.state, T0 + 32 * MIN).latestStrike).toEqual({ distance: 2, unit: 'mi' });
  });

  it('clears the latest strike with the all-clear', () => {
    const { state } = run(fresh(settings()), [
      [flashes(flash('a', T0, 8)), T0],
      [heartbeat(T0 + 30 * MIN), T0 + 30 * MIN],
    ]);
    expect(state.mode).toBe('NORMAL');
    expect(state.latestStrikeId).toBeNull();
    expect(displayView(state, T0 + 30 * MIN).latestStrike).toBeNull();
  });
});

describe('clock offset', () => {
  it('measures the countdown on the server clock when the display clock is fast', () => {
    const skew = 5 * MIN; // the display's clock reads 5 minutes ahead of the server's
    const start = step(createDisplayState(settings()), heartbeat(T0), T0 + skew).state;
    const { state } = run(start, [[flashes(flash('a', T0, 8)), T0 + skew]]);
    expect(displayView(state, T0 + skew).countdown).toBe('30:00');

    const almost = run(state, [[heartbeat(T0 + 30 * MIN - 1_000), T0 + skew + 30 * MIN - 1_000]]);
    expect(almost.events).toEqual([]);
    expect(run(almost.state, [[tick, T0 + skew + 30 * MIN]]).events).toEqual([{ type: 'all-clear' }]);
  });
});

describe('reload', () => {
  const replay = [flash('a', T0, 12), flash('b', T0 + 4 * MIN, 5), flash('far', T0 + 5 * MIN, 40)];
  const now = T0 + 10 * MIN;

  it('rebuilds an active countdown from the replayed flashes, measured from the strike time', () => {
    const state = rebuildDisplayState(settings(), replay, now, hb(now));
    expect(displayView(state, now)).toEqual({
      mode: 'ALERT',
      countdown: '24:00',
      countdownRemainingMs: 24 * MIN,
      latestStrike: { distance: 3, unit: 'mi' },
      stale: false,
      sessionEnded: false,
    });
  });

  it('does not announce on a fresh load, but the next new strike does', () => {
    const s = settings({ replayAudioDuringCountdown: true });
    const state = rebuildDisplayState(s, replay, now, hb(now));
    const next = run(state, [[flashes(flash('c', now, 6)), now + 20_000]]);
    expect(next.events).toEqual([{ type: 'repeat', distance: 4, unit: 'mi', flashId: 'c' }]);
  });

  it('does not re-announce when a reconnect replays flashes it already has', () => {
    const s = settings({ replayAudioDuringCountdown: true });
    const live = run(fresh(s, now), [[flashes(...replay), now]]);
    expect(live.events.map((e) => e.type)).toEqual(['alert']);
    const reconnect = run(live.state, [
      [heartbeat(now + MIN), now + MIN],
      [flashes(...replay), now + MIN],
    ]);
    expect(reconnect.events).toEqual([]);
    expect(reconnect.state.countdownEndMs).toBe(live.state.countdownEndMs);
  });

  it('comes back NORMAL when every replayed strike is past the limit', () => {
    const state = rebuildDisplayState(settings(), replay, T0 + 40 * MIN, hb(T0 + 40 * MIN));
    expect(displayView(state, T0 + 40 * MIN)).toMatchObject({ mode: 'NORMAL', countdown: null, stale: false });
  });

  it('stays stale until the first heartbeat when rebuilt without one', () => {
    const state = rebuildDisplayState(settings(), replay, now);
    expect(displayView(state, now)).toMatchObject({ mode: 'ALERT', stale: true });
  });
});

describe('formatCountdown', () => {
  it('shows MM:SS, rounded up to the second', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5_000)).toBe('00:00');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(59_001)).toBe('01:00');
    expect(formatCountdown(30 * MIN)).toBe('30:00');
    expect(formatCountdown(120 * MIN)).toBe('120:00');
  });
});
