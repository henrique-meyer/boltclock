import { describe, expect, it } from 'vitest';
import { glmHourPrefix, parseGlmFileName, parseGlmTime } from '../../../src/server/glm/filename.js';

describe('parseGlmFileName', () => {
  it('reads satellite, start, end and created times from a bucket key', () => {
    const name = parseGlmFileName(
      'GLM-L2-LCFA/2026/196/20/OR_GLM-L2-LCFA_G19_s20261962021200_e20261962021400_c20261962021423.nc',
    );

    expect(name).toEqual({
      satellite: 'G19',
      startMs: Date.UTC(2026, 6, 15, 20, 21, 20),
      endMs: Date.UTC(2026, 6, 15, 20, 21, 40),
      createdMs: Date.UTC(2026, 6, 15, 20, 21, 42, 300),
    });
  });

  it('handles a file that ends in the next hour, day and year', () => {
    const name = parseGlmFileName('OR_GLM-L2-LCFA_G19_s20263652359400_e20270010000000_c20270010000021.nc');

    expect(new Date(name.startMs).toISOString()).toBe('2026-12-31T23:59:40.000Z');
    expect(new Date(name.endMs).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects other files in the bucket', () => {
    expect(() => parseGlmFileName('ABI-L2-CMIPF/2026/196/20/OR_ABI-L2-CMIPF-M6C13_G19_s20261962020206.nc')).toThrow(
      /Not a GLM-L2-LCFA file name/,
    );
  });
});

describe('parseGlmTime', () => {
  it('accepts day 366 only in a leap year', () => {
    expect(new Date(parseGlmTime('20283660000000')).toISOString()).toBe('2028-12-31T00:00:00.000Z');
    expect(() => parseGlmTime('20263660000000')).toThrow(/Not a GLM time/);
  });

  it('rejects day 000', () => {
    expect(() => parseGlmTime('20260000000000')).toThrow(/Not a GLM time/);
  });
});

describe('glmHourPrefix', () => {
  it('uses the UTC day of the year', () => {
    expect(glmHourPrefix(Date.UTC(2026, 6, 15, 20, 21, 20))).toBe('GLM-L2-LCFA/2026/196/20/');
    expect(glmHourPrefix(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe('GLM-L2-LCFA/2026/001/00/');
    expect(glmHourPrefix(Date.UTC(2028, 11, 31, 23, 59, 59))).toBe('GLM-L2-LCFA/2028/366/23/');
  });
});
