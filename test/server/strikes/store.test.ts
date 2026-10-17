import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellKey, distanceKm } from '../../../src/shared/geo.js';
import { parseGlm, type GlmFile } from '../../../src/server/glm/parse.js';
import { MemoryTableStore, purgeOldTables, queryStrikes, RETENTION_MS, storeGlmFile } from '../../../src/server/strikes/store.js';

const FIXTURE = join(import.meta.dirname, '..', '..', 'fixtures', 'glm', 'OR_GLM-L2-LCFA_G19_s20261962021200_e20261962021400_c20261962021423.nc');
const T0 = Date.UTC(2026, 9, 17, 15, 0, 0);

function glmFile(startMs: number, flashes: { id: number; dt: number; lat: number; lon: number }[]): GlmFile {
  return {
    startMs,
    endMs: startMs + 20_000,
    totalFlashes: flashes.length,
    flashes: flashes.map((f) => ({ id: f.id, timeMs: startMs + f.dt, lat: f.lat, lon: f.lon, quality: 0 })),
  };
}

describe('storeGlmFile and queryStrikes with the real fixture', () => {
  it('stores every good flash once, in batches that stay inside one cell', async () => {
    const glm = await parseGlm(new Uint8Array(readFileSync(FIXTURE)));
    const store = new MemoryTableStore();

    const result = await storeGlmFile(store, glm);
    const stored = [...store.tables.values()].flatMap((t) => [...t.values()]);

    expect(result.rows).toBe(glm.flashes.length);
    expect(stored).toHaveLength(glm.flashes.length);
    expect(stored.every((r) => r.partitionKey === cellKey(r.lat, r.lon))).toBe(true);
    expect(result.batches).toBe(new Set(stored.map((r) => r.partitionKey)).size);
    expect(await store.latestFileEnd()).toBe(glm.endMs);
  });

  it('finds the flashes around one of them, and only those', async () => {
    const glm = await parseGlm(new Uint8Array(readFileSync(FIXTURE)));
    const store = new MemoryTableStore();
    await storeGlmFile(store, glm);
    const center = glm.flashes[0]!;
    const radiusKm = 80;

    const strikes = await queryStrikes(store, { lat: center.lat, lon: center.lon, radiusKm, sinceMs: glm.startMs - 10_000, nowMs: glm.endMs + 1000 });
    const expected = glm.flashes.filter((f) => distanceKm(center.lat, center.lon, f.lat, f.lon) <= radiusKm);

    expect(strikes.map((s) => s.id).sort()).toEqual(expected.map((f) => f.id).sort());
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.every((s) => s.distanceKm <= radiusKm)).toBe(true);
  });
});

describe('queryStrikes', () => {
  it('applies the time window and the exact radius', async () => {
    const store = new MemoryTableStore();
    await storeGlmFile(store, glmFile(T0, [
      { id: 1, dt: 0, lat: 28.5, lon: -81.4 }, // at the point
      { id: 2, dt: 1000, lat: 28.5, lon: -81.2 }, // about 20 km east
      { id: 3, dt: 2000, lat: 29.5, lon: -81.4 }, // about 111 km north
    ]));
    await storeGlmFile(store, glmFile(T0 - 40 * 60_000, [{ id: 4, dt: 0, lat: 28.5, lon: -81.4 }])); // 40 minutes earlier

    const nowMs = T0 + 60_000;
    const last30 = await queryStrikes(store, { lat: 28.5, lon: -81.4, radiusKm: 50, sinceMs: nowMs - 30 * 60_000, nowMs });
    const last60 = await queryStrikes(store, { lat: 28.5, lon: -81.4, radiusKm: 50, sinceMs: nowMs - 60 * 60_000, nowMs });

    expect(last30.map((s) => s.id)).toEqual([1, 2]);
    expect(last60.map((s) => s.id)).toEqual([4, 1, 2]);
  });

  it('never reaches back past the retention window', async () => {
    const store = new MemoryTableStore();
    await storeGlmFile(store, glmFile(T0, [{ id: 1, dt: 0, lat: 0, lon: 0 }]));

    const later = T0 + RETENTION_MS + 60_000;
    expect(await queryStrikes(store, { lat: 0, lon: 0, radiusKm: 10, sinceMs: 0, nowMs: later })).toEqual([]);
  });

  it('reads flashes stored on both sides of the antimeridian', async () => {
    const store = new MemoryTableStore();
    await storeGlmFile(store, glmFile(T0, [
      { id: 1, dt: 0, lat: 0, lon: 179.95 },
      { id: 2, dt: 0, lat: 0, lon: -179.95 },
    ]));

    const strikes = await queryStrikes(store, { lat: 0, lon: 180, radiusKm: 20, sinceMs: T0 - 1000, nowMs: T0 + 30_000 });
    expect(strikes.map((s) => s.id).sort()).toEqual([1, 2]);
  });

  it('writes a replayed file to the same rows', async () => {
    const store = new MemoryTableStore();
    const file = glmFile(T0, [{ id: 1, dt: 0, lat: 28.5, lon: -81.4 }]);
    await storeGlmFile(store, file);
    await storeGlmFile(store, file);

    const strikes = await queryStrikes(store, { lat: 28.5, lon: -81.4, radiusKm: 5, sinceMs: T0 - 1, nowMs: T0 + 30_000 });
    expect(strikes).toHaveLength(1);
  });

  it('splits a cell with more than 100 flashes into several batches', async () => {
    const store = new MemoryTableStore();
    const flashes = Array.from({ length: 250 }, (_, i) => ({ id: i, dt: i, lat: 28.5, lon: -81.4 }));

    const result = await storeGlmFile(store, glmFile(T0, flashes));
    expect(result.batches).toBe(3);
  });
});

describe('latest file end', () => {
  it('only moves forward', async () => {
    const store = new MemoryTableStore();
    await storeGlmFile(store, glmFile(T0 + 20_000, []));
    await storeGlmFile(store, glmFile(T0, []));

    expect(await store.latestFileEnd()).toBe(T0 + 40_000);
  });
});

describe('purgeOldTables', () => {
  it('deletes hourly tables that are entirely older than 120 minutes', async () => {
    const store = new MemoryTableStore();
    for (const hoursAgo of [4, 3, 2, 1, 0]) await storeGlmFile(store, glmFile(T0 - hoursAgo * 3_600_000, [{ id: 1, dt: 0, lat: 1, lon: 1 }]));

    const deleted = await purgeOldTables(store, T0 + 10 * 60_000); // 15:10: the cutoff is 13:10
    expect(deleted).toEqual(['glm2026101711', 'glm2026101712']);
    expect(await store.listTables('glm')).toEqual(['glm2026101713', 'glm2026101714', 'glm2026101715']);
  });
});
