import './styles.css';
import { fetchClientConfig } from './client-config.js';
import {
  CLOCK_LABELS,
  CLOCKS,
  DISTANCE_LABELS,
  DISTANCE_UNITS,
  loadAlertSettings,
  saveAlertSettings,
  simulationOn,
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
import type { RadiusUnit } from '../shared/display-state.js';
import { DisplayController, type ControllerView } from './display-controller.js';
import { currentDistanceUnit, resolveDisplaySettings, setDistanceUnit, startAtBrowserLocation } from './display-settings.js';
import { currentPosition, onLocationGranted } from './geolocation.js';
import { defaultRadius, type KeyValueStore } from './location-settings.js';
import { placeLabel, START_MESSAGES, takeReturnToDisplay } from './start-screen.js';
import { openStream, type ConnectionState } from './stream.js';
import type { UrlSettings } from './url-settings.js';
import { backgroundOverride, backgroundScene, type BackgroundScene } from './weather-background.js';
import { fetchWeather, mountWeatherPanel, type WeatherPanel } from './weather-panel.js';

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

// ---- Start screen ----
// First visit (no saved location, no ?lat&lon): it offers the browser's location. With it, "Start display" watches
// it at the default radius and saves it; without it, "Set location" opens the picker. A saved location is used as
// stored, and the browser's location is not asked for. The line under the button names the place.
const startButton = byId<HTMLButtonElement>('start-button');
const startMessage = byId<HTMLParagraphElement>('start-message');
/** Waits 30 s: the permission prompt may still be open. */
const FIRST_VISIT_GEOLOCATION_MS = 30_000;
let browserLocation: { lat: number; lon: number } | undefined;
let findingLocation = false;
/** Set while a demo session has ended: the Start button then reconnects. */
let resumeSession: (() => void) | undefined;

async function findBrowserLocation(): Promise<void> {
  if (location || browserLocation || findingLocation) return;
  findingLocation = true;
  startMessage.textContent = START_MESSAGES.askingForLocation;
  const here = await currentPosition(undefined, FIRST_VISIT_GEOLOCATION_MS);
  findingLocation = false;
  if (location) return;
  browserLocation = here;
  startButton.textContent = here ? 'Start display' : 'Set location';
  if (!here) {
    startMessage.textContent = START_MESSAGES.noLocation;
    return;
  }
  startMessage.textContent = placeLabel(here);
  const weather = await fetchWeather(here).catch(() => undefined);
  if (!location) startMessage.textContent = placeLabel(here, weather);
}

if (!location) {
  startButton.textContent = 'Set location';
  void findBrowserLocation();
  // Allowed later, or after the first request gave up: ask again, so the button turns into "Start display".
  onLocationGranted(() => void findBrowserLocation());
}

startButton.addEventListener('click', () => {
  if (resumeSession) {
    resumeSession();
    resumeSession = undefined;
  } else if (!location) {
    if (!browserLocation) {
      window.location.assign('/location');
      return;
    }
    location = startAtBrowserLocation(store, browserLocation, defaultRadius(alerts.distanceUnit));
    watch(location);
  }
  started = true;
  start.hidden = true;
  void enableSound();
});
soundBanner.addEventListener('click', () => void enableSound());

// Back from the location picker (Save location or Back to the display): straight to the main screen, unless there is
// no location to watch. Sound may still be blocked without the Start click; the sound banner then asks for one.
if (takeReturnToDisplay() && location) {
  started = true;
  start.hidden = true;
  void enableSound();
}

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
const distanceSelect = byId<HTMLSelectElement>('setting-distance');
for (const id of SIRENS) sirenSelect.append(new Option(SIREN_LABELS[id], id));
for (const id of CLOCKS) clockSelect.append(new Option(CLOCK_LABELS[id], id));
for (const id of TEMPERATURE_UNITS) temperatureSelect.append(new Option(TEMPERATURE_LABELS[id], id));
for (const id of DISTANCE_UNITS) distanceSelect.append(new Option(DISTANCE_LABELS[id], id));

function fillSettingsForm(settings: AlertSettings): void {
  sirenSelect.value = settings.siren;
  volumeInput.value = String(settings.volume);
  replayInput.checked = settings.replayAudioDuringCountdown;
  announcementInput.checked = settings.announcement;
  silentWarning.hidden = settings.siren !== 'none' || settings.announcement;
  minutesInput.value = String(settings.timeLimitMinutes);
  clockSelect.value = settings.clock;
  temperatureSelect.value = settings.temperatureUnit;
  distanceSelect.value = currentDistanceUnit(store, settings);
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
    // Changed through setDistanceUnit when the dialog closes, which also converts the saved radius.
    distanceUnit: alerts.distanceUnit,
    // Saved only when its own checkbox changes, so other settings never pin the deployment's default.
    simulation: alerts.simulation,
  });
}

let distanceUnitWhenOpened = currentDistanceUnit(store, alerts);
byId<HTMLButtonElement>('open-settings').addEventListener('click', () => {
  fillSettingsForm(alerts);
  distanceUnitWhenOpened = distanceSelect.value as RadiusUnit;
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
  const distanceUnit = distanceSelect.value as RadiusUnit;
  const distanceChanged = distanceUnit !== distanceUnitWhenOpened;
  if (distanceChanged) {
    alerts = setDistanceUnit(store, alerts, distanceUnit);
    // Applied in place, no reload: the same circle in the new unit. A kiosk's ?unit= still wins.
    const next = resolveDisplaySettings(window.location.search, store);
    if (location && next) {
      location = next;
      changeRadius?.(next.radius);
    }
  }
  // The countdown length is also the stream's replay window, so a change starts the display over.
  if (alerts.timeLimitMinutes !== previousMinutes && location) window.location.reload();
});
byId<HTMLButtonElement>('test-strike-sound').addEventListener('click', async () => {
  await enableSound();
  // In the watched radius's unit, which follows Settings' distance; without a location, in that setting's unit.
  const radius = location?.radius ?? defaultRadius(alerts.distanceUnit);
  void announcer.announce({ kind: 'strike', distance: Math.round(radius.value), unit: radius.unit });
});
byId<HTMLButtonElement>('test-all-clear-sound').addEventListener('click', async () => {
  await enableSound();
  void announcer.announce({ kind: 'all-clear' });
});

