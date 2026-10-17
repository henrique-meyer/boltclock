import { DEFAULT_TIME_LIMIT_MINUTES, KM_PER_MILE, MAX_RADIUS_KM } from '../shared/display-state.js';
import { loadLocation, type KeyValueStore } from './location-settings.js';
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
  if (!saved) return undefined;
  const { point, radius } = saved;
  const radiusKm = Math.min(radius.unit === 'km' ? radius.value : radius.value * KM_PER_MILE, MAX_RADIUS_KM);
  return {
    query: { lat: point.lat, lon: point.lon, radiusKm, minutes: DEFAULT_TIME_LIMIT_MINUTES },
    radius: { value: radius.value, unit: radius.unit },
  };
}
