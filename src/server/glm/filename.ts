/**
 * GLM-L2-LCFA object names, e.g.
 * GLM-L2-LCFA/2026/196/20/OR_GLM-L2-LCFA_G19_s20261962021200_e20261962021400_c20261962021423.nc
 * Each time is YYYY DDD HH MM SS plus tenths of a second, with DDD the day of the year (UTC).
 */
export interface GlmFileName {
  satellite: string;
  startMs: number;
  endMs: number;
  createdMs: number;
}

const NAME = /OR_GLM-L2-LCFA_(G\d{2})_s(\d{14})_e(\d{14})_c(\d{14})\.nc$/;

export function parseGlmFileName(key: string): GlmFileName {
  const match = NAME.exec(key);
  if (!match) throw new Error(`Not a GLM-L2-LCFA file name: "${key}"`);
  return {
    satellite: match[1]!,
    startMs: parseGlmTime(match[2]!),
    endMs: parseGlmTime(match[3]!),
    createdMs: parseGlmTime(match[4]!),
  };
}

/** "20261962021200" (YYYY DDD HH MM SS t) -> UTC milliseconds. */
export function parseGlmTime(text: string): number {
  const match = /^(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)$/.exec(text);
  if (!match) throw new Error(`Not a GLM time: "${text}"`);
  const [year, day, hour, minute, second, tenth] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const daysInYear = isLeapYear(year) ? 366 : 365;
  if (day < 1 || day > daysInYear || hour > 23 || minute > 59 || second > 60) throw new Error(`Not a GLM time: "${text}"`);
  return Date.UTC(year, 0, day, hour, minute, second, tenth * 100);
}

/** The bucket folder holding files that start in the given UTC hour: GLM-L2-LCFA/YYYY/DDD/HH/. */
export function glmHourPrefix(timeMs: number): string {
  const date = new Date(timeMs);
  const year = date.getUTCFullYear();
  const day = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `GLM-L2-LCFA/${year}/${String(day).padStart(3, '0')}/${String(date.getUTCHours()).padStart(2, '0')}/`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
