import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as h5wasm from 'h5wasm';
import { describe, expect, it } from 'vitest';
import { parseGlm, parseUnitsBase } from '../../../src/server/glm/parse.js';

const FIXTURE = 'OR_GLM-L2-LCFA_G19_s20261962021200_e20261962021400_c20261962021423';
const fixtureDir = join(import.meta.dirname, '..', '..', 'fixtures', 'glm');

interface Expected {
  start: string;
  end: string;
  flashCount: number;
  flashes: { id: number; timeMs: number; lat: number; lon: number; quality: number }[];
}

// Values from an independent xarray read of the same file (CF decoding on). See test/fixtures/glm/README.md.
const expected = JSON.parse(readFileSync(join(fixtureDir, `${FIXTURE}.expected.json`), 'utf8')) as Expected;
const fixtureBytes = new Uint8Array(readFileSync(join(fixtureDir, `${FIXTURE}.nc`)));

describe('parseGlm on a real GOES-19 file', () => {
  it('reads the coverage window', async () => {
    const glm = await parseGlm(fixtureBytes);

    expect(glm.startMs).toBe(Date.parse(expected.start));
    expect(glm.endMs).toBe(Date.parse(expected.end));
    expect(glm.totalFlashes).toBe(expected.flashCount);
  });

  it('matches the reference reader for every flash', async () => {
    const glm = await parseGlm(fixtureBytes, { includeDegraded: true });

    expect(glm.flashes).toHaveLength(expected.flashes.length);
    glm.flashes.forEach((flash, i) => {
      const ref = expected.flashes[i]!;
      expect(flash.id).toBe(ref.id);
      expect(flash.quality).toBe(ref.quality);
      // The reference unpacks in float32 and truncates to whole ms; the parser unpacks in float64 and rounds.
      expect(Math.abs(flash.timeMs - ref.timeMs)).toBeLessThanOrEqual(1);
      expect(flash.lat).toBeCloseTo(ref.lat, 6);
      expect(flash.lon).toBeCloseTo(ref.lon, 6);
    });
  });

  it('leaves out degraded flashes by default', async () => {
    const glm = await parseGlm(fixtureBytes);
    const good = expected.flashes.filter((f) => f.quality === 0);

    expect(glm.flashes.map((f) => f.id)).toEqual(good.map((f) => f.id));
    expect(glm.flashes.every((f) => f.quality === 0)).toBe(true);
  });

  it('puts every flash near its file window and on the GOES-East disk', async () => {
    const glm = await parseGlm(fixtureBytes, { includeDegraded: true });

    for (const flash of glm.flashes) {
      // add_offset is -5 s, so a flash can begin up to 5 s before the window opens.
      expect(flash.timeMs).toBeGreaterThanOrEqual(glm.startMs - 5000);
      expect(flash.timeMs).toBeLessThanOrEqual(glm.endMs);
      expect(Math.abs(flash.lat)).toBeLessThanOrEqual(70);
      expect(flash.lon).toBeGreaterThanOrEqual(-180);
      expect(flash.lon).toBeLessThanOrEqual(0);
    }
  });

  it('can parse the same bytes repeatedly', async () => {
    const first = await parseGlm(fixtureBytes);
    const second = await parseGlm(fixtureBytes);

    expect(second).toEqual(first);
  });
});

// Synthetic files with the same variables and packing as GLM-L2-LCFA, for cases a single real file cannot show.
const TIME_SCALE = 0.0003814756;
const TIME_OFFSET = -5;

interface SyntheticFlash { id: number; secondsAfterStart: number; lat: number; lon: number; quality: number }

