import { describe, expect, it } from 'vitest';
import { ALERT_STORAGE_KEY, DEFAULT_ALERT_SETTINGS, loadAlertSettings, normalizeAlertSettings, saveAlertSettings } from '../../src/client/alert-settings.js';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('alert settings', () => {
  it('defaults to a two-tone siren, 80% volume, replay off, a 30-minute countdown, a 12-hour clock and °F', () => {
    expect(loadAlertSettings(memoryStore())).toEqual({
      siren: 'two-tone',
      volume: 0.8,
      replayAudioDuringCountdown: false,
      timeLimitMinutes: 30,
      clock: '12h',
      temperatureUnit: 'F',
    });
    expect(loadAlertSettings(undefined)).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const store = memoryStore();
    const saved = saveAlertSettings(store, {
      siren: 'yelp',
      volume: 0.25,
      replayAudioDuringCountdown: false,
      timeLimitMinutes: 45,
      clock: '24h',
      temperatureUnit: 'C',
    });

    expect(loadAlertSettings(store)).toEqual(saved);
    expect(JSON.parse(store.data.get(ALERT_STORAGE_KEY)!)).toEqual(saved);
  });

  it('clamps or replaces bad values instead of failing', () => {
    expect(
      normalizeAlertSettings({ siren: 'airhorn', volume: 7, replayAudioDuringCountdown: 'yes', timeLimitMinutes: 500, clock: 'metric', temperatureUnit: 'K' }),
    ).toEqual({
      siren: 'two-tone',
      volume: 1,
      replayAudioDuringCountdown: false,
      timeLimitMinutes: 30,
      clock: '12h',
      temperatureUnit: 'F',
    });
    expect(normalizeAlertSettings({ volume: -1, timeLimitMinutes: 2.5 })).toMatchObject({ volume: 0, timeLimitMinutes: 30 });
    expect(normalizeAlertSettings({ siren: 'none', timeLimitMinutes: 120 })).toMatchObject({ siren: 'none', timeLimitMinutes: 120 });
  });

  it('keeps a saved replay choice', () => {
    const store = memoryStore({ [ALERT_STORAGE_KEY]: JSON.stringify({ replayAudioDuringCountdown: true }) });
    expect(loadAlertSettings(store).replayAudioDuringCountdown).toBe(true);
  });

  it('keeps a saved clock and temperature choice', () => {
    const store = memoryStore({ [ALERT_STORAGE_KEY]: JSON.stringify({ clock: '24h', temperatureUnit: 'C' }) });
    expect(loadAlertSettings(store)).toMatchObject({ clock: '24h', temperatureUnit: 'C', siren: 'two-tone' });
  });

  it('survives unreadable storage', () => {
    expect(loadAlertSettings(memoryStore({ [ALERT_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_ALERT_SETTINGS);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadAlertSettings(throwing)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(() => saveAlertSettings(throwing, DEFAULT_ALERT_SETTINGS)).not.toThrow();
  });
});
