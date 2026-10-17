// Renders the announcement clips with ElevenLabs. Needs ELEVENLABS_API_KEY in .env.
// Skips clips that already exist, so a rerun only fills gaps. `--force` re-renders everything,
// `--only <file>` (repeatable, e.g. speech/all-clear.mp3) re-renders just those clips.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allClips, VOICE, type Clip } from './speech.js';

const key = process.env.ELEVENLABS_API_KEY?.trim() ?? '';
if (!key) {
  console.error('ELEVENLABS_API_KEY is not set. Add it to .env (see .env.example).');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.flatMap((arg, i) => (args[i - 1] === '--only' ? [arg] : []));
const audioDir = join(import.meta.dirname, '..', '..', 'assets', 'audio');

const todo = allClips().filter((clip) =>
  only.length ? only.includes(clip.file) : force || !existsSync(join(audioDir, clip.file)),
);
console.log(`${todo.length} clip(s) to render.`);

async function render(clip: Clip, attempt = 1): Promise<void> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=${VOICE.outputFormat}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: clip.text, model_id: VOICE.model, seed: VOICE.seed, voice_settings: VOICE.settings }),
  });
  if (res.status === 429 && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    return render(clip, attempt + 1);
  }
  if (!res.ok) throw new Error(`${clip.file}: ${res.status} ${await res.text()}`);
  const out = join(audioDir, clip.file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`${clip.file}  "${clip.text}"`);
}

// A few requests at a time stays inside ElevenLabs' concurrency limit.
const queue = [...todo];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    for (let clip = queue.shift(); clip; clip = queue.shift()) await render(clip);
  }),
);
