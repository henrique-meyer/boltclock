import { DEFAULT_TIME_LIMIT_MINUTES, MAX_TIME_LIMIT_MINUTES, type RadiusUnit } from '../shared/display-state.js';
import type { KeyValueStore } from './location-settings.js';

/** How the display alerts and shows units, kept on the display device next to its location (there are no accounts). */
export const ALERT_STORAGE_KEY = 'boltclock.alerts';

export const SIRENS = ['two-tone', 'mechanical', 'yelp', 'none'] as const;
export type SirenId = (typeof SIRENS)[number];

export const SIREN_LABELS: Record<SirenId, string> = {
  'two-tone': 'Two-tone (mildest)',
  mechanical: 'Mechanical wail',
  yelp: 'Yelp (most urgent)',
  none: 'No siren',
};

export const CLOCKS = ['12h', '24h'] as const;
export type ClockFormat = (typeof CLOCKS)[number];
export const CLOCK_LABELS: Record<ClockFormat, string> = { '12h': '12-hour (1 PM)', '24h': '24-hour (13:00)' };

export const TEMPERATURE_UNITS = ['F', 'C'] as const;
export type TemperatureUnit = (typeof TEMPERATURE_UNITS)[number];
export const TEMPERATURE_LABELS: Record<TemperatureUnit, string> = { F: 'Fahrenheit (°F)', C: 'Celsius (°C)' };

export const DISTANCE_UNITS = ['mi', 'km'] as const satisfies readonly RadiusUnit[];
export const DISTANCE_LABELS: Record<RadiusUnit, string> = { mi: 'Miles', km: 'Kilometers' };

/** How the display shows times and temperatures (BOLT-24). */
export interface DisplayUnits {
  clock: ClockFormat;
  temperatureUnit: TemperatureUnit;
}

export interface AlertSettings extends DisplayUnits {
  siren: SirenId;
  /** 0 to 1. */
  volume: number;
  /**
   * Replay the siren and announcement for each new strike during a countdown. Off by default (BOLT-23): the first
   * strike sounds the alarm, and later ones only restart the countdown unless this is turned on.
   */
  replayAudioDuringCountdown: boolean;
  /** Speak the announcement (the distance, and the all-clear sentence) after the siren or chime. On by default. */
  announcement: boolean;
  /** All-clear countdown, from the latest strike's time. 1 to 120 minutes. */
  timeLimitMinutes: number;
  /**
   * Miles or kilometres (BOLT-36): the saved radius's unit, kept in step with it, and the unit a new location starts
   * with. Distances on screen and in announcements follow the radius's unit.
   */
  distanceUnit: RadiusUnit;
  /**
   * Simulation mode (BOLT-37): the Simulate a strike and Simulate all clear buttons. Null follows the deployment's
   * TEST_MODE; true or false is this device's own choice.
   */
  simulation: boolean | null;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  siren: 'two-tone',
  volume: 0.8,
  replayAudioDuringCountdown: false,
  announcement: true,
  timeLimitMinutes: DEFAULT_TIME_LIMIT_MINUTES,
  clock: '12h',
  temperatureUnit: 'F',
  distanceUnit: 'mi',
  simulation: null,
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
    announcement: typeof input.announcement === 'boolean' ? input.announcement : DEFAULT_ALERT_SETTINGS.announcement,
    timeLimitMinutes:
      Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_TIME_LIMIT_MINUTES ? minutes : DEFAULT_ALERT_SETTINGS.timeLimitMinutes,
    clock: CLOCKS.includes(input.clock as ClockFormat) ? (input.clock as ClockFormat) : DEFAULT_ALERT_SETTINGS.clock,
    temperatureUnit: TEMPERATURE_UNITS.includes(input.temperatureUnit as TemperatureUnit)
      ? (input.temperatureUnit as TemperatureUnit)
      : DEFAULT_ALERT_SETTINGS.temperatureUnit,
    distanceUnit: DISTANCE_UNITS.includes(input.distanceUnit as RadiusUnit) ? (input.distanceUnit as RadiusUnit) : DEFAULT_ALERT_SETTINGS.distanceUnit,
    simulation: typeof input.simulation === 'boolean' ? input.simulation : null,
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

/**
 * Whether the Simulate buttons show. Only where the deployment allows simulation (ALLOW_SIMULATION); then this
 * device's choice, else the deployment's default (TEST_MODE).
 */
export function simulationOn(settings: AlertSettings, deployment: { testMode: boolean; allowSimulation: boolean }): boolean {
  return deployment.allowSimulation && (settings.simulation ?? deployment.testMode);
}
