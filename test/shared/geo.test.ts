import { describe, expect, it } from 'vitest';
import { cellKey, cellsForCircle, destinationPoint, distanceKm, EARTH_RADIUS_KM, normalizeLon } from '../../src/shared/geo.js';

describe('destinationPoint', () => {
  it('lands the given distance away in the given direction', () => {
    const start = { lat: 28.54, lon: -81.38 };
    for (const bearing of [0, 45, 90, 180, 270, 333]) {
      const end = destinationPoint(start.lat, start.lon, bearing, 12.5);
      expect(distanceKm(start.lat, start.lon, end.lat, end.lon)).toBeCloseTo(12.5, 6);
    }
    expect(destinationPoint(0, 0, 90, 111.19).lat).toBeCloseTo(0, 6);
    expect(destinationPoint(0, 0, 0, 111.19).lon).toBeCloseTo(0, 6);
  });

  it('folds longitude across the antimeridian', () => {
    expect(destinationPoint(0, 179.9, 90, 50).lon).toBeLessThan(-179);
  });
});

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(28.54, -81.38, 28.54, -81.38)).toBe(0);
  });

  it('is R·π/180 for one degree along a meridian or the equator', () => {
    const oneDegree = (EARTH_RADIUS_KM * Math.PI) / 180; // about 111.195 km
    expect(distanceKm(28, -81, 29, -81)).toBeCloseTo(oneDegree, 9);
    expect(distanceKm(0, 10, 0, 11)).toBeCloseTo(oneDegree, 9);
  });

  it('is a quarter of the circumference from a pole to the equator', () => {
    expect(distanceKm(90, 0, 0, -81)).toBeCloseTo((Math.PI / 2) * EARTH_RADIUS_KM, 6);
  });

  it('shrinks east-west distances with the cosine of latitude', () => {
    // Over one degree of longitude at 60° N the great circle is barely shorter than the parallel (R·cos60·π/180).
    expect(distanceKm(60, 0, 60, 1)).toBeCloseTo(((EARTH_RADIUS_KM * Math.PI) / 180) * 0.5, 1);
  });

  it('is half the circumference between antipodes', () => {
    expect(distanceKm(0, 0, 0, 180)).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 6);
  });
});

describe('cellKey', () => {
  it('names a cell by its south-west corner', () => {
    expect(cellKey(28.5, -81.4)).toBe('28_-82');
    expect(cellKey(-0.5, 0.5)).toBe('-1_0');
  });

  it('keeps the poles and the antimeridian inside the grid', () => {
    expect(cellKey(90, 10)).toBe('89_10');
    expect(cellKey(-90, 10)).toBe('-90_10');
    expect(cellKey(10, 180)).toBe('10_-180');
    expect(cellKey(10, -180)).toBe('10_-180');
  });
});

describe('normalizeLon', () => {
  it('folds into [-180, 180)', () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(360)).toBe(0);
  });
});

describe('cellsForCircle', () => {
  it('is one cell for a small circle inside a cell', () => {
    expect(cellsForCircle(28.5, -81.5, 5)).toEqual(['28_-82']);
  });

  it('crosses cell edges', () => {
    expect(new Set(cellsForCircle(28.02, -81.02, 10))).toEqual(new Set(['27_-82', '27_-81', '28_-82', '28_-81']));
  });

  it('wraps across the antimeridian', () => {
    const cells = cellsForCircle(0.5, 179.9, 50);
    expect(cells).toContain('0_179');
    expect(cells).toContain('0_-180');
  });

  it('covers every longitude when the circle reaches a pole', () => {
    const cells = cellsForCircle(89.8, 0, 50);
    expect(cells.filter((c) => c.startsWith('89_'))).toHaveLength(360);
  });

  it('never misses a point inside the circle', () => {
    // Deterministic pseudo-random points, so a failure is reproducible.
    let seed = 42;
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 300; i++) {
      const lat = -80 + random() * 160;
      const lon = -180 + random() * 360;
      const radiusKm = 1 + random() * 160;
      const cells = new Set(cellsForCircle(lat, lon, radiusKm));
      for (let j = 0; j < 30; j++) {
        const bearing = random() * 2 * Math.PI;
        const d = (random() * radiusKm) / EARTH_RADIUS_KM;
        const lat1 = (lat * Math.PI) / 180;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
        const lon2 =
          (lon * Math.PI) / 180 +
          Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
        const key = cellKey((lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI);
        expect(cells.has(key), `${key} missing for circle ${lat},${lon} r=${radiusKm}`).toBe(true);
      }
    }
  });
});
