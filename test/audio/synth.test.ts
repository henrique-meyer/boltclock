import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHIME_DURATION,
  SAMPLE_RATE,
  decodeWav,
  encodeWav,
  mechanicalFreq,
  renderAll,
  renderChime,
  renderSiren,
  sweep,
  twoToneFreq,
  yelpFreq,
} from '../../scripts/audio/synth.js';

const seconds = (samples: ArrayLike<number>) => samples.length / SAMPLE_RATE;
const peak = (samples: Float64Array) => samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('sweep', () => {
  it('rises from 0 to 1 and falls back to 0', () => {
    expect(sweep(0)).toBe(0);
    expect(sweep(0.5)).toBe(1);
    expect(sweep(0.999)).toBeCloseTo(0, 4);
  });

  it('peaks where the rise ends', () => {
    expect(sweep(0.3, 0.3)).toBe(1);
  });
});

describe('siren pitch patterns', () => {
  it('two-tone alternates between two pitches every half second', () => {
    expect(twoToneFreq(0.25)).toBe(750);
    expect(twoToneFreq(0.75)).toBe(560);
    expect(twoToneFreq(1.25)).toBe(750);
  });

  it('two-tone glides between the pitches instead of jumping', () => {
    const mid = twoToneFreq(0.51);
    expect(mid).toBeGreaterThan(560);
    expect(mid).toBeLessThan(750);
  });

  it('mechanical wails from 330 to 820 Hz and back every 1.25 s', () => {
    expect(mechanicalFreq(0)).toBe(330);
    expect(mechanicalFreq(0.625)).toBe(820);
    expect(mechanicalFreq(1.25)).toBe(330);
  });

  it('yelp sweeps about four times a second', () => {
    expect(yelpFreq(0)).toBe(750);
    expect(yelpFreq(0.12)).toBeCloseTo(1600, 6);
    expect(yelpFreq(0.24)).toBeCloseTo(750, 6);
  });
});

describe('rendered sounds', () => {
  it.each([
    ['two-tone', 3.35],
    ['mechanical', 4.35],
    ['yelp', 3.27],
  ] as const)('%s lasts about %f s and is normalized', (id, length) => {
    const samples = renderSiren(id);
    expect(seconds(samples)).toBeCloseTo(length, 1);
    expect(peak(samples)).toBeCloseTo(0.8, 6);
    expect(samples.every(Number.isFinite)).toBe(true);
  });

  it('every sound starts and ends in silence, so playback never clicks', () => {
    for (const samples of Object.values(renderAll())) {
      expect(Math.abs(samples[0] ?? 1)).toBeLessThan(1e-3);
      expect(Math.abs(samples.at(-1) ?? 1)).toBe(0);
    }
  });

  it('the chime rings for its full length', () => {
    const samples = renderChime();
    expect(seconds(samples)).toBeCloseTo(CHIME_DURATION, 2);
    expect(peak(samples)).toBeCloseTo(0.7, 6);
  });
});

describe('WAV encoding', () => {
  it('writes a 16-bit mono PCM header and round-trips the samples', () => {
    const samples = new Float64Array([0, 0.5, -0.5, 1, -1, 2]);
    const wav = encodeWav(samples);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(Array.from(decodeWav(wav))).toEqual([0, 16384, -16383, 32767, -32767, 32767]);
  });
});

describe('committed sound files', () => {
  // Fails when synth.ts changed without `npm run audio:sounds`. A small tolerance absorbs
  // last-digit floating-point differences between machines.
  it.each(Object.entries(renderAll()))('assets/audio/%s matches the synthesizer', (name, samples) => {
    const committed = decodeWav(readFileSync(join(import.meta.dirname, '..', '..', 'assets', 'audio', name)));
    const fresh = decodeWav(encodeWav(samples));
    expect(committed.length).toBe(fresh.length);
    let worst = 0;
    for (let i = 0; i < fresh.length; i++) worst = Math.max(worst, Math.abs((committed[i] ?? 0) - (fresh[i] ?? 0)));
    expect(worst).toBeLessThanOrEqual(2);
  });
});
