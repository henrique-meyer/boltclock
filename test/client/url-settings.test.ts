import { describe, expect, it } from 'vitest';
import { KM_PER_MILE, readUrlSettings } from '../../src/client/url-settings.js';
import { MAX_RADIUS_KM } from '../../src/shared/messages.js';

describe('readUrlSettings', () => {
  it('needs a valid lat and lon', () => {
    expect(readUrlSettings('')).toBeUndefined();
    expect(readUrlSettings('?lat=28.5')).toBeUndefined();
    expect(readUrlSettings('?lat=95&lon=0')).toBeUndefined();
  });

  it('defaults to 10 miles and 30 minutes', () => {
    expect(readUrlSettings('?lat=28.5&lon=-81.4')).toEqual({
      query: { lat: 28.5, lon: -81.4, radiusKm: 10 * KM_PER_MILE, minutes: 30 },
      radius: { value: 10, unit: 'mi' },
    });
  });

  it('keeps the radius as entered, in kilometres too', () => {
    expect(readUrlSettings('?lat=0&lon=0&radius=25&unit=km&minutes=45')).toEqual({
      query: { lat: 0, lon: 0, radiusKm: 25, minutes: 45 },
      radius: { value: 25, unit: 'km' },
    });
  });

  it('caps the radius at 100 miles and the window at 120 minutes', () => {
    const settings = readUrlSettings('?lat=0&lon=0&radius=500&minutes=999')!;
    expect(settings.radius.value).toBeCloseTo(100, 9);
    expect(settings.query.radiusKm).toBeCloseTo(MAX_RADIUS_KM, 9);
    expect(settings.query.minutes).toBe(120);
  });
});
