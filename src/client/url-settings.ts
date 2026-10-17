import { MAX_RADIUS_KM, MAX_WINDOW_MINUTES, type StreamQuery } from '../shared/messages.js';

export const KM_PER_MILE = 1.609344;

export interface UrlSettings {
  query: StreamQuery;
  radius: { value: number; unit: 'mi' | 'km' };
}

/**
 * A point in the page address overrides the saved location, so a kiosk can be pinned by its URL:
 * ?lat=28.54&lon=-81.38&radius=10&unit=mi&minutes=30 (radius, unit and minutes are optional).
 * Returns undefined when lat or lon is missing or invalid.
 */
export function readUrlSettings(search: string): UrlSettings | undefined {
  const params = new URLSearchParams(search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!params.has('lat') || !params.has('lon') || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) return undefined;

  const unit = params.get('unit') === 'km' ? 'km' : 'mi';
  const rawRadius = Number(params.get('radius') ?? 10);
  const maxRadius = unit === 'km' ? MAX_RADIUS_KM : MAX_RADIUS_KM / KM_PER_MILE;
  const radius = rawRadius > 0 ? Math.min(rawRadius, maxRadius) : 10;
  const rawMinutes = Number(params.get('minutes') ?? 30);
  const minutes = Number.isInteger(rawMinutes) && rawMinutes >= 1 ? Math.min(rawMinutes, MAX_WINDOW_MINUTES) : 30;

  const radiusKm = Math.min(unit === 'km' ? radius : radius * KM_PER_MILE, MAX_RADIUS_KM);
  return { query: { lat, lon, radiusKm, minutes }, radius: { value: radius, unit } };
}
