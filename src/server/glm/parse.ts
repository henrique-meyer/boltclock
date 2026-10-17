import * as h5wasm from 'h5wasm';

/** One GLM flash in BoltClock's schema. */
export interface GlmFlash {
  /** GLM's flash_id. Unique only within its file: pair it with the file's start time for a global id. */
  id: number;
  /** Time of the flash's first event, UTC milliseconds since the epoch. */
  timeMs: number;
  /** Energy-weighted centroid, degrees north. */
  lat: number;
  /** Energy-weighted centroid, degrees east. */
  lon: number;
  /** GLM flash_quality_flag: 0 is good; 1, 3 and 5 are degraded. */
  quality: number;
}

export interface GlmFile {
  /** time_coverage_start, UTC milliseconds. */
  startMs: number;
  /** time_coverage_end, UTC milliseconds. The display's staleness check uses the newest end time. */
  endMs: number;
  /** Flashes in file order. Degraded flashes are left out unless includeDegraded is set. */
  flashes: GlmFlash[];
  /** Flashes in the file before quality filtering. */
  totalFlashes: number;
}

export interface ParseOptions {
  /** Keep flashes whose quality flag is not 0. Default false. */
  includeDegraded?: boolean;
}

type Dataset = InstanceType<typeof h5wasm.Dataset>;
type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

let fileCounter = 0;

/**
 * Reads one GOES-19 GLM-L2-LCFA NetCDF4 file. Applies the CF packing that a NetCDF reader would:
 * _Unsigned, scale_factor and add_offset, and time offsets relative to the base time in `units`.
 */
export async function parseGlm(bytes: Uint8Array, options: ParseOptions = {}): Promise<GlmFile> {
  const { FS } = await h5wasm.ready;
  if (!FS) throw new Error('h5wasm has no in-memory file system');

  // h5wasm opens files by path, so the bytes go into its in-memory file system for the duration of the read.
  const path = `/glm-${process.pid}-${fileCounter++}.nc`;
  FS.writeFile(path, bytes);
  const file = new h5wasm.File(path, 'r');
  try {
    const startMs = parseIsoTime(stringAttribute(file, 'time_coverage_start'));
    const endMs = parseIsoTime(stringAttribute(file, 'time_coverage_end'));

    const ids = readUnpacked(dataset(file, 'flash_id'));
    const times = readTimes(dataset(file, 'flash_time_offset_of_first_event'));
    const lats = readUnpacked(dataset(file, 'flash_lat'));
    const lons = readUnpacked(dataset(file, 'flash_lon'));
    const quality = readUnpacked(dataset(file, 'flash_quality_flag'));

    const count = ids.length;
    for (const [name, values] of [['flash_time_offset_of_first_event', times], ['flash_lat', lats], ['flash_lon', lons], ['flash_quality_flag', quality]] as const) {
      if (values.length !== count) throw new Error(`${name} has ${values.length} values, flash_id has ${count}`);
    }

    const flashes: GlmFlash[] = [];
    for (let i = 0; i < count; i++) {
      const flash = { id: ids[i]!, timeMs: times[i]!, lat: lats[i]!, lon: lons[i]!, quality: quality[i]! };
      if (options.includeDegraded || flash.quality === 0) flashes.push(flash);
    }

    return { startMs, endMs, flashes, totalFlashes: count };
  } finally {
    file.close();
    FS.unlink(path);
  }
}

function dataset(file: InstanceType<typeof h5wasm.File>, name: string): Dataset {
  const entity = file.get(name);
  if (!(entity instanceof h5wasm.Dataset)) throw new Error(`GLM file has no ${name} variable`);
  return entity;
}

function stringAttribute(owner: { attrs: Record<string, { value: unknown }> }, name: string): string {
  const value = owner.attrs[name]?.value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  throw new Error(`GLM file has no ${name} attribute`);
}

function numberAttribute(ds: Dataset, name: string): number | undefined {
  const value = ds.attrs[name]?.value;
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (ArrayBuffer.isView(value) && 'length' in value && (value as TypedArray).length > 0) return Number((value as TypedArray)[0]);
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0];
  throw new Error(`${ds.path} attribute ${name} is not a number`);
}

/** Raw values, reinterpreted as unsigned where the variable says _Unsigned = "true". */
function readRaw(ds: Dataset): TypedArray {
  const value = ds.value;
  if (value === null) return new Float64Array(0);
  if (!ArrayBuffer.isView(value)) throw new Error(`${ds.path} is not a numeric array`);
  const raw = value as TypedArray;

  const unsigned = ds.attrs['_Unsigned']?.value;
  const isUnsigned = (typeof unsigned === 'string' ? unsigned : Array.isArray(unsigned) ? unsigned[0] : '') === 'true';
  if (!isUnsigned) return raw;
  if (raw instanceof Int16Array) return new Uint16Array(raw.buffer, raw.byteOffset, raw.length);
  if (raw instanceof Int8Array) return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
  if (raw instanceof Int32Array) return new Uint32Array(raw.buffer, raw.byteOffset, raw.length);
  return raw;
}

/** Values with scale_factor and add_offset applied, as a NetCDF reader would. */
function readUnpacked(ds: Dataset): number[] {
  const raw = readRaw(ds);
  const scale = numberAttribute(ds, 'scale_factor') ?? 1;
  const offset = numberAttribute(ds, 'add_offset') ?? 0;
  return Array.from(raw, (v) => v * scale + offset);
}

/** Absolute UTC milliseconds for a variable in "seconds since <base time>" units. */
function readTimes(ds: Dataset): number[] {
  const baseMs = parseUnitsBase(stringAttribute(ds, 'units'));
  return readUnpacked(ds).map((seconds) => Math.round(baseMs + seconds * 1000));
}

/** "seconds since 2026-07-15 20:21:20.000" -> UTC milliseconds. GLM base times carry no zone and are UTC. */
export function parseUnitsBase(units: string): number {
  const match = /^seconds since (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z?$/.exec(units.trim());
  if (!match) throw new Error(`Unexpected time units "${units}"`);
  return parseIsoTime(`${match[1]}T${match[2]}Z`);
}

function parseIsoTime(text: string): number {
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new Error(`Unexpected time "${text}"`);
  return ms;
}
