// The spoken announcements: one clip per whole sentence, so the distance keeps natural intonation.
// `npm run audio:speech` renders any missing clips with ElevenLabs into assets/audio/speech/.

export type Unit = 'mi' | 'km';

/** The radius is capped at 100 mi, which is 160.9 km, so a rounded distance never exceeds these. */
export const MAX_DISTANCE: Record<Unit, number> = { mi: 100, km: 161 };

/** ElevenLabs voice "Brian" (deep, resonant), with settings kept steady so every clip sounds alike. */
export const VOICE = {
  id: 'nPczCjzI2devNBz1zQrb',
  model: 'eleven_multilingual_v2',
  outputFormat: 'mp3_44100_96',
  seed: 7,
  settings: { stability: 0.6, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
} as const;

export interface Clip {
  /** Path under assets/audio/. */
  file: string;
  text: string;
}

export function distanceText(n: number, unit: Unit): string {
  const word = unit === 'mi' ? 'mile' : 'kilometer';
  if (n === 0) return `less than 1 ${word}`;
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

export function strikeClip(n: number, unit: Unit): Clip {
  if (!Number.isInteger(n) || n < 0 || n > MAX_DISTANCE[unit]) {
    throw new RangeError(`No clip for ${n} ${unit}`);
  }
  return { file: `speech/strike-${unit}-${n}.mp3`, text: `Lightning detected ${distanceText(n, unit)} away.` };
}

/** A strike announcement that leaves the distance out. */
export const STRIKE_NEARBY: Clip = { file: 'speech/strike-nearby.mp3', text: 'Lightning detected in the area.' };

export const ALL_CLEAR: Clip = { file: 'speech/all-clear.mp3', text: 'No lightning detected in the area.' };

export function allClips(): Clip[] {
  const clips: Clip[] = [];
  for (const unit of ['mi', 'km'] as const) {
    for (let n = 0; n <= MAX_DISTANCE[unit]; n++) clips.push(strikeClip(n, unit));
  }
  clips.push(STRIKE_NEARBY, ALL_CLEAR);
  return clips;
}
