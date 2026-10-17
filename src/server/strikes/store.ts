import { cellKey, cellsForCircle, distanceKm } from '../../shared/geo.js';
import type { GlmFile } from '../glm/parse.js';
import { flashRowKey, flashTableHourMs, flashTableName, flashTablesBetween, timeKey } from './keys.js';

/** One flash as stored: a row in an hourly table, partitioned by grid cell. */
export interface FlashRow {
  partitionKey: string;
  rowKey: string;
  id: number;
  timeMs: number;
  lat: number;
  lon: number;
  /** Start of the GLM file the flash came from, UTC ms. */
  fileStartMs: number;
}

/** The storage operations BOLT-15 needs. AzureTableStore implements them on Table Storage; MemoryTableStore in tests. */
export interface TableStore {
  /** Inserts or replaces rows. All rows share one partition; at most 100 per call (one entity group transaction). */
  upsertPartition(table: string, partitionKey: string, rows: FlashRow[]): Promise<void>;
  /** Rows in a partition with RowKey >= fromRowKey. Resolves to [] when the table does not exist. */
  queryPartition(table: string, partitionKey: string, fromRowKey: string): Promise<FlashRow[]>;
  listTables(prefix: string): Promise<string[]>;
  deleteTable(table: string): Promise<void>;
  /** Raises the stored newest file end time, never lowers it. Resolves to the value now stored. */
  raiseLatestFileEnd(endMs: number): Promise<number>;
  /** Newest GLM file end time stored, or undefined before the first write. */
  latestFileEnd(): Promise<number | undefined>;
}

/** Flashes older than this are deleted and never returned. Also the longest time limit a display may set. */
export const RETENTION_MS = 120 * 60_000;
const BATCH_LIMIT = 100;

/** Stores one parsed GLM file: groups flashes by table and cell, writes them in batches, then raises the status row. */
export async function storeGlmFile(store: TableStore, glm: GlmFile): Promise<{ rows: number; batches: number }> {
  const groups = new Map<string, FlashRow[]>(); // "table|cell" -> rows
  for (const flash of glm.flashes) {
    const table = flashTableName(flash.timeMs);
    const partitionKey = cellKey(flash.lat, flash.lon);
    const row: FlashRow = {
      partitionKey,
      rowKey: flashRowKey(flash.timeMs, flash.id),
      id: flash.id,
      timeMs: flash.timeMs,
      lat: flash.lat,
      lon: flash.lon,
      fileStartMs: glm.startMs,
    };
    const key = `${table}|${partitionKey}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  let batches = 0;
  await Promise.all(
    [...groups].flatMap(([key, rows]) => {
      const [table, partitionKey] = key.split('|') as [string, string];
      const chunks: FlashRow[][] = [];
      for (let i = 0; i < rows.length; i += BATCH_LIMIT) chunks.push(rows.slice(i, i + BATCH_LIMIT));
      batches += chunks.length;
      return chunks.map((chunk) => store.upsertPartition(table, partitionKey, chunk));
    }),
  );

  // Only after the flashes are stored, so a display never sees fresh status with missing flashes.
  await store.raiseLatestFileEnd(glm.endMs);
  return { rows: glm.flashes.length, batches };
}

/** Deletes hourly flash tables that hold nothing newer than the retention window. Returns the deleted names. */
export async function purgeOldTables(store: TableStore, nowMs: number): Promise<string[]> {
  const cutoff = nowMs - RETENTION_MS;
  const old = (await store.listTables('glm')).filter((name) => {
    const hour = flashTableHourMs(name);
    return hour !== undefined && hour + 3_600_000 <= cutoff;
  });
  await Promise.all(old.map((name) => store.deleteTable(name)));
  return old;
}

export interface StrikeQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  /** Earliest flash time to return, UTC ms. Clamped to the retention window. */
  sinceMs: number;
  nowMs: number;
}

export interface Strike {
  /** GLM flash id, unique within its file. */
  id: number;
  /** Start of the GLM file the flash came from; with id it identifies the flash globally. */
  fileStartMs: number;
  timeMs: number;
  lat: number;
  lon: number;
  distanceKm: number;
}

/** Flashes within radiusKm of a point since sinceMs, nearest-in-time last. Reads only the grid cells the circle touches. */
export async function queryStrikes(store: TableStore, query: StrikeQuery): Promise<Strike[]> {
  const sinceMs = Math.max(query.sinceMs, query.nowMs - RETENTION_MS);
  const fromRowKey = timeKey(sinceMs);
  const cells = cellsForCircle(query.lat, query.lon, query.radiusKm);
  const tables = flashTablesBetween(sinceMs, query.nowMs);

  const results = await Promise.all(
    tables.flatMap((table) => cells.map((cell) => store.queryPartition(table, cell, fromRowKey))),
  );

  const strikes: Strike[] = [];
  const seen = new Set<string>();
  for (const row of results.flat()) {
    if (row.timeMs < sinceMs || seen.has(row.rowKey)) continue;
    const distance = distanceKm(query.lat, query.lon, row.lat, row.lon);
    if (distance > query.radiusKm) continue;
    seen.add(row.rowKey);
    strikes.push({ id: row.id, fileStartMs: row.fileStartMs, timeMs: row.timeMs, lat: row.lat, lon: row.lon, distanceKm: distance });
  }
  return strikes.sort((a, b) => a.timeMs - b.timeMs);
}

/** In-memory TableStore for tests and local development. */
export class MemoryTableStore implements TableStore {
  readonly tables = new Map<string, Map<string, FlashRow>>();
  latestEnd: number | undefined;
  upsertCalls = 0;

  async upsertPartition(table: string, partitionKey: string, rows: FlashRow[]): Promise<void> {
    if (rows.length > BATCH_LIMIT) throw new Error(`A batch holds at most ${BATCH_LIMIT} rows`);
    if (rows.some((r) => r.partitionKey !== partitionKey)) throw new Error('A batch must stay in one partition');
    this.upsertCalls++;
    let t = this.tables.get(table);
    if (!t) this.tables.set(table, (t = new Map()));
    for (const row of rows) t.set(`${row.partitionKey}|${row.rowKey}`, { ...row });
  }

  async queryPartition(table: string, partitionKey: string, fromRowKey: string): Promise<FlashRow[]> {
    const t = this.tables.get(table);
    if (!t) return [];
    return [...t.values()]
      .filter((r) => r.partitionKey === partitionKey && r.rowKey >= fromRowKey)
      .sort((a, b) => (a.rowKey < b.rowKey ? -1 : 1));
  }

  async listTables(prefix: string): Promise<string[]> {
    return [...this.tables.keys()].filter((name) => name.startsWith(prefix)).sort();
  }

  async deleteTable(table: string): Promise<void> {
    this.tables.delete(table);
  }

  async raiseLatestFileEnd(endMs: number): Promise<number> {
    this.latestEnd = Math.max(this.latestEnd ?? endMs, endMs);
    return this.latestEnd;
  }

  async latestFileEnd(): Promise<number | undefined> {
    return this.latestEnd;
  }
}
