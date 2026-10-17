import { describe, expect, it } from 'vitest';
import { resolveDisplaySettings, startAtBrowserLocation } from '../../src/client/display-settings.js';
import { loadLocation, LOCATION_STORAGE_KEY, type KeyValueStore } from '../../src/client/location-settings.js';
import { KM_PER_MILE, MAX_RADIUS_KM } from '../../src/shared/display-state.js';

function storeWith(saved?: unknown): KeyValueStore {
  const raw = saved === undefined ? null : JSON.stringify(saved);
  return {
    getItem: (key) => (key === LOCATION_STORAGE_KEY ? raw : null),
    setItem: () => {
      throw new Error('the display never writes the location');
    },
  };
}

describe('resolveDisplaySettings', () => {
  it('uses the saved location, with the radius as entered and the default window', () => {
    const store = storeWith({ point: { lat: 28.5383, lon: -81.3792 }, radius: { value: 15, unit: 'mi' } });

    expect(resolveDisplaySettings('', store)).toEqual({
      query: { lat: 28.5383, lon: -81.3792, radiusKm: 15 * KM_PER_MILE, minutes: 30 },
      radius: { value: 15, unit: 'mi' },
    });
  });

  it('keeps a saved radius in kilometres as kilometres', () => {
    const store = storeWith({ point: { lat: 0, lon: 0 }, radius: { value: 25, unit: 'km' } });

    expect(resolveDisplaySettings('', store)).toMatchObject({ query: { radiusKm: 25 }, radius: { value: 25, unit: 'km' } });
  });

  it('caps the saved radius at the server limit', () => {
    const store = storeWith({ point: { lat: 0, lon: 0 }, radius: { value: 100, unit: 'mi' } });

    expect(resolveDisplaySettings('', store)?.query.radiusKm).toBeLessThanOrEqual(MAX_RADIUS_KM);
  });

  it('lets ?lat&lon in the address override the saved location', () => {
    const store = storeWith({ point: { lat: 28.5, lon: -81.4 }, radius: { value: 15, unit: 'mi' } });

    expect(resolveDisplaySettings('?lat=40.7&lon=-74&radius=5&unit=km&minutes=45', store)).toEqual({
      query: { lat: 40.7, lon: -74, radiusKm: 5, minutes: 45 },
      radius: { value: 5, unit: 'km' },
    });
  });

  it('falls back to the saved location when the address point is incomplete', () => {
    const store = storeWith({ point: { lat: 28.5, lon: -81.4 }, radius: { value: 10, unit: 'mi' } });

    expect(resolveDisplaySettings('?lat=40.7', store)?.query).toMatchObject({ lat: 28.5, lon: -81.4 });
  });

  it('uses the address alone when storage is unavailable', () => {
    expect(resolveDisplaySettings('?lat=1&lon=2', undefined)?.query).toMatchObject({ lat: 1, lon: 2 });
  });

  it('is undefined with neither an address point nor a valid saved location', () => {
    expect(resolveDisplaySettings('', storeWith())).toBeUndefined();
    expect(resolveDisplaySettings('', undefined)).toBeUndefined();
    expect(resolveDisplaySettings('?unit=km', storeWith({ point: { lat: 99, lon: 0 }, radius: { value: 10, unit: 'mi' } }))).toBeUndefined();
  });
});

describe('startAtBrowserLocation', () => {
  function memoryStore(): KeyValueStore {
    const data = new Map<string, string>();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('watches the browser location at the default 10 mi and saves it for later visits', () => {
    const store = memoryStore();
    const settings = startAtBrowserLocation(store, { lat: 28.538412345, lon: -81.378912345 });

    expect(settings).toEqual({
      query: { lat: 28.538412, lon: -81.378912, radiusKm: 10 * KM_PER_MILE, minutes: 30 },
      radius: { value: 10, unit: 'mi' },
    });
    expect(loadLocation(store)).toEqual({ point: { lat: 28.538412, lon: -81.378912 }, radius: { value: 10, unit: 'mi' } });
    // The next visit uses the stored location as it is.
    expect(resolveDisplaySettings('', store)).toEqual(settings);
  });

  it('still starts when storage refuses or is missing', () => {
    const refusing: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    expect(startAtBrowserLocation(refusing, { lat: 1, lon: 2 })?.radius).toEqual({ value: 10, unit: 'mi' });
    expect(startAtBrowserLocation(undefined, { lat: 1, lon: 2 }).query).toMatchObject({ lat: 1, lon: 2 });
  });
});
