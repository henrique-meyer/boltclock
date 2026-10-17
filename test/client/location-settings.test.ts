import { describe, expect, it } from 'vitest';
import {
  LOCATION_STORAGE_KEY,
  loadLocation,
  parseRadius,
  radiusMeters,
  saveLocation,
  type KeyValueStore,
} from '../../src/client/location-settings.js';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

describe('saveLocation and loadLocation', () => {
  it('round-trips the point and the radius as entered', () => {
    const store = memoryStore();
    saveLocation(store, { point: { lat: 28.5383, lon: -81.3792 }, radius: { value: 15.5, unit: 'km' } });

    expect(loadLocation(store)).toEqual({ point: { lat: 28.5383, lon: -81.3792 }, radius: { value: 15.5, unit: 'km' } });
  });

  it('stores only coordinates and the radius, whatever else the caller holds', () => {
    const store = memoryStore();
    const location = {
      point: { lat: 28.5383, lon: -81.3792, address: '400 S Orange Ave, Orlando, FL' },
      radius: { value: 10, unit: 'mi' as const },
      searchText: 'orlando city hall',
      placeName: 'Orlando City Hall',
    };
    saveLocation(store, location);

    const raw = store.items.get(LOCATION_STORAGE_KEY) ?? '';
    expect(JSON.parse(raw)).toEqual({ point: { lat: 28.5383, lon: -81.3792 }, radius: { value: 10, unit: 'mi' } });
    expect(raw).not.toMatch(/orlando|orange/i);
    expect([...store.items.keys()]).toEqual([LOCATION_STORAGE_KEY]);
  });

  it('rounds coordinates to six decimals and folds the longitude', () => {
    const store = memoryStore();
    const saved = saveLocation(store, { point: { lat: 28.538312345, lon: 278.6208 }, radius: { value: 10, unit: 'mi' } });

    expect(saved.point).toEqual({ lat: 28.538312, lon: -81.3792 });
  });

  it.each([
    [{ lat: 91, lon: 0 }, { value: 10, unit: 'mi' }],
    [{ lat: Number.NaN, lon: 0 }, { value: 10, unit: 'mi' }],
    [{ lat: 0, lon: 0 }, { value: 0, unit: 'mi' }],
    [{ lat: 0, lon: 0 }, { value: 101, unit: 'mi' }],
    [{ lat: 0, lon: 0 }, { value: 161, unit: 'km' }],
    [{ lat: 0, lon: 0 }, { value: 10, unit: 'ft' }],
  ])('refuses to save %o with radius %o', (point, radius) => {
    const store = memoryStore();
    expect(() => saveLocation(store, { point, radius } as never)).toThrow();
    expect(store.items.size).toBe(0);
  });

  it('loads nothing when nothing, garbage or out-of-range values are stored', () => {
    expect(loadLocation(memoryStore())).toBeUndefined();
    expect(loadLocation(memoryStore({ [LOCATION_STORAGE_KEY]: '{not json' }))).toBeUndefined();
    expect(loadLocation(memoryStore({ [LOCATION_STORAGE_KEY]: 'null' }))).toBeUndefined();
    const outOfRange = JSON.stringify({ point: { lat: 95, lon: 0 }, radius: { value: 10, unit: 'mi' } });
    expect(loadLocation(memoryStore({ [LOCATION_STORAGE_KEY]: outOfRange }))).toBeUndefined();
  });

  it('drops unknown fields found in storage', () => {
    const stored = JSON.stringify({ point: { lat: 1, lon: 2, address: 'x' }, radius: { value: 5, unit: 'km' }, query: 'y' });
    expect(loadLocation(memoryStore({ [LOCATION_STORAGE_KEY]: stored }))).toEqual({
      point: { lat: 1, lon: 2 },
      radius: { value: 5, unit: 'km' },
    });
  });

  it('loads nothing when storage is blocked', () => {
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(loadLocation(blocked)).toBeUndefined();
  });
});

describe('parseRadius', () => {
  it('keeps the value as typed, in the chosen unit', () => {
    expect(parseRadius(' 12.5 ', 'km')).toEqual({ ok: true, radius: { value: 12.5, unit: 'km' } });
    expect(parseRadius('100', 'mi')).toEqual({ ok: true, radius: { value: 100, unit: 'mi' } });
    expect(parseRadius('160.9', 'km')).toEqual({ ok: true, radius: { value: 160.9, unit: 'km' } });
  });

  it.each(['', '0', '-3', 'ten'])('rejects %j', (text) => {
    expect(parseRadius(text, 'mi')).toEqual({ ok: false, message: 'Enter a radius greater than 0.' });
  });

  it('caps the radius at 100 mi or its km equivalent', () => {
    expect(parseRadius('100.5', 'mi')).toEqual({ ok: false, message: 'The radius can be at most 100 mi.' });
    expect(parseRadius('161', 'km')).toEqual({ ok: false, message: 'The radius can be at most 160.9 km.' });
  });
});

describe('radiusMeters', () => {
  it('converts for the map circle', () => {
    expect(radiusMeters({ value: 10, unit: 'mi' })).toBeCloseTo(16_093.44);
    expect(radiusMeters({ value: 10, unit: 'km' })).toBe(10_000);
  });
});
