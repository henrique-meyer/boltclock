import { describe, expect, it } from 'vitest';
import type { Announcement } from '../../src/client/audio.js';
import { DisplayController, TEST_FLASH_PREFIX } from '../../src/client/display-controller.js';
import type { DisplaySettings, Flash } from '../../src/shared/display-state.js';
import { distanceKm } from '../../src/shared/geo.js';
import { KM_PER_MILE } from '../../src/shared/display-state.js';

const POINT = { lat: 28.54, lon: -81.38 };
const SETTINGS: DisplaySettings = { point: POINT, radius: { value: 10, unit: 'mi' }, timeLimitMinutes: 30, replayAudioDuringCountdown: true };
const T0 = Date.UTC(2026, 9, 17, 15, 0, 0);

/** A flash `km` north of the point at time `t`. */
function flashNorth(id: string, km: number, t: number): Flash {
  return { id, timeMs: t, lat: POINT.lat + (km / 6371.0088) * (180 / Math.PI), lon: POINT.lon };
}

/** Returns the given numbers in turn, as Math.random would. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function setup(settings: DisplaySettings = SETTINGS, random: () => number = Math.random) {
  const heard: Announcement[] = [];
  const controller = new DisplayController(settings, (a) => heard.push(a), random);
  const beat = (t: number) => controller.heartbeat({ latestFileEndMs: t - 20_000, serverTimeMs: t }, t);
  return { controller, heard, beat };
}

describe('DisplayController', () => {
  it('rebuilds silently from the replay on connect, showing an active countdown without the siren', () => {
    const { controller, heard, beat } = setup();
    controller.flashes([flashNorth('a', 5, T0 - 10 * 60_000)], T0);
    beat(T0);

    const view = controller.view(T0);
    expect(heard).toEqual([]);
    expect(view.mode).toBe('ALERT');
    expect(view.countdown).toBe('20:00');
  });

  it('announces a new strike after the replay, in the unit the radius was entered in', () => {
    const { controller, heard, beat } = setup();
    controller.flashes([], T0);
    beat(T0);
    controller.flashes([flashNorth('b', 8.05, T0 - 5000)], T0); // about 5 miles

    expect(heard).toEqual([{ kind: 'strike', distance: 5, unit: 'mi' }]);
    expect(controller.view(T0).mode).toBe('ALERT');
  });

  it('clears with the chime only while the data is fresh', () => {
    const { controller, heard, beat } = setup();
    controller.flashes([], T0);
    beat(T0);
    controller.flashes([flashNorth('c', 3, T0)], T0);
    heard.length = 0;

    // 31 minutes later with no heartbeat since: stale, so no all-clear.
    const later = T0 + 31 * 60_000;
    controller.tick(later);
    expect(heard).toEqual([]);
    expect(controller.view(later)).toMatchObject({ mode: 'ALERT', stale: true });

    // Fresh data arrives: the expired countdown clears.
    beat(later);
    expect(heard).toEqual([{ kind: 'all-clear' }]);
    expect(controller.view(later).mode).toBe('NORMAL');
  });

  it('simulates a strike inside the radius that alerts like a real one and is labelled', () => {
    // First random number picks the distance (5% + 90% x 0.5 = 50% of the radius), the second the direction.
    const { controller, heard, beat } = setup(SETTINGS, sequence(0.5, 0.25));
    controller.flashes([], T0);
    beat(T0);
    controller.simulateStrike(T0);

    const view = controller.view(T0);
    expect(view.mode).toBe('ALERT');
    expect(view.simulation).toBe(true);
    expect(view.countdown).toBe('30:00');
    expect(heard).toEqual([{ kind: 'strike', distance: 5, unit: 'mi' }]);
  });

  it('puts simulated strikes at random distances and directions, always inside the radius', () => {
    const settings: DisplaySettings = { ...SETTINGS, replayAudioDuringCountdown: false };
    const distances: number[] = [];
    for (const [r1, r2] of [[0, 0], [1, 0.5], [0.3, 0.9], [0.999, 0.1]]) {
      const { controller, heard, beat } = setup(settings, sequence(r1!, r2!));
      controller.flashes([], T0);
      beat(T0);
      controller.simulateStrike(T0);
      const strike = heard[0];
      expect(strike?.kind).toBe('strike');
      distances.push(strike?.kind === 'strike' ? strike.distance! : Number.NaN);
    }
    expect(distances).toEqual([1, 10, 3, 9]); // 0.5 mi rounds to 1, 9.5 mi to 10, 9.49 mi to 9
    for (const d of distances) expect(d).toBeLessThanOrEqual(10);
  });

  it('with replay off, a new strike during a countdown is the announcement only, simulated or real', () => {
    const { controller, heard, beat } = setup({ ...SETTINGS, replayAudioDuringCountdown: false }, () => 0.5);
    controller.flashes([], T0);
    beat(T0);
    controller.simulateStrike(T0);
    controller.simulateStrike(T0 + 60_000);
    controller.flashes([flashNorth('real', 3 * KM_PER_MILE, T0 + 61_000)], T0 + 61_000);

    expect(heard).toEqual([
      { kind: 'strike', distance: 5, unit: 'mi' },
      { kind: 'strike', distance: 5, unit: 'mi', speechOnly: true },
      { kind: 'strike', distance: 3, unit: 'mi', speechOnly: true },
    ]);
  });

  it('with replay on, a new strike during a countdown plays the siren again', () => {
    const { controller, heard, beat } = setup(SETTINGS, () => 0.5);
    controller.flashes([], T0);
    beat(T0);
    controller.simulateStrike(T0);
    controller.simulateStrike(T0 + 60_000);
    expect(heard.map((a) => a.kind === 'strike' && a.speechOnly)).toEqual([undefined, undefined]);
  });

  it('simulates the all-clear during a countdown, keeping real strikes for dedupe', () => {
    const { controller, heard, beat } = setup(SETTINGS, () => 0.5);
    controller.flashes([], T0);
    beat(T0);
    controller.flashes([flashNorth('real', 4, T0)], T0);
    controller.simulateStrike(T0);
    heard.length = 0;

    controller.simulateAllClear(T0);
    expect(heard).toEqual([{ kind: 'all-clear' }]);
    expect(controller.view(T0).mode).toBe('NORMAL');
    // A forced all-clear is simulated too.
    expect(controller.view(T0).simulation).toBe(true);

    // The real flash is not news again, and a second press in NORMAL does nothing.
    controller.flashes([flashNorth('real', 4, T0)], T0);
    controller.simulateAllClear(T0);
    expect(heard).toEqual([{ kind: 'all-clear' }]);
  });

  it('shows SIMULATION from either Simulate button until the screen is real again', () => {
    const { controller, beat } = setup({ ...SETTINGS, replayAudioDuringCountdown: false }, () => 0.5);
    controller.flashes([], T0);
    beat(T0);
    expect(controller.view(T0).simulation).toBe(false);

    // A countdown length after the last press, nothing simulated can still be on screen.
    controller.simulateStrike(T0);
    expect(controller.view(T0 + 29 * 60_000).simulation).toBe(true);
    expect(controller.view(T0 + 30 * 60_000).simulation).toBe(false);

    // A real strike takes over at once.
    controller.simulateStrike(T0 + 31 * 60_000);
    expect(controller.view(T0 + 31 * 60_000).simulation).toBe(true);
    controller.flashes([flashNorth('real', 4, T0 + 32 * 60_000)], T0 + 32 * 60_000);
    expect(controller.view(T0 + 32 * 60_000).simulation).toBe(false);
  });

  it('gives each simulated strike its own test id, so a second one extends the countdown', () => {
    const { controller, heard, beat } = setup(SETTINGS, () => 0.5);
    controller.flashes([], T0);
    beat(T0);
    controller.simulateStrike(T0);
    controller.simulateStrike(T0 + 60_000);

    expect(heard).toHaveLength(2); // replay is on: the second strike announces again
    expect(controller.view(T0 + 60_000).countdown).toBe('30:00');
  });

  it('shows the distance the announcement spoke, not an earlier nearer strike', () => {
    // A near test strike (5% + 90% x 0.1 = 14% of 10 mi), then a far one (5% + 90% x 0.9 = 86%).
    const { controller, heard, beat } = setup({ ...SETTINGS, replayAudioDuringCountdown: false }, sequence(0.1, 0, 0.9, 0));
    controller.flashes([], T0);
    beat(T0);
    controller.simulateStrike(T0);
    controller.simulateStrike(T0 + 60_000);

    expect(heard).toEqual([
      { kind: 'strike', distance: 1, unit: 'mi' },
      { kind: 'strike', distance: 9, unit: 'mi', speechOnly: true },
    ]);
    expect(controller.view(T0 + 60_000)).toMatchObject({ latestStrike: { distance: 9, unit: 'mi' }, simulation: true });
  });

  it('switches the distance unit in place, keeping the countdown, and announces in the new unit', () => {
    const { controller, heard, beat } = setup();
    controller.flashes([], T0);
    beat(T0);
    controller.flashes([flashNorth('a', 8.05, T0)], T0); // about 5 mi
    expect(heard).toEqual([{ kind: 'strike', distance: 5, unit: 'mi' }]);

    controller.setRadius({ value: 16.1, unit: 'km' });
    expect(controller.view(T0 + 60_000)).toMatchObject({ mode: 'ALERT', countdown: '29:00', latestStrike: { distance: 8, unit: 'km' } });

    controller.flashes([flashNorth('b', 12, T0 + 60_000)], T0 + 60_000); // replay is on in SETTINGS
    expect(heard.at(-1)).toEqual({ kind: 'strike', distance: 12, unit: 'km' });
  });

  it('keeps simulated flashes recognisable by their id prefix', () => {
    expect(TEST_FLASH_PREFIX).toBe('test-');
    expect(distanceKm(POINT.lat, POINT.lon, flashNorth('x', 9.656, T0).lat, POINT.lon)).toBeCloseTo(9.656, 3);
  });

  it('reports the data age on the server clock', () => {
    const { controller, beat } = setup();
    beat(T0);
    expect(controller.view(T0 + 5000).dataAgeSeconds).toBe(25);
  });
});
