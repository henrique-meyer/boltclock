import { describe, expect, it } from 'vitest';
import { Announcer, sequenceFor, type SoundOutput } from '../../src/client/audio.js';
import { strikeAnnouncement } from '../../src/shared/announcements.js';

describe('sequenceFor', () => {
  it('plays A as siren, a short gap, then the distance sentence', () => {
    expect(sequenceFor({ kind: 'strike', distance: 7, unit: 'mi' }, 'yelp')).toEqual([
      { type: 'sound', file: 'siren-yelp.wav' },
      { type: 'gap', ms: 400 },
      { type: 'speech', clip: { file: 'speech/strike-mi-7.mp3', text: 'Lightning detected 7 miles away.' } },
    ]);
  });

  it('skips the siren when it is set to none', () => {
    expect(sequenceFor({ kind: 'strike', distance: 1, unit: 'km' }, 'none')).toEqual([
      { type: 'speech', clip: { file: 'speech/strike-km-1.mp3', text: 'Lightning detected 1 kilometer away.' } },
    ]);
  });

  it('plays B as chime, then the all-clear sentence', () => {
    expect(sequenceFor({ kind: 'all-clear' }, 'two-tone')).toEqual([
      { type: 'sound', file: 'chime.wav' },
      { type: 'gap', ms: 250 },
      { type: 'speech', clip: { file: 'speech/all-clear.mp3', text: 'No lightning detected in the area.' } },
    ]);
  });

  it('says "less than 1 mile" for 0 and falls back to the distance-free sentence past the clips', () => {
    expect(strikeAnnouncement(0, 'mi').text).toBe('Lightning detected less than 1 mile away.');
    expect(strikeAnnouncement(162, 'km')).toEqual({ file: 'speech/strike-nearby.mp3', text: 'Lightning detected in the area.' });
    expect(strikeAnnouncement(Number.NaN, 'mi').file).toBe('speech/strike-nearby.mp3');
  });
});

/** Records what plays; clips listed in `missing` fail to load. `hold` keeps a file "playing" until released. */
class FakeOutput implements SoundOutput {
  readonly log: string[] = [];
  readonly holds = new Map<string, () => void>();
  constructor(
    private readonly missing: string[] = [],
    private readonly hold: string[] = [],
  ) {}
  async play(file: string, signal: AbortSignal) {
    if (this.missing.includes(file)) throw new Error('404');
    this.log.push(`play ${file}`);
    if (this.hold.includes(file)) {
      await new Promise<void>((resolve) => {
        this.holds.set(file, resolve);
        signal.addEventListener('abort', () => {
          this.log.push(`stop ${file}`);
          resolve();
        });
      });
    }
  }
  async speak(text: string) {
    this.log.push(`speak ${text}`);
  }
  async wait(ms: number) {
    this.log.push(`wait ${ms}`);
  }
}

describe('Announcer', () => {
  it('plays the steps in order', async () => {
    const out = new FakeOutput();
    await new Announcer(out, () => 'two-tone').announce({ kind: 'strike', distance: 12, unit: 'mi' });

    expect(out.log).toEqual(['play siren-two-tone.wav', 'wait 400', 'play speech/strike-mi-12.mp3']);
  });

  it('lets a newer announcement interrupt the current one, so sounds never overlap', async () => {
    const out = new FakeOutput([], ['siren-mechanical.wav']);
    const announcer = new Announcer(out, () => 'mechanical');
    const first = announcer.announce({ kind: 'strike', distance: 20, unit: 'mi' });
    await Promise.resolve();
    await announcer.announce({ kind: 'all-clear' });
    await first;

    expect(out.log).toEqual([
      'play siren-mechanical.wav',
      'stop siren-mechanical.wav',
      'play chime.wav',
      'wait 250',
      'play speech/all-clear.mp3',
    ]);
  });

  it('falls back to the browser voice when a speech clip cannot load', async () => {
    const errors: string[] = [];
    const out = new FakeOutput(['speech/all-clear.mp3']);
    await new Announcer(out, () => 'two-tone', (m) => errors.push(m)).announce({ kind: 'all-clear' });

    expect(out.log.at(-1)).toBe('speak No lightning detected in the area.');
    expect(errors[0]).toMatch(/all-clear\.mp3.*browser voice/);
  });

  it('still speaks when the siren cannot load', async () => {
    const out = new FakeOutput(['siren-yelp.wav']);
    await new Announcer(out, () => 'yelp').announce({ kind: 'strike', distance: 3, unit: 'km' });

    expect(out.log).toEqual(['wait 400', 'play speech/strike-km-3.mp3']);
  });

  it('stop() silences the current announcement', async () => {
    const out = new FakeOutput([], ['siren-yelp.wav']);
    const announcer = new Announcer(out, () => 'yelp');
    const playing = announcer.announce({ kind: 'strike', distance: 3, unit: 'km' });
    await Promise.resolve();
    announcer.stop();
    await playing;

    expect(out.log).toEqual(['play siren-yelp.wav', 'stop siren-yelp.wav']);
  });
});
