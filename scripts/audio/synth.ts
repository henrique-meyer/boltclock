// Sirens and the all-clear chime, synthesized from scratch so they are original (CC0).
// `npm run audio:sounds` renders them to assets/audio/. The test suite checks the committed files still match.

export const SAMPLE_RATE = 44100;

/** Siren choices in settings. "none" has no file: the announcement plays on its own. */
export const SIRENS = ['none', 'two-tone', 'mechanical', 'yelp'] as const;
export type SirenId = (typeof SIRENS)[number];

/** Partials as [multiple of the fundamental, amplitude]. */
type Partials = ReadonlyArray<readonly [number, number]>;

interface Tone {
  /** Seconds of sound before the release, then `tail` seconds while it fades out. */
  duration: number;
  tail: number;
  /** Pitch in Hz at time t, for 0 <= t <= duration. Held at its final value through the tail. */
  freq: (t: number) => number;
  partials: Partials;
  fadeIn: number;
  /** The fade out starts `release - tail` seconds before the end of `duration`. */
  release: number;
  /** Seconds for the pitch to catch up with `freq`, like a siren rotor's inertia. 0 follows it exactly. */
  lag?: number;
  /** A second voice detuned by this fraction, like two horns that don't quite agree. */
  detune?: number;
  /** Amplitude flutter: depth 0–1 at `rate` Hz. */
  chop?: { depth: number; rate: number };
  /** Wet share of a small-room reverb, 0–1. */
  reverb?: number;
  /** Peak level after normalizing, 0–1. */
  gain: number;
}

/** Cosine-eased 0 -> 1 -> 0 over one cycle, rising for the first `rise` fraction of it. */
export function sweep(u: number, rise = 0.5): number {
  if (u < rise) return 0.5 - 0.5 * Math.cos((Math.PI * u) / rise);
  return 0.5 + 0.5 * Math.cos((Math.PI * (u - rise)) / (1 - rise));
}

function renderTone(tone: Tone): Float64Array {
  const n = Math.floor(SAMPLE_RATE * (tone.duration + tone.tail));
  const end = tone.duration + tone.tail;
  const voices = tone.detune ? [1, 1 + tone.detune] : [1];
  const phases = voices.map(() => 0);
  const follow = tone.lag ? 1 - Math.exp(-1 / (tone.lag * SAMPLE_RATE)) : 1;
  let f = tone.freq(0);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    f += (tone.freq(Math.min(t, tone.duration)) - f) * follow;
    let s = 0;
    voices.forEach((detune, v) => {
      const phase = (phases[v] ?? 0) + (2 * Math.PI * f * detune) / SAMPLE_RATE;
      phases[v] = phase;
      for (const [k, a] of tone.partials) s += a * Math.sin(k * phase);
    });
    if (tone.chop) s *= 1 - tone.chop.depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * tone.chop.rate * t));
    out[i] = s * Math.min(1, t / tone.fadeIn, Math.max(0, (end - t) / tone.release));
  }
  return finish(tone.reverb ? addReverb(out, tone.reverb) : out, tone.gain);
}

/** A few feedback comb filters: enough room to soften the edges without smearing the pattern. */
function addReverb(dry: Float64Array, mix: number): Float64Array {
  const wet = new Float64Array(dry.length);
  for (const [ms, feedback] of [[29.7, 0.75], [37.1, 0.72], [41.1, 0.7], [43.7, 0.68]] as const) {
    const d = Math.floor((SAMPLE_RATE * ms) / 1000);
    const buf = new Float64Array(dry.length);
    for (let i = 0; i < dry.length; i++) {
      buf[i] = (dry[i] ?? 0) + (i >= d ? feedback * (buf[i - d] ?? 0) : 0);
      wet[i] = (wet[i] ?? 0) + (buf[i] ?? 0) * 0.25;
    }
  }
  return dry.map((x, i) => (1 - mix) * x + mix * (wet[i] ?? 0));
}

/** Normalizes to `gain` and closes with a 10 ms fade, since the reverb is still ringing at the cut. */
function finish(samples: Float64Array, gain: number): Float64Array {
  const peak = samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const fade = SAMPLE_RATE * 0.01;
  return samples.map((x, i) => ((gain * x) / peak) * Math.min(1, (samples.length - 1 - i) / fade));
}

