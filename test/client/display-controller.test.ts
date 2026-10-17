import { describe, expect, it } from 'vitest';
import type { Announcement } from '../../src/client/audio.js';
import { DisplayController, TEST_FLASH_PREFIX } from '../../src/client/display-controller.js';
import type { DisplaySettings, Flash } from '../../src/shared/display-state.js';
import { distanceKm } from '../../src/shared/geo.js';

const POINT = { lat: 28.54, lon: -81.38 };
const SETTINGS: DisplaySettings = { point: POINT, radius: { value: 10, unit: 'mi' }, timeLimitMinutes: 30, replayAudioDuringCountdown: true };
const T0 = Date.UTC(2026, 9, 17, 15, 0, 0);

/** A flash `km` north of the point at time `t`. */
function flashNorth(id: string, km: number, t: number): Flash {
  return { id, timeMs: t, lat: POINT.lat + (km / 6371.0088) * (180 / Math.PI), lon: POINT.lon };
}

function setup() {
  const heard: Announcement[] = [];
  const controller = new DisplayController(SETTINGS, (a) => heard.push(a));
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
    const { controller, heard, beat } = setup();
    controller.flashes([], T0);
    beat(T0);
    controller.simulateStrike(T0);

    const view = controller.view(T0);
    expect(view.mode).toBe('ALERT');
    expect(view.testStrike).toBe(true);
    expect(view.countdown).toBe('30:00');
    expect(heard).toEqual([{ kind: 'strike', distance: 6, unit: 'mi' }]); // 60% of 10 mi
  });

  it('gives each simulated strike its own test id, so a second one extends the countdown', () => {
    const { controller, heard, beat } = setup();
    controller.flashes([], T0);
    beat(T0);
    controller.simulateStrike(T0);
    controller.simulateStrike(T0 + 60_000);

    expect(heard).toHaveLength(2); // replay is on: the second strike announces again
    expect(controller.view(T0 + 60_000).countdown).toBe('30:00');
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
