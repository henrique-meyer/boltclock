import './styles.css';
import { fetchClientConfig } from './client-config.js';
import {
  CLOCK_LABELS,
  CLOCKS,
  loadAlertSettings,
  saveAlertSettings,
  SIREN_LABELS,
  SIRENS,
  TEMPERATURE_LABELS,
  TEMPERATURE_UNITS,
  type AlertSettings,
  type ClockFormat,
  type SirenId,
  type TemperatureUnit,
} from './alert-settings.js';
import { Announcer, WebAudioOutput, type Announcement } from './audio.js';
import { mountBackdrop } from './backdrop.js';
import { DisplayController, type ControllerView } from './display-controller.js';
import { resolveDisplaySettings, startAtBrowserLocation } from './display-settings.js';
import { currentPosition } from './geolocation.js';
import { DEFAULT_RADIUS, type KeyValueStore } from './location-settings.js';
import { openStream, type ConnectionState } from './stream.js';
import type { UrlSettings } from './url-settings.js';
import { backgroundOverride, backgroundScene, type BackgroundScene } from './weather-background.js';
import { mountWeatherPanel, type WeatherPanel } from './weather-panel.js';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Reading window.localStorage throws when the browser blocks site data; the display then needs ?lat&lon. */
function deviceStore(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const store = deviceStore();
let alerts = loadAlertSettings(store);
/** What the display watches. Undefined on a first visit until the Start screen sets it. */
let location = resolveDisplaySettings(window.location.search, store);

// ---- Weather background: follows the weather panel's answers, unless ?background= pins a scene ----
const backdrop = mountBackdrop(document.getElementById('backdrop'));
const pinnedBackground = backgroundOverride(window.location.search);
function showBackground(scene: BackgroundScene): void {
  document.body.dataset.weather = scene;
  backdrop.show(scene);
}
showBackground(pinnedBackground ?? 'neutral');

let weather: WeatherPanel | undefined;

/** The deployment's settings for the browser, fetched once. */
const clientConfig = fetchClientConfig();
// BUTTON_ICONS_ONLY: the top-right buttons drop their text labels.
void clientConfig.then((config) => document.body.classList.toggle('icons-only', config.buttonIconsOnly)).catch(() => {});

const status = byId<HTMLParagraphElement>('status');
const start = byId<HTMLDivElement>('start');

// ---- Sound ----
const output = new WebAudioOutput();
output.setVolume(alerts.volume);
const announcer = new Announcer(
  output,
  () => alerts.siren,
  (message) => console.warn(`Sound: ${message}`),
  () => alerts.announcement,
);
const soundBanner = byId<HTMLButtonElement>('sound-banner');
let started = false;

function announce(announcement: Announcement): void {
  if (!output.unlocked) soundBanner.hidden = !started;
  void announcer.announce(announcement);
}

async function enableSound(): Promise<void> {
  try {
    await output.unlock();
  } catch {
    // Some browsers refuse an audio context outright; the banner stays.
  }
  soundBanner.hidden = output.unlocked;
  output.preload(['siren-two-tone.wav', 'siren-mechanical.wav', 'siren-yelp.wav', 'chime.wav', 'speech/all-clear.mp3', 'speech/strike-nearby.mp3']);
}

// First visit (no saved location, no ?lat&lon): the Start screen offers the browser's location. With it, "Start
// display" watches it at the default radius and saves it; without it, "Set location" opens the picker. A saved
// location is used as stored, and the browser's location is not asked for.
const startButton = byId<HTMLButtonElement>('start-button');
const startHint = byId<HTMLParagraphElement>('start-hint');
const SOUND_HINT = 'Turns on sound. The alarm needs sound to warn you.';
let browserLocation: { lat: number; lon: number } | undefined;
if (!location) {
  startButton.textContent = 'Set location';
  startHint.textContent = 'Allow your location to watch where you are, or choose a place on the map.';
  void currentPosition().then((here) => {
    if (location) return;
    browserLocation = here;
    startButton.textContent = here ? 'Start display' : 'Set location';
    startHint.textContent = here
      ? `Watches ${DEFAULT_RADIUS.value} ${DEFAULT_RADIUS.unit} around your location. ${SOUND_HINT}`
      : 'Choose a place on the map to watch for lightning.';
  });
}

startButton.addEventListener('click', () => {
  if (!location) {
    if (!browserLocation) {
      window.location.assign('/location.html');
      return;
    }
    location = startAtBrowserLocation(store, browserLocation);
    watch(location);
  }
  started = true;
  start.hidden = true;
  void enableSound();
});
soundBanner.addEventListener('click', () => void enableSound());

// Full screen only on request. In full screen the top-bar buttons hide (styles.css); Esc or F11 brings them back.
const fullscreenButton = byId<HTMLButtonElement>('fullscreen');
fullscreenButton.hidden = !document.fullscreenEnabled;
fullscreenButton.addEventListener('click', () => {
  // Best effort: a kiosk browser may refuse.
  void document.documentElement.requestFullscreen().catch(() => {});
});

// ---- Settings dialog ----
const dialog = byId<HTMLDialogElement>('settings');
const sirenSelect = byId<HTMLSelectElement>('setting-siren');
const volumeInput = byId<HTMLInputElement>('setting-volume');
const replayInput = byId<HTMLInputElement>('setting-replay');
const announcementInput = byId<HTMLInputElement>('setting-announcement');
const silentWarning = byId<HTMLParagraphElement>('setting-silent');
const minutesInput = byId<HTMLInputElement>('setting-minutes');
const clockSelect = byId<HTMLSelectElement>('setting-clock');
const temperatureSelect = byId<HTMLSelectElement>('setting-temperature');
for (const id of SIRENS) sirenSelect.append(new Option(SIREN_LABELS[id], id));
for (const id of CLOCKS) clockSelect.append(new Option(CLOCK_LABELS[id], id));
for (const id of TEMPERATURE_UNITS) temperatureSelect.append(new Option(TEMPERATURE_LABELS[id], id));

function fillSettingsForm(settings: AlertSettings): void {
  sirenSelect.value = settings.siren;
  volumeInput.value = String(settings.volume);
  replayInput.checked = settings.replayAudioDuringCountdown;
  announcementInput.checked = settings.announcement;
  silentWarning.hidden = settings.siren !== 'none' || settings.announcement;
  minutesInput.value = String(settings.timeLimitMinutes);
  clockSelect.value = settings.clock;
  temperatureSelect.value = settings.temperatureUnit;
}

function readSettingsForm(): AlertSettings {
  return saveAlertSettings(store, {
    siren: sirenSelect.value as SirenId,
    volume: Number(volumeInput.value),
    replayAudioDuringCountdown: replayInput.checked,
    announcement: announcementInput.checked,
    timeLimitMinutes: Number(minutesInput.value),
    clock: clockSelect.value as ClockFormat,
    temperatureUnit: temperatureSelect.value as TemperatureUnit,
  });
}

byId<HTMLButtonElement>('open-settings').addEventListener('click', () => {
  fillSettingsForm(alerts);
  dialog.showModal();
});
volumeInput.addEventListener('input', () => output.setVolume(Number(volumeInput.value)));
for (const input of [sirenSelect, volumeInput, replayInput, announcementInput, clockSelect, temperatureSelect]) {
  input.addEventListener('change', () => {
    alerts = readSettingsForm();
    silentWarning.hidden = alerts.siren !== 'none' || alerts.announcement;
    // Clock and temperature apply at once: the weather panel reads them on every draw.
    weather?.redraw();
  });
}
dialog.addEventListener('close', () => {
  const previousMinutes = alerts.timeLimitMinutes;
  alerts = readSettingsForm();
  output.setVolume(alerts.volume);
  // The countdown length is also the stream's replay window, so a change starts the display over.
  if (alerts.timeLimitMinutes !== previousMinutes && location) window.location.reload();
});
byId<HTMLButtonElement>('test-strike-sound').addEventListener('click', async () => {
  await enableSound();
  void announcer.announce({ kind: 'strike', distance: Math.round(location?.radius.value ?? 10), unit: location?.radius.unit ?? 'mi' });
});
byId<HTMLButtonElement>('test-all-clear-sound').addEventListener('click', async () => {
  await enableSound();
  void announcer.announce({ kind: 'all-clear' });
});

// ---- Display ----
const headline = byId<HTMLParagraphElement>('headline');
const countdown = byId<HTMLParagraphElement>('countdown');
const detail = byId<HTMLParagraphElement>('detail');
const testTag = byId<HTMLParagraphElement>('test-tag');
const stale = byId<HTMLDivElement>('stale');
const staleDetail = byId<HTMLParagraphElement>('stale-detail');
const simulateAllClear = byId<HTMLButtonElement>('simulate-all-clear');
/** Set once the server says test mode is on (TEST_MODE). */
let testMode = false;

function render(view: ControllerView, connection: ConnectionState, radius: { value: number; unit: string }, minutes: number): void {
  const alert = view.mode === 'ALERT';
  document.body.classList.toggle('mode-alert', alert);
  document.body.classList.toggle('mode-normal', !alert);

  headline.textContent = alert ? 'LIGHTNING NEARBY' : 'All clear';
  countdown.hidden = !alert;
  countdown.textContent = view.countdown ?? '';
  testTag.hidden = !view.testStrike;
  // Test mode only: during a countdown, the sun button ends it at once.
  simulateAllClear.hidden = !(testMode && alert);
  detail.textContent = alert
    ? `${view.latestStrike ? `Latest strike ${view.latestStrike.distance} ${view.latestStrike.unit} away. ` : ''}Stay indoors until the countdown ends.`
    : `No lightning within ${radius.value} ${radius.unit} in the last ${minutes} minutes.`;

  stale.hidden = !view.stale;
  staleDetail.textContent = view.sessionEnded
    ? 'Demo session ended. Reload the page to continue.'
    : connection === 'failed'
      ? 'The lightning feed is unavailable. No all-clear while data is missing.'
      : 'Waiting for fresh satellite data. No all-clear while data is missing.';

  const live = connection === 'open' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting' : connection === 'connecting' ? 'Connecting' : 'Offline';
  const age = view.dataAgeSeconds === null ? 'no data yet' : `data ${view.dataAgeSeconds} s old`;
  status.textContent = `${live} · ${age} · watching ${radius.value} ${radius.unit}`;
}

if (location) {
  watch(location);
} else {
  headline.textContent = 'No location yet';
  const link = document.createElement('a');
  link.href = '/location.html';
  link.textContent = 'Choose a location';
  detail.replaceChildren(link, ' to watch for lightning.');
  status.textContent = 'Not watching anywhere yet.';
}

/** Starts watching a point: the weather, the push stream and the state machine. Called once. */
function watch(watched: UrlSettings): void {
  weather = mountWeatherPanel(document.getElementById('weather'), watched.query, () => alerts, (report) => {
    if (!pinnedBackground) showBackground(backgroundScene(report));
  });

  // ?minutes= in the address pins a kiosk's countdown; otherwise the saved alert setting decides.
  const pinnedMinutes = new URLSearchParams(window.location.search).has('minutes') ? watched.query.minutes : undefined;
  const timeLimitMinutes = pinnedMinutes ?? alerts.timeLimitMinutes;
  const controller = new DisplayController(
    {
      point: { lat: watched.query.lat, lon: watched.query.lon },
      radius: watched.radius,
      timeLimitMinutes,
      replayAudioDuringCountdown: alerts.replayAudioDuringCountdown,
    },
    announce,
  );
  let connection: ConnectionState = 'connecting';
  const redraw = () => render(controller.view(Date.now()), connection, watched.radius, timeLimitMinutes);

  openStream(
    { ...watched.query, minutes: timeLimitMinutes },
    {
      onFlashes: (flashes) => {
        controller.flashes(flashes, Date.now());
        redraw();
      },
      onHeartbeat: (heartbeat) => {
        if (heartbeat.latestFileEndMs !== null) {
          controller.heartbeat({ latestFileEndMs: heartbeat.latestFileEndMs, serverTimeMs: heartbeat.serverTimeMs }, Date.now());
        }
        redraw();
      },
      onConnection: (state) => {
        connection = state;
        if (state === 'ended') controller.sessionEnded(Date.now());
        redraw();
      },
    },
  );
  setInterval(() => {
    controller.tick(Date.now());
    redraw();
  }, 1000);
  redraw();

  // Test mode: only when the deployment turns it on (TEST_MODE), never on a real display.
  void clientConfig
    .then((config) => {
      if (!config.testMode) return;
      testMode = true;
      simulateAllClear.addEventListener('click', () => {
        controller.simulateAllClear();
        redraw();
      });
      const simulate = byId<HTMLButtonElement>('simulate');
      simulate.hidden = false;
      simulate.addEventListener('click', () => {
        controller.simulateStrike(Date.now());
        redraw();
      });
    })
    .catch(() => {});
}
