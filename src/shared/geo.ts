/** Mean Earth radius in kilometres (IUGG). */
export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle (haversine) distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Longitude folded into [-180, 180). */
export function normalizeLon(lon: number): number {
  const folded = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Object.is(folded, -0) ? 0 : folded;
}

/**
 * The 1° latitude/longitude grid cell that contains a point, e.g. "28_-82" for 28.5° N, 81.4° W.
 * Cells are named by their south-west corner. Latitude 90 belongs to the 89 row; longitude 180 is -180.
 */
export function cellKey(lat: number, lon: number): string {
  const row = Math.min(89, Math.floor(Math.max(-90, Math.min(90, lat))));
  const col = Math.floor(normalizeLon(lon));
  return `${row}_${col}`;
}

/** Every 1° cell that a circle of radiusKm around a point touches, so a query can read just those cells. */
export function cellsForCircle(lat: number, lon: number, radiusKm: number): string[] {
  const angular = radiusKm / EARTH_RADIUS_KM; // radians
  const latMin = lat - toDeg(angular);
  const latMax = lat + toDeg(angular);
  const cells = new Set<string>();

  // The circle reaches a pole, or covers most of a hemisphere: every longitude in the latitude band.
  const reachesPole = latMax >= 90 || latMin <= -90 || angular >= Math.PI / 2;
  const halfWidth = reachesPole ? 180 : toDeg(Math.asin(Math.min(1, Math.sin(angular) / Math.cos(toRad(lat)))));

  const firstRow = Math.max(-90, Math.floor(latMin));
  const lastRow = Math.min(89, Math.floor(latMax));
  for (let row = firstRow; row <= lastRow; row++) {
    if (halfWidth >= 180) {
      for (let col = -180; col < 180; col++) cells.add(`${row}_${col}`);
      continue;
    }
    const firstCol = Math.floor(lon - halfWidth);
    const lastCol = Math.floor(lon + halfWidth);
    for (let col = firstCol; col <= lastCol; col++) cells.add(`${row}_${Math.floor(normalizeLon(col))}`);
  }
  return [...cells];
}
