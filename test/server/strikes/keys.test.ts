import { describe, expect, it } from 'vitest';
import { flashRowKey, flashTableHourMs, flashTableName, flashTablesBetween, timeKey } from '../../../src/server/strikes/keys.js';

describe('flash table names', () => {
  it('names one table per UTC hour', () => {
    expect(flashTableName(Date.UTC(2026, 9, 17, 15, 0, 0))).toBe('glm2026101715');
    expect(flashTableName(Date.UTC(2026, 9, 17, 15, 59, 59, 999))).toBe('glm2026101715');
    expect(flashTableName(Date.UTC(2026, 9, 17, 16, 0, 0))).toBe('glm2026101716');
  });

  it('reads the hour back, and ignores other tables', () => {
    expect(flashTableHourMs('glm2026123123')).toBe(Date.UTC(2026, 11, 31, 23));
    expect(flashTableHourMs('boltstatus')).toBeUndefined();
  });

  it('lists the tables a time range touches, across a day boundary', () => {
    expect(flashTablesBetween(Date.UTC(2026, 11, 31, 22, 45), Date.UTC(2027, 0, 1, 0, 15))).toEqual([
      'glm2026123122',
      'glm2026123123',
      'glm2027010100',
    ]);
  });
});

describe('row keys', () => {
  it('sort in time order as strings', () => {
    const keys = [
      flashRowKey(Date.UTC(2026, 9, 17, 15, 30, 21, 437), 412),
      flashRowKey(Date.UTC(2026, 9, 17, 15, 30, 21, 437), 65535),
      flashRowKey(Date.UTC(2026, 9, 17, 15, 30, 22, 5), 7),
    ];
    expect(keys[0]).toBe('20261017T153021.437Z_00412');
    expect([...keys].sort()).toEqual(keys);
  });

  it('a time bound sorts before every flash at or after it', () => {
    const bound = timeKey(Date.UTC(2026, 9, 17, 15, 30, 21, 437));
    expect(bound < flashRowKey(Date.UTC(2026, 9, 17, 15, 30, 21, 437), 0)).toBe(true);
    expect(bound > flashRowKey(Date.UTC(2026, 9, 17, 15, 30, 21, 436), 65535)).toBe(true);
  });
});
