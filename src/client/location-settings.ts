import { MAX_RADIUS_KM, MAX_RADIUS_MI, type RadiusUnit } from '../shared/display-state.js';
import { normalizeLon } from '../shared/geo.js';

/**
 * The display's point and radius, kept in the browser's local storage on the display device (there are no accounts).
 * Only coordinates and the radius are stored. The address or search text that led to the point never is.
 */
export const LOCATION_STORAGE_KEY = 'boltclock.location';

export const DEFAULT_RADIUS: Radius = { value: 10, unit: 'mi' };

export interface Point {
  lat: number;
  lon: number;
}

/** Stored exactly as entered: 15 km stays 15 km, never 9.32 mi. */
export interface Radius {
  value: number;
  unit: RadiusUnit;
}

export interface SavedLocation {
  point: Point;
  radius: Radius;
}

/** The part of Storage this module uses: window.localStorage in the browser, a fake in tests. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export function maxRadius(unit: RadiusUnit): number {
  return unit === 'km' ? MAX_RADIUS_KM : MAX_RADIUS_MI;
}

export function isValidPoint(point: Point): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

export function isValidRadius(radius: Radius): boolean {
  return (radius.unit === 'mi' || radius.unit === 'km') && radius.value > 0 && radius.value <= maxRadius(radius.unit);
}

/** Six decimals is about 10 cm, far finer than GLM's ~8 km pixels. Longitude is folded into [-180, 180). */
export function normalizePoint(point: Point): Point {
  const round = (degrees: number) => Math.round(degrees * 1e6) / 1e6;
  return { lat: round(point.lat), lon: round(normalizeLon(point.lon)) };
}

export type RadiusInput = { ok: true; radius: Radius } | { ok: false; message: string };

/** Reads the radius field. The number is kept as typed, in the unit chosen next to it. */
export function parseRadius(text: string, unit: RadiusUnit): RadiusInput {
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, message: 'Enter a radius greater than 0.' };
  }
  const max = maxRadius(unit);
  if (value > max) {
    return { ok: false, message: `The radius can be at most ${Math.floor(max * 10) / 10} ${unit}.` };
  }
  return { ok: true, radius: { value, unit } };
}

export function radiusMeters(radius: Radius): number {
  return radius.unit === 'km' ? radius.value * 1000 : radius.value * 1609.344;
}

/** The saved location, or undefined when nothing valid is stored or storage is unavailable. */
export function loadLocation(store: KeyValueStore): SavedLocation | undefined {
  let raw: string | null;
  try {
    raw = store.getItem(LOCATION_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { point, radius } = parsed as Partial<Record<'point' | 'radius', Record<string, unknown>>>;
    const location = {
      point: { lat: Number(point?.lat), lon: Number(point?.lon) },
      radius: { value: Number(radius?.value), unit: radius?.unit as RadiusUnit },
    };
    return isValidPoint(location.point) && isValidRadius(location.radius) ? location : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Saves the point and radius. The stored object is built field by field, so nothing else a caller holds (a place,
 * an address, the search text) can end up in storage. Throws when the values are invalid or storage refuses.
 */
export function saveLocation(store: KeyValueStore, location: SavedLocation): SavedLocation {
  const point = normalizePoint(location.point);
  const radius: Radius = { value: location.radius.value, unit: location.radius.unit };
  if (!isValidPoint(point)) throw new Error('The point is not a valid latitude and longitude.');
  if (!isValidRadius(radius)) throw new Error('The radius is out of range.');

  const saved: SavedLocation = { point, radius };
  store.setItem(LOCATION_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}