// Two-tone hi-lo ("nee-naw"): two pitches a fourth apart, half a second each, with a 20 ms glide
// between them so there are no clicks. The mildest choice.
const HI_LO = { lo: 560, hi: 750, step: 0.5, glide: 0.02 };
export function twoToneFreq(t: number): number {
  const k = Math.floor(t / HI_LO.step);
  const r = t - k * HI_LO.step;
  const [from, to] = k % 2 ? [HI_LO.hi, HI_LO.lo] : [HI_LO.lo, HI_LO.hi];
  if (k === 0 || r >= HI_LO.glide) return to;
  return from + (to - from) * (r / HI_LO.glide);
}

// Mechanical: a slow civil-defense wail, low -> high -> low three times.
const WAIL = { min: 330, max: 820, cycle: 1.25, cycles: 3 };
export function mechanicalFreq(t: number): number {
  return WAIL.min + (WAIL.max - WAIL.min) * sweep((t % WAIL.cycle) / WAIL.cycle);
}

// Yelp: fast sweeps about four times a second. The most urgent choice.
const YELP = { min: 750, max: 1600, cycle: 0.24, cycles: 13 };
export function yelpFreq(t: number): number {
  return YELP.min + (YELP.max - YELP.min) * sweep((t % YELP.cycle) / YELP.cycle);
}

export function renderSiren(id: Exclude<SirenId, 'none'>): Float64Array {
  switch (id) {
    case 'two-tone':
      return renderTone({
        duration: HI_LO.step * 6,
        tail: 0.35,
        freq: twoToneFreq,
        partials: [[1, 1], [2, 0.3], [3, 0.25], [4, 0.1], [5, 0.08]],
        fadeIn: 0.02,
        release: 0.4,
        reverb: 0.2,
        gain: 0.8,
      });
    case 'mechanical': {
      const duration = WAIL.cycle * WAIL.cycles;
      return renderTone({
        duration,
        tail: 0.6,
        // The rotor spins down to its lowest pitch once the cycles are over.
        freq: (t) => (t >= duration ? WAIL.min : mechanicalFreq(t)),
        partials: [[1, 1], [2, 0.5], [3, 0.4], [4, 0.25], [5, 0.18], [6, 0.1]],
        fadeIn: 0.04,
        release: 0.75,
        lag: 0.12,
        detune: 0.006,
        chop: { depth: 0.25, rate: 38 },
        reverb: 0.3,
        gain: 0.8,
      });
    }
    case 'yelp':
      return renderTone({
        duration: YELP.cycle * YELP.cycles,
        tail: 0.15,
        freq: yelpFreq,
        partials: [[1, 1], [3, 0.33], [5, 0.2], [7, 0.14], [9, 0.11], [11, 0.09]],
        fadeIn: 0.02,
        release: 0.2,
        gain: 0.8,
      });
  }
}

// All-clear chime: a rising G–C–E, each note a soft bell whose upper partials die away first.
const CHIME = {
  notes: [784, 1046.5, 1318.5],
  spacing: 0.22,
  ring: 1.6,
  partials: [[1, 1, 0.55], [2, 0.3, 0.3], [3, 0.12, 0.18], [4.2, 0.05, 0.1]] as const,
};
export const CHIME_DURATION = CHIME.spacing * (CHIME.notes.length - 1) + CHIME.ring;

export function renderChime(): Float64Array {
  const n = Math.floor(SAMPLE_RATE * CHIME_DURATION);
  const out = new Float64Array(n);
  CHIME.notes.forEach((f, note) => {
    const start = Math.floor(note * CHIME.spacing * SAMPLE_RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.005);
      const release = Math.min(1, (CHIME_DURATION - i / SAMPLE_RATE) / 0.3);
      let s = 0;
      for (const [k, a, decay] of CHIME.partials) s += a * Math.exp(-t / decay) * Math.sin(2 * Math.PI * f * k * t);
      out[i] = (out[i] ?? 0) + s * attack * release;
    }
  });
  return finish(addReverb(out, 0.2), 0.7);
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float64Array): Buffer {
  const data = samples.length * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);
  samples.forEach((x, i) => wav.writeInt16LE(Math.round(32767 * Math.max(-1, Math.min(1, x))), 44 + i * 2));
  return wav;
}

/** The PCM samples of a WAV written by encodeWav. */
export function decodeWav(wav: Buffer): Int16Array {
  const data = wav.readUInt32LE(40);
  const samples = new Int16Array(data / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(44 + i * 2);
  return samples;
}

/** Every rendered sound, by its file name in assets/audio/. */
export function renderAll(): Record<string, Float64Array> {
  return {
    'siren-two-tone.wav': renderSiren('two-tone'),
    'siren-mechanical.wav': renderSiren('mechanical'),
    'siren-yelp.wav': renderSiren('yelp'),
    'chime.wav': renderChime(),
  };
}
