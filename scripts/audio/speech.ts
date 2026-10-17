// The spoken announcements: one clip per whole sentence, so the distance keeps natural intonation.
// `npm run audio:speech` renders any missing clips with ElevenLabs into assets/audio/speech/.
// The sentences themselves live in src/shared/announcements.ts, which the display's fallback voice also reads.

export { ALL_CLEAR, MAX_DISTANCE, STRIKE_NEARBY, allClips, distanceText, strikeClip } from '../../src/shared/announcements.js';
export type { Clip, Unit } from '../../src/shared/announcements.js';

/** ElevenLabs voice "Brian" (deep, resonant), with settings kept steady so every clip sounds alike. */
export const VOICE = {
  id: 'nPczCjzI2devNBz1zQrb',
  model: 'eleven_multilingual_v2',
  outputFormat: 'mp3_44100_96',
  seed: 7,
  settings: { stability: 0.6, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
} as const;
