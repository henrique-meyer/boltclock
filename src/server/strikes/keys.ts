/**
 * Table Storage layout for flashes (BOLT-15, ADR 0004):
 * one table per UTC hour of the flash time, PartitionKey = 1° grid cell, RowKey = sortable time + flash id.
 */

export const FLASH_TABLE_PREFIX = 'glm';
const HOUR_MS = 3_600_000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "glm2026101715" for any time in 2026-10-17 15:00–15:59:59.999 UTC. */
export function flashTableName(timeMs: number): string {
  const d = new Date(timeMs);
  return `${FLASH_TABLE_PREFIX}${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
}

/** Start of the hour a flash table holds, or undefined for a name that is not a flash table. */
export function flashTableHourMs(name: string): number | undefined {
  const match = /^glm(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(name);
  if (!match) return undefined;
  const [year, month, day, hour] = match.slice(1).map(Number) as [number, number, number, number];
  return Date.UTC(year, month - 1, day, hour);
}

/** Flash tables covering [fromMs, toMs], oldest first. */
export function flashTablesBetween(fromMs: number, toMs: number): string[] {
  const names: string[] = [];
  for (let hour = Math.floor(fromMs / HOUR_MS) * HOUR_MS; hour <= toMs; hour += HOUR_MS) names.push(flashTableName(hour));
  return names;
}

/** "20261017T153021.437Z", which sorts in time order as a string. */
export function timeKey(timeMs: number): string {
  const d = new Date(timeMs);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

/** "20261017T153021.437Z_00412": unique per flash, because GLM ids are unique within a file and files do not overlap in time. */
export function flashRowKey(timeMs: number, flashId: number): string {
  return `${timeKey(timeMs)}_${pad(flashId, 5)}`;
}
