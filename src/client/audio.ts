import { ALL_CLEAR, strikeAnnouncement, type Clip, type Unit } from '../shared/announcements.js';
import type { SirenId } from './alert-settings.js';

/** What the display announces (docs/audio-plan.md). A: siren, then the distance. B: chime, then the all-clear. */
export type Announcement = { kind: 'strike'; distance: number | null; unit: Unit } | { kind: 'all-clear' };

export type Step =
  | { type: 'sound'; file: string }
  | { type: 'gap'; ms: number }
  /** A spoken sentence: the recorded clip, or the browser's voice reading `text` when the clip cannot play. */
  | { type: 'speech'; clip: Clip };

const SIREN_FILES: Record<Exclude<SirenId, 'none'>, string> = {
  'two-tone': 'siren-two-tone.wav',
  mechanical: 'siren-mechanical.wav',
  yelp: 'siren-yelp.wav',
};

/**
 * The sounds for one announcement, in order. "No siren" goes straight to the sentence; with `speak` off the sentence
 * is left out, so no siren and no announcement is silent.
 */
export function sequenceFor(announcement: Announcement, siren: SirenId, speak = true): Step[] {
  if (announcement.kind === 'all-clear') {
    const chime: Step = { type: 'sound', file: 'chime.wav' };
    return speak ? [chime, { type: 'gap', ms: 250 }, { type: 'speech', clip: ALL_CLEAR }] : [chime];
  }
  const sentence: Step[] = speak
    ? [{ type: 'speech', clip: strikeAnnouncement(announcement.distance ?? Number.NaN, announcement.unit) }]
    : [];
  if (siren === 'none') return sentence;
  const sound: Step = { type: 'sound', file: SIREN_FILES[siren] };
  return speak ? [sound, { type: 'gap', ms: 400 }, ...sentence] : [sound];
}

/** Where sound comes out. WebAudioOutput in the browser; a recorder in tests. */
export interface SoundOutput {
  /** Plays assets/audio/<file> to the end. Rejects if it cannot load. Stops early when `signal` aborts. */
  play(file: string, signal: AbortSignal): Promise<void>;
  /** Reads text with the browser's own voice: the fallback when a clip fails. */
  speak(text: string, signal: AbortSignal): Promise<void>;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}

/** Plays announcements one at a time. A newer one interrupts the current one, so sounds never overlap. */
export class Announcer {
  private current: AbortController | undefined;

  constructor(
    private readonly output: SoundOutput,
    private readonly siren: () => SirenId,
    private readonly onError: (message: string) => void = () => {},
    /** Whether to speak the sentence (the announcement setting). */
    private readonly speak: () => boolean = () => true,
  ) {}

  /** Resolves when the announcement finishes or is interrupted. */
  async announce(announcement: Announcement): Promise<void> {
    this.current?.abort();
    const controller = new AbortController();
    this.current = controller;
    const { signal } = controller;

    for (const step of sequenceFor(announcement, this.siren(), this.speak())) {
      if (signal.aborted) return;
      try {
        if (step.type === 'gap') await this.output.wait(step.ms, signal);
        else if (step.type === 'sound') await this.output.play(step.file, signal);
        else await this.playSpeech(step.clip, signal);
      } catch (error) {
        if (signal.aborted) return;
        // A siren or chime that fails to load is skipped; the sentence still plays.
        this.onError(error instanceof Error ? error.message : String(error));
      }
    }
    if (this.current === controller) this.current = undefined;
  }

  stop(): void {
    this.current?.abort();
    this.current = undefined;
  }

  private async playSpeech(clip: Clip, signal: AbortSignal): Promise<void> {
    try {
      await this.output.play(clip.file, signal);
    } catch (error) {
      if (signal.aborted) return;
      this.onError(`${clip.file}: ${error instanceof Error ? error.message : String(error)}; using the browser voice`);
      await this.output.speak(clip.text, signal);
    }
  }
}

/** Web Audio output: decoded clips are cached, and the volume is one gain node. */
export class WebAudioOutput implements SoundOutput {
  private context: AudioContext | undefined;
  private gain: GainNode | undefined;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private volume = 1;

  /** Browsers allow sound only after a user gesture: call this from a click. True when sound is now on. */
  async unlock(): Promise<boolean> {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
    return this.unlocked;
  }

  get unlocked(): boolean {
    return this.context?.state === 'running';
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Starts downloading clips so the first alarm does not wait on the network. */
  preload(files: string[]): void {
    for (const file of files) void this.buffer(file).catch(() => {});
  }

  async play(file: string, signal: AbortSignal): Promise<void> {
    const context = this.context;
    if (!context || !this.gain || context.state !== 'running') throw new Error('sound is not enabled yet');
    const buffer = await this.buffer(file);
    if (signal.aborted) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      signal.addEventListener('abort', () => {
        source.stop();
        resolve();
      }, { once: true });
      source.start();
    });
  }

  async speak(text: string, signal: AbortSignal): Promise<void> {
    if (!('speechSynthesis' in window)) throw new Error('no speech engine');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = this.volume;
    await new Promise<void>((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      signal.addEventListener('abort', () => {
        window.speechSynthesis.cancel();
        resolve();
      }, { once: true });
      window.speechSynthesis.speak(utterance);
    });
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  private buffer(file: string): Promise<AudioBuffer> {
    let cached = this.buffers.get(file);
    if (!cached) {
      cached = (async () => {
        const response = await fetch(`/assets/audio/${file}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        // Decoding needs a context; before unlock an offline one works and the buffer plays later in the real one.
        const decoder = this.context ?? new OfflineAudioContext(1, 1, 44_100);
        return decoder.decodeAudioData(bytes);
      })();
      this.buffers.set(file, cached);
      cached.catch(() => this.buffers.delete(file));
    }
    return cached;
  }
}
