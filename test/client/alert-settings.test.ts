import { describe, expect, it } from 'vitest';
import {
  ALERT_STORAGE_KEY,
  DEFAULT_ALERT_SETTINGS,
  loadAlertSettings,
  normalizeAlertSettings,
  saveAlertSettings,
  simulationFlagShown,
  simulationOn,
  simulationOptionShown,
} from '../../src/client/alert-settings.js';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('alert settings', () => {
  it('defaults to a two-tone siren, 80% volume, replay off, the announcement on, a 30-minute countdown, a 12-hour clock, °F and miles', () => {
    expect(loadAlertSettings(memoryStore())).toEqual({
      siren: 'two-tone',
      volume: 0.8,
      replayAudioDuringCountdown: false,
      announcement: true,
      timeLimitMinutes: 30,
      clock: '12h',
      temperatureUnit: 'F',
      distanceUnit: 'mi',
      simulation: null,
    });
    expect(loadAlertSettings(undefined)).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const store = memoryStore();
    const saved = saveAlertSettings(store, {
      siren: 'yelp',
      volume: 0.25,
      replayAudioDuringCountdown: false,
      announcement: false,
      timeLimitMinutes: 45,
      clock: '24h',
      temperatureUnit: 'C',
      distanceUnit: 'km',
      simulation: false,
    });

    expect(loadAlertSettings(store)).toEqual(saved);
    expect(JSON.parse(store.data.get(ALERT_STORAGE_KEY)!)).toEqual(saved);
  });

  it('clamps or replaces bad values instead of failing', () => {
    expect(
      normalizeAlertSettings({
        siren: 'airhorn',
        volume: 7,
        replayAudioDuringCountdown: 'yes',
        announcement: 'no',
        timeLimitMinutes: 500,
        clock: 'metric',
        temperatureUnit: 'K',
        distanceUnit: 'furlongs',
        simulation: 'maybe',
      }),
    ).toEqual({
      siren: 'two-tone',
      volume: 1,
      replayAudioDuringCountdown: false,
      announcement: true,
      timeLimitMinutes: 30,
      clock: '12h',
      temperatureUnit: 'F',
      distanceUnit: 'mi',
      simulation: null,
    });
    expect(normalizeAlertSettings({ volume: -1, timeLimitMinutes: 2.5 })).toMatchObject({ volume: 0, timeLimitMinutes: 30 });
    expect(normalizeAlertSettings({ siren: 'none', timeLimitMinutes: 120 })).toMatchObject({ siren: 'none', timeLimitMinutes: 120 });
  });

  it('keeps a saved announcement choice', () => {
    const store = memoryStore({ [ALERT_STORAGE_KEY]: JSON.stringify({ announcement: false }) });
    expect(loadAlertSettings(store).announcement).toBe(false);
  });

  it('keeps a saved replay choice', () => {
    const store = memoryStore({ [ALERT_STORAGE_KEY]: JSON.stringify({ replayAudioDuringCountdown: true }) });
    expect(loadAlertSettings(store).replayAudioDuringCountdown).toBe(true);
  });

  it('keeps a saved clock and temperature choice', () => {
    const store = memoryStore({ [ALERT_STORAGE_KEY]: JSON.stringify({ clock: '24h', temperatureUnit: 'C' }) });
    expect(loadAlertSettings(store)).toMatchObject({ clock: '24h', temperatureUnit: 'C', siren: 'two-tone' });
  });

  it('follows TEST_MODE for Simulation mode until the device chooses, where ALLOW_SIMULATION offers it', () => {
    const allowed = (testMode: boolean) => ({ testMode, allowSimulation: true });
    expect(simulationOn(DEFAULT_ALERT_SETTINGS, allowed(true))).toBe(true);
    expect(simulationOn(DEFAULT_ALERT_SETTINGS, allowed(false))).toBe(false);
    const store = memoryStore();
    const off = saveAlertSettings(store, { ...DEFAULT_ALERT_SETTINGS, simulation: false });
    expect(simulationOn(loadAlertSettings(store), allowed(true))).toBe(false);
    expect(simulationOn({ ...off, simulation: true }, allowed(false))).toBe(true);
  });

  it('never simulates without ALLOW_SIMULATION, whatever the device saved', () => {
    const notAllowed = { testMode: true, allowSimulation: false };
    expect(simulationOn(DEFAULT_ALERT_SETTINGS, notAllowed)).toBe(false);
    expect(simulationOn({ ...DEFAULT_ALERT_SETTINGS, simulation: true }, notAllowed)).toBe(false);
    expect(simulationOptionShown(notAllowed)).toBe(false);
    expect(simulationFlagShown(notAllowed, true)).toBe(false);
    expect(simulationFlagShown(notAllowed, false)).toBe(false);
  });

  it('offers the Simulation mode checkbox when ALLOW_SIMULATION is on, even if this device turns it off', () => {
    const allowed = { testMode: true, allowSimulation: true };
    expect(simulationOptionShown(allowed)).toBe(true);
    expect(simulationOn({ ...DEFAULT_ALERT_SETTINGS, simulation: false }, allowed)).toBe(false);
    expect(simulationFlagShown(allowed, true)).toBe(true);
    expect(simulationFlagShown(allowed, false)).toBe(false);
  });

  it('survives unreadable storage', () => {
    expect(loadAlertSettings(memoryStore({ [ALERT_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_ALERT_SETTINGS);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadAlertSettings(throwing)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(() => saveAlertSettings(throwing, DEFAULT_ALERT_SETTINGS)).not.toThrow();
  });
});
