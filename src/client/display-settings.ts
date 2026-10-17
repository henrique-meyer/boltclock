import { DEFAULT_TIME_LIMIT_MINUTES, KM_PER_MILE, MAX_RADIUS_KM } from '../shared/display-state.js';
import type { RadiusUnit } from '../shared/display-state.js';
import { saveAlertSettings, type AlertSettings } from './alert-settings.js';
import {
  convertRadius,
  DEFAULT_RADIUS,
  loadLocation,
  normalizePoint,
  saveLocation,
  type KeyValueStore,
  type Point,
  type Radius,
  type SavedLocation,
} from './location-settings.js';
import { readUrlSettings, type UrlSettings } from './url-settings.js';

/**
 * The point and radius the display watches. ?lat&lon in the address wins, so a kiosk can be pinned to a point by
 * its URL. Otherwise the display uses the location saved on this device by /location.html, with the default time
 * window. Undefined when there is neither.
 */
export function resolveDisplaySettings(search: string, store: KeyValueStore | undefined): UrlSettings | undefined {
  const fromAddress = readUrlSettings(search);
  if (fromAddress) return fromAddress;

  const saved = store && loadLocation(store);
  return saved ? settingsForLocation(saved) : undefined;
}

/** What the display watches for a saved point and radius, with the default time window. */
export function settingsForLocation({ point, radius }: SavedLocation): UrlSettings {
  const radiusKm = Math.min(radius.unit === 'km' ? radius.value : radius.value * KM_PER_MILE, MAX_RADIUS_KM);
  return {
    query: { lat: point.lat, lon: point.lon, radiusKm, minutes: DEFAULT_TIME_LIMIT_MINUTES },
    radius: { value: radius.value, unit: radius.unit },
  };
}

/**
 * First visit: watch the browser's location with the default radius, and save it so later visits use it as stored.
 * The display still starts when storage refuses; it then asks again on the next visit.
 */
export function startAtBrowserLocation(store: KeyValueStore | undefined, here: Point, radius: Radius = DEFAULT_RADIUS): UrlSettings {
  const location: SavedLocation = { point: normalizePoint(here), radius: { ...radius } };
  try {
    if (store) saveLocation(store, location);
  } catch {
    // Site data blocked: watch for this visit only.
  }
  return settingsForLocation(location);
}

/** The distance unit Settings shows: the saved radius's unit when there is one, else the saved preference. */
export function currentDistanceUnit(store: KeyValueStore | undefined, alerts: AlertSettings): RadiusUnit {
  return (store && loadLocation(store)?.radius.unit) ?? alerts.distanceUnit;
}

/**
 * Settings' distance unit (BOLT-36): saved with the alert settings, and a saved radius is converted to it, so the
 * display, its announcements and the picker all use it. Returns the saved alert settings.
 */
export function setDistanceUnit(store: KeyValueStore | undefined, alerts: AlertSettings, unit: RadiusUnit): AlertSettings {
  const next = saveAlertSettings(store, { ...alerts, distanceUnit: unit });
  const saved = store && loadLocation(store);
  if (store && saved && saved.radius.unit !== unit) {
    try {
      saveLocation(store, { point: saved.point, radius: convertRadius(saved.radius, unit) });
    } catch {
      // Site data blocked: nothing saved to convert.
    }
  }
  return next;
}
