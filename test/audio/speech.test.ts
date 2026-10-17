import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CLEAR, STRIKE_NEARBY, allClips, distanceText, strikeClip } from '../../scripts/audio/speech.js';

describe('distanceText', () => {
  it.each([
    [0, 'mi', 'less than 1 mile'],
    [1, 'mi', '1 mile'],
    [2, 'mi', '2 miles'],
    [100, 'mi', '100 miles'],
    [0, 'km', 'less than 1 kilometer'],
    [1, 'km', '1 kilometer'],
    [161, 'km', '161 kilometers'],
  ] as const)('%i %s is "%s"', (n, unit, text) => {
    expect(distanceText(n, unit)).toBe(text);
  });
});

describe('strikeClip', () => {
  it('has a kilometer clip for every mile clip', () => {
    for (let n = 0; n <= 100; n++) expect(strikeClip(n, 'km').text).toMatch(/kilometers? away\.$/);
  });

  it('names the file by unit and distance', () => {
    expect(strikeClip(7, 'mi')).toEqual({
      file: 'speech/strike-mi-7.mp3',
      text: 'Lightning detected 7 miles away.',
    });
  });

  it.each([
    [-1, 'mi'],
    [101, 'mi'],
    [162, 'km'],
    [2.5, 'mi'],
  ] as const)('has no clip for %s %s', (n, unit) => {
    expect(() => strikeClip(n, unit)).toThrow(RangeError);
  });
});

describe('allClips', () => {
  const clips = allClips();

  it('covers 0–100 mi, 0–161 km, a strike with no distance and the all-clear', () => {
    expect(clips).toHaveLength(101 + 162 + 2);
    expect(clips).toContainEqual(STRIKE_NEARBY);
    expect(clips).toContainEqual(ALL_CLEAR);
    expect(new Set(clips.map((clip) => clip.file)).size).toBe(clips.length);
  });

  it('every clip is committed in assets/audio/', () => {
    const missing = clips.filter((clip) => !existsSync(join(import.meta.dirname, '..', '..', 'assets', 'audio', clip.file)));
    expect(missing.map((clip) => clip.file)).toEqual([]);
  });
});
