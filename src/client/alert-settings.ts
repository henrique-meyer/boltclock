import { DEFAULT_TIME_LIMIT_MINUTES, MAX_TIME_LIMIT_MINUTES } from '../shared/display-state.js';
import type { KeyValueStore } from './location-settings.js';

/** How the display alerts, kept on the display device next to its location (there are no accounts). */
export const ALERT_STORAGE_KEY = 'boltclock.alerts';

export const SIRENS = ['two-tone', 'mechanical', 'yelp', 'none'] as const;
export type SirenId = (typeof SIRENS)[number];

export const SIREN_LABELS: Record<SirenId, string> = {
  'two-tone': 'Two-tone (mildest)',
  mechanical: 'Mechanical wail',
  yelp: 'Yelp (most urgent)',
  none: 'No siren, announcement only',
};

export interface AlertSettings {
  siren: SirenId;
  /** 0 to 1. */
  volume: number;
  /** Replay the siren and announcement for each new strike during a countdown. The countdown restarts either way. */
  replayAudioDuringCountdown: boolean;
  /** All-clear countdown, from the latest strike's time. 1 to 120 minutes. */
  timeLimitMinutes: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  siren: 'two-tone',
  volume: 0.8,
  replayAudioDuringCountdown: true,
  timeLimitMinutes: DEFAULT_TIME_LIMIT_MINUTES,
};

/** Fills anything missing or out of range with the default, so a hand-edited or old value never breaks the display. */
export function normalizeAlertSettings(input: Partial<Record<keyof AlertSettings, unknown>>): AlertSettings {
  const siren = SIRENS.includes(input.siren as SirenId) ? (input.siren as SirenId) : DEFAULT_ALERT_SETTINGS.siren;
  const volume = Number(input.volume);
  const minutes = Number(input.timeLimitMinutes);
  return {
    siren,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_ALERT_SETTINGS.volume,
    replayAudioDuringCountdown:
      typeof input.replayAudioDuringCountdown === 'boolean' ? input.replayAudioDuringCountdown : DEFAULT_ALERT_SETTINGS.replayAudioDuringCountdown,
    timeLimitMinutes:
      Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_TIME_LIMIT_MINUTES ? minutes : DEFAULT_ALERT_SETTINGS.timeLimitMinutes,
  };
}

export function loadAlertSettings(store: KeyValueStore | undefined): AlertSettings {
  if (!store) return { ...DEFAULT_ALERT_SETTINGS };
  try {
    const raw = store.getItem(ALERT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return normalizeAlertSettings(typeof parsed === 'object' && parsed !== null ? parsed : {});
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS };
  }
}

/** Saves normalized settings; returns what was saved. Storage errors are swallowed: the display keeps working. */
export function saveAlertSettings(store: KeyValueStore | undefined, settings: AlertSettings): AlertSettings {
  const normalized = normalizeAlertSettings(settings);
  try {
    store?.setItem(ALERT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Private mode or blocked site data: the settings last for this page only.
  }
  return normalized;
}
