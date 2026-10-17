import { describe, expect, it } from 'vitest';
import { ALERT_STORAGE_KEY, DEFAULT_ALERT_SETTINGS, loadAlertSettings, normalizeAlertSettings, saveAlertSettings } from '../../src/client/alert-settings.js';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('alert settings', () => {
  it('defaults to a two-tone siren, 80% volume, replay on and a 30-minute countdown', () => {
    expect(loadAlertSettings(memoryStore())).toEqual({ siren: 'two-tone', volume: 0.8, replayAudioDuringCountdown: true, timeLimitMinutes: 30 });
    expect(loadAlertSettings(undefined)).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const store = memoryStore();
    const saved = saveAlertSettings(store, { siren: 'yelp', volume: 0.25, replayAudioDuringCountdown: false, timeLimitMinutes: 45 });

    expect(loadAlertSettings(store)).toEqual(saved);
    expect(JSON.parse(store.data.get(ALERT_STORAGE_KEY)!)).toEqual(saved);
  });

  it('clamps or replaces bad values instead of failing', () => {
    expect(normalizeAlertSettings({ siren: 'airhorn', volume: 7, replayAudioDuringCountdown: 'yes', timeLimitMinutes: 500 })).toEqual({
      siren: 'two-tone',
      volume: 1,
      replayAudioDuringCountdown: true,
      timeLimitMinutes: 30,
    });
    expect(normalizeAlertSettings({ volume: -1, timeLimitMinutes: 2.5 })).toMatchObject({ volume: 0, timeLimitMinutes: 30 });
    expect(normalizeAlertSettings({ siren: 'none', timeLimitMinutes: 120 })).toMatchObject({ siren: 'none', timeLimitMinutes: 120 });
  });

  it('survives unreadable storage', () => {
    expect(loadAlertSettings(memoryStore({ [ALERT_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_ALERT_SETTINGS);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadAlertSettings(throwing)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(() => saveAlertSettings(throwing, DEFAULT_ALERT_SETTINGS)).not.toThrow();
  });
});