// ---- Display ----
const headline = byId<HTMLParagraphElement>('headline');
const countdown = byId<HTMLParagraphElement>('countdown');
const detail = byId<HTMLParagraphElement>('detail');
const simFlag = byId<HTMLSpanElement>('sim-flag');
const stale = byId<HTMLDivElement>('stale');
const staleDetail = byId<HTMLParagraphElement>('stale-detail');
const simulateAllClear = byId<HTMLButtonElement>('simulate-all-clear');
const simulateStrike = byId<HTMLButtonElement>('simulate');
const simulationInput = byId<HTMLInputElement>('setting-simulation');
const simulationOption = byId<HTMLLabelElement>('simulation-option');
/** The deployment's simulation settings, once the server has said: ALLOW_SIMULATION, and TEST_MODE as the default. */
let deployment = { testMode: false, allowSimulation: false };
/** Simulation mode: the Simulate buttons show. */
let testMode = false;
/** Switches the watched radius in place (a distance-unit change); set once the display is watching a point. */
let changeRadius: ((radius: UrlSettings['radius']) => void) | undefined;
/** Redraws the display after a mode change; set once the display is watching a point. */
let redrawDisplay: (() => void) | undefined;

function applySimulation(): void {
  testMode = simulationOn(alerts, deployment);
  // Without ALLOW_SIMULATION there is no checkbox at all.
  simulationOption.hidden = !deployment.allowSimulation;
  simulationInput.checked = testMode;
  simulateStrike.hidden = !testMode || !redrawDisplay;
  if (redrawDisplay) redrawDisplay();
  else simulateAllClear.hidden = true;
}

// Simulation mode: offered only with ALLOW_SIMULATION. TEST_MODE is the default, and each device can turn it off or on
// in Settings (BOLT-37, BOLT-43).
simulationInput.addEventListener('change', () => {
  alerts = saveAlertSettings(store, { ...alerts, simulation: simulationInput.checked });
  applySimulation();
});
void clientConfig
  .then((config) => {
    deployment = { testMode: config.testMode, allowSimulation: config.allowSimulation };
    applySimulation();
  })
  .catch(() => {});
applySimulation();

function render(view: ControllerView, connection: ConnectionState, radius: { value: number; unit: string }, minutes: number): void {
  const alert = view.mode === 'ALERT';
  document.body.classList.toggle('mode-alert', alert);
  document.body.classList.toggle('mode-normal', !alert);

  headline.textContent = alert ? 'LIGHTNING NEARBY' : 'All clear';
  countdown.hidden = !alert;
  countdown.textContent = view.countdown ?? '';
  simFlag.hidden = !view.simulation;
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
  // During a countdown, say what it started at (BOLT-47); the countdown shows only what is left.
  const countdownFrom = alert ? ` · Countdown from ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '';
  status.textContent = `${live} · ${age} · watching ${radius.value} ${radius.unit}${countdownFrom}`;
}

if (location) {
  watch(location);
} else {
  headline.textContent = 'No location yet';
  const link = document.createElement('a');
  link.href = '/location';
  link.textContent = 'Choose a location';
  detail.replaceChildren(link, ' to watch for lightning.');
  status.textContent = 'Not watching anywhere yet.';
}

/** Starts watching a point: the weather, the push stream and the state machine. Called once. */
function watch(watched: UrlSettings): void {
  weather = mountWeatherPanel(document.getElementById('weather'), watched.query, () => alerts, (report) => {
    if (!pinnedBackground) showBackground(backgroundScene(report));
    // The Start screen names the place, unless it is saying the session ended.
    if (!resumeSession) startMessage.textContent = placeLabel(watched.query, report);
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
  let radius = watched.radius;
  const redraw = () => render(controller.view(Date.now()), connection, radius, timeLimitMinutes);
  changeRadius = (next) => {
    radius = next;
    controller.setRadius(next);
    redraw();
  };

  const connect = () =>
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
          if (state === 'ended') {
            controller.sessionEnded(Date.now());
            // Back to the Start screen; its button reconnects, and the replay brings back any countdown.
            startButton.textContent = 'Start display';
            startMessage.textContent = START_MESSAGES.sessionEnded;
            start.hidden = false;
            resumeSession = () => {
              controller.sessionResumed(Date.now());
              connect();
            };
          }
          redraw();
        },
      },
    );
  connect();
  setInterval(() => {
    controller.tick(Date.now());
    redraw();
  }, 1000);
  redraw();

  // Simulation mode's buttons; they show only while it is on.
  simulateAllClear.addEventListener('click', () => {
    if (!testMode) return;
    controller.simulateAllClear(Date.now());
    redraw();
  });
  simulateStrike.addEventListener('click', () => {
    if (!testMode) return;
    controller.simulateStrike(Date.now());
    redraw();
  });
  redrawDisplay = redraw;
  applySimulation();
}
