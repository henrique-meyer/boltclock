# Audio behavior
- **Siren**, chosen in settings. "No siren" skips straight to the announcement. All three are original.
  - **Two-tone**: hi-lo "nee-naw", two pitches a fourth apart, half a second each, about 3.4 s. The mildest.
  - **Mechanical**: a slow civil-defense wail, low → high → low three times over about 4.4 s, with rotor flutter and two slightly detuned horns.
  - **Yelp**: fast sweeps about four times a second, about 3.3 s. The most urgent.
- **Speech**: "Lightning detected {n} miles away" / "{n} kilometers away", n = whole number 0–100 mi or 0–161 km (the 100 mi radius cap), "Lightning detected in the area." for an announcement without the distance, and "No lightning detected in the area." Say "1 mile" / "1 kilometer", and "less than 1 mile" / "less than 1 kilometer" for 0. It must sound clear and consistent on a kiosk device with no internet voice services. If the primary voice method fails, fall back to any other available method rather than staying silent.
- **Chime**: a short rising three-note bell (G–C–E), about 2 s, before the all-clear message.
- **Sequencing**: A = siren → short gap → speech. B = chime → speech. Never overlap sounds; a newer event interrupts the current one.
- **Autoplay**: browsers block sound until a user gesture. Provide a large "Start display" action that enables audio (full screen is a separate top-bar button). If audio is not enabled, show a persistent "click to enable sound" banner. Document a kiosk configuration that allows sound without a click.
- Volume control and test buttons for A and B in settings.
- Sound sets are built-in and selectable later. No uploads.

## How the sounds are made
- **Sirens and chime** are synthesized from scratch by [scripts/audio/synth.ts](../scripts/audio/synth.ts). `npm run audio:sounds` writes them to `assets/audio/` as 16-bit mono WAV files, and a test fails if the committed files no longer match the synthesizer.
- **Speech** is rendered in advance with the ElevenLabs voice "Brian", one file per whole sentence: 265 MP3 clips in `assets/audio/speech/` (`strike-mi-0.mp3` … `strike-mi-100.mp3`, `strike-km-0.mp3` … `strike-km-161.mp3`, `strike-nearby.mp3`, `all-clear.mp3`), about 8 MB. Splicing a separately recorded number into a sentence sounds robotic, because a number spoken on its own carries its own sentence intonation. [scripts/audio/speech.ts](../scripts/audio/speech.ts) lists the sentences and fixes the voice, model and settings. `npm run audio:speech` renders only missing clips (`--force` redoes all, `--only <file>` redoes one) and reads `ELEVENLABS_API_KEY` from `.env`. The clips are used as ElevenLabs returns them, with no trimming or level changes. The running app never calls ElevenLabs: it loads only the clip it needs.
- The browser's built-in speech is the fallback when a clip fails to load.

## How the display plays them
[src/client/audio.ts](../src/client/audio.ts) turns each announcement into steps:
- A: siren, 400 ms gap, sentence;
- B: chime, 250 ms gap, sentence;
- with the siren set to none: just the sentence.

It plays the steps through one Web Audio gain node, which is the volume. A newer announcement aborts the current one, so sounds never overlap. A siren that fails to load is skipped, and a sentence that fails is read by the browser's speech synthesis. The Start button unlocks the audio context and preloads the sirens, the chime and the fixed sentences. Each distance clip loads when it's first needed.