async function syntheticGlm(start: string, end: string, flashes: SyntheticFlash[]): Promise<Uint8Array> {
  const { FS } = await h5wasm.ready;
  const path = `/synthetic-${Math.random().toString(36).slice(2)}.nc`;
  const file = new h5wasm.File(path, 'w');
  file.create_attribute('time_coverage_start', start);
  file.create_attribute('time_coverage_end', end);

  const asInt16 = (values: number[]) => new Int16Array(new Uint16Array(values).buffer);
  const unsignedInt16 = (name: string, values: number[], extra: (ds: h5wasm.Dataset) => void = () => {}) => {
    const ds = file.create_dataset({ name, data: asInt16(values), shape: [values.length], dtype: '<h' });
    ds.create_attribute('_Unsigned', 'true');
    extra(ds);
  };

  unsignedInt16('flash_id', flashes.map((f) => f.id));
  unsignedInt16('flash_quality_flag', flashes.map((f) => f.quality));
  unsignedInt16('flash_time_offset_of_first_event', flashes.map((f) => Math.round((f.secondsAfterStart - TIME_OFFSET) / TIME_SCALE)), (ds) => {
    ds.create_attribute('scale_factor', new Float32Array([TIME_SCALE]));
    ds.create_attribute('add_offset', new Float32Array([TIME_OFFSET]));
    ds.create_attribute('units', `seconds since ${start.replace('T', ' ').replace(/\.(\d)Z$/, '.$100')}`);
  });
  file.create_dataset({ name: 'flash_lat', data: new Float32Array(flashes.map((f) => f.lat)), shape: [flashes.length], dtype: '<f' });
  file.create_dataset({ name: 'flash_lon', data: new Float32Array(flashes.map((f) => f.lon)), shape: [flashes.length], dtype: '<f' });
  file.close();

  const bytes = FS!.readFile(path);
  FS!.unlink(path);
  return bytes;
}

describe('parseGlm on synthetic files', () => {
  it('returns no flashes for a file without any', async () => {
    const bytes = await syntheticGlm('2026-10-17T06:00:00.0Z', '2026-10-17T06:00:20.0Z', []);
    const glm = await parseGlm(bytes);

    expect(glm.flashes).toEqual([]);
    expect(glm.totalFlashes).toBe(0);
    expect(glm.endMs).toBe(Date.UTC(2026, 9, 17, 6, 0, 20));
  });

  it('carries times across a year boundary', async () => {
    const bytes = await syntheticGlm('2026-12-31T23:59:50.0Z', '2027-01-01T00:00:10.0Z', [
      { id: 1, secondsAfterStart: -2, lat: 28.5, lon: -81.4, quality: 0 },
      { id: 2, secondsAfterStart: 15, lat: 28.6, lon: -81.3, quality: 0 },
    ]);
    const glm = await parseGlm(bytes);

    expect(glm.flashes.map((f) => new Date(f.timeMs).toISOString())).toEqual([
      '2026-12-31T23:59:48.000Z',
      '2027-01-01T00:00:05.000Z',
    ]);
  });

  it('reads ids above 32767 as unsigned', async () => {
    const bytes = await syntheticGlm('2026-10-17T06:00:00.0Z', '2026-10-17T06:00:20.0Z', [
      { id: 65000, secondsAfterStart: 1, lat: 10, lon: -60, quality: 0 },
    ]);
    const glm = await parseGlm(bytes);

    expect(glm.flashes[0]!.id).toBe(65000);
  });

  it('keeps or drops degraded flashes on request', async () => {
    const bytes = await syntheticGlm('2026-10-17T06:00:00.0Z', '2026-10-17T06:00:20.0Z', [
      { id: 1, secondsAfterStart: 1, lat: 10, lon: -60, quality: 0 },
      { id: 2, secondsAfterStart: 2, lat: 10, lon: -60, quality: 3 },
    ]);

    expect((await parseGlm(bytes)).flashes.map((f) => f.id)).toEqual([1]);
    expect((await parseGlm(bytes, { includeDegraded: true })).flashes.map((f) => f.id)).toEqual([1, 2]);
  });

  it('rejects a file without the flash variables', async () => {
    const { FS } = await h5wasm.ready;
    const path = '/not-glm.nc';
    const file = new h5wasm.File(path, 'w');
    file.create_attribute('time_coverage_start', '2026-10-17T06:00:00.0Z');
    file.create_attribute('time_coverage_end', '2026-10-17T06:00:20.0Z');
    file.close();
    const bytes = FS!.readFile(path);
    FS!.unlink(path);

    await expect(parseGlm(bytes)).rejects.toThrow(/no flash_id variable/);
  });
});

describe('parseUnitsBase', () => {
  it('reads GLM base times as UTC', () => {
    expect(parseUnitsBase('seconds since 2026-07-15 20:21:20.000')).toBe(Date.UTC(2026, 6, 15, 20, 21, 20));
  });

  it('rejects other units', () => {
    expect(() => parseUnitsBase('days since 2026-07-15')).toThrow(/Unexpected time units/);
  });
});
