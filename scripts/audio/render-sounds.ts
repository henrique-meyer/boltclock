// Writes the sirens and the chime to assets/audio/. Run with `npm run audio:sounds` after changing synth.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWav, renderAll, SAMPLE_RATE } from './synth.js';

const outDir = join(import.meta.dirname, '..', '..', 'assets', 'audio');
mkdirSync(outDir, { recursive: true });

for (const [name, samples] of Object.entries(renderAll())) {
  writeFileSync(join(outDir, name), encodeWav(samples));
  console.log(`${name}  ${(samples.length / SAMPLE_RATE).toFixed(2)} s`);
}
