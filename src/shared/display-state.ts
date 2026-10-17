/**
 * The display's state machine: NORMAL and ALERT, with a STALE overlay.
 *
 * Pure: no DOM, timers or network. The caller feeds it inputs from the push channel and clock ticks, renders
 * `displayView`, and plays sound for the events `step` returns. See "Client state machine" in docs/system-design.md.
 *
 * Time: flash times and GLM file times come from the server's clock, and the countdown and the data age are measured
 * on that clock too. The newest heartbeat gives the offset between the display's clock and the server's
 * (serverTimeMs minus the display time it arrived), so a display whose clock is off cannot clear early. Before the
 * first heartbeat the offset is zero, and the data counts as stale anyway.
 *
 * Batches: one `flashes` input is one push message, usually one GLM file. It raises at most one event: "alert" when
 * it starts a countdown, else "repeat" when the replay setting is on, with the distance of the nearest new flash
 * within the radius.
 *
 * Reload: `rebuildDisplayState` replays the flashes the server sends on connect without raising events. A fresh page
 * load with an active countdown shows the countdown and stays silent: the page cannot tell whether that strike was
 * already announced, browsers block sound before the first user gesture, and a reload (for example after a demo
 * session ends) must not sound the siren again. The next new strike within the radius announces as usual. On a
 * reconnect within the same page, the caller steps the replayed flashes into the existing state instead: they are
 * deduplicated by id, so an alert already in progress is not announced again.
 */
import { distanceKm } from './geo.js';

export const KM_PER_MILE = 1.609344;
export const MAX_RADIUS_MI = 100;
export const MAX_RADIUS_KM = MAX_RADIUS_MI * KM_PER_MILE;
export const DEFAULT_TIME_LIMIT_MINUTES = 30;
export const MAX_TIME_LIMIT_MINUTES = 120;
/** Lightning data older than this (newest GLM file end time against the server clock) is stale. */
export const STALE_AFTER_MS = 3 * 60_000;

/** One GLM flash. `id` is globally unique: the file start time plus the GLM flash id. */
export interface Flash {
  id: string;
  timeMs: number;
  lat: number;
  lon: number;
}

export interface Heartbeat {
  /** End of the newest GLM file the server has ingested. */
  latestFileEndMs: number;
  serverTimeMs: number;
}

export type RadiusUnit = 'mi' | 'km';

export interface DisplaySettings {
  point: { lat: number; lon: number };
  /** Stored as entered. At most 100 mi or the km equivalent. */
  radius: { value: number; unit: RadiusUnit };
  /** Default 30, at most 120. */
  timeLimitMinutes: number;
  replayAudioDuringCountdown: boolean;
}

export type DisplayMode = 'NORMAL' | 'ALERT';

/** A flash within the radius, kept while it is younger than the time limit. */
export interface Strike {
  id: string;
  timeMs: number;
  distanceKm: number;
}

export interface DisplayState {
  readonly settings: DisplaySettings;
  readonly mode: DisplayMode;
  /** Server-clock time the countdown reaches 0:00. Null in NORMAL. */
  readonly countdownEndMs: number | null;
  /** Strikes within the radius younger than the time limit, by id. Also the dedupe set: older flashes are ignored. */
  readonly strikes: ReadonlyMap<string, Strike>;
  /** The strike that last started or restarted the countdown: the one an announcement names. Null in NORMAL. */
  readonly latestStrikeId: string | null;
  readonly heartbeat: { latestFileEndMs: number; serverTimeMs: number; receivedAtMs: number } | null;
  readonly sessionEnded: boolean;
}

export type DisplayInput =
  | { type: 'flashes'; flashes: readonly Flash[] }
  | { type: 'heartbeat'; heartbeat: Heartbeat }
  | { type: 'session-ended' }
  /** The display reconnected after a session ended (the Start button). Data stays stale until a fresh heartbeat. */
  | { type: 'session-resumed' }
  /** The clock moved on. Send it about once a second while the display is up. */
  | { type: 'tick' };

export type DisplayEvent =
  | { type: 'alert'; distance: number; unit: RadiusUnit; flashId: string }
  | { type: 'repeat'; distance: number; unit: RadiusUnit; flashId: string }
  | { type: 'all-clear' };

export interface DisplayView {
  mode: DisplayMode;
  /** "MM:SS", rounded up to the whole second. Null in NORMAL. */
  countdown: string | null;
  countdownRemainingMs: number | null;
  /**
   * The strike that last started or restarted the countdown, rounded, in the unit the radius was entered in: the
   * same distance the announcement speaks. Null in NORMAL, or once that strike is past the time limit.
   */
  latestStrike: { distance: number; unit: RadiusUnit } | null;
  /** Show "NO LIGHTNING DATA". All-clear waits while this is true. */
  stale: boolean;
  /** The demo session ended: the display should ask for a reload. Also stale. */
  sessionEnded: boolean;
}

/** The radius in kilometres, capped at 100 mi. */
export function radiusKm(settings: DisplaySettings): number {
  const { value, unit } = settings.radius;
  const km = unit === 'mi' ? value * KM_PER_MILE : value;
  return Number.isFinite(km) ? Math.min(Math.max(km, 0), MAX_RADIUS_KM) : 0;
}

/** The time limit in milliseconds: 30 minutes when unset or invalid, at most 120. */
export function timeLimitMs(settings: DisplaySettings): number {
  const minutes = settings.timeLimitMinutes;
  const valid = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, MAX_TIME_LIMIT_MINUTES) : DEFAULT_TIME_LIMIT_MINUTES;
  return valid * 60_000;
}

/** A distance in the unit the radius was entered in, rounded to a whole number. */
export function roundedDistance(km: number, unit: RadiusUnit): number {
  return Math.round(unit === 'mi' ? km / KM_PER_MILE : km);
}

/** Milliseconds as "MM:SS", rounded up so 0:00 shows only once the time is up. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function createDisplayState(settings: DisplaySettings): DisplayState {
  return {
    settings,
    mode: 'NORMAL',
    countdownEndMs: null,
    strikes: new Map(),
    latestStrikeId: null,
    heartbeat: null,
    sessionEnded: false,
  };
}

/** The display's clock moved onto the server's, using the newest heartbeat. */
export function serverNow(state: DisplayState, nowMs: number): number {
  return state.heartbeat ? nowMs + (state.heartbeat.serverTimeMs - state.heartbeat.receivedAtMs) : nowMs;
}

/** Age of the newest GLM file, or null before the first heartbeat. */
export function dataAgeMs(state: DisplayState, nowMs: number): number | null {
  return state.heartbeat ? serverNow(state, nowMs) - state.heartbeat.latestFileEndMs : null;
}

export function isStale(state: DisplayState, nowMs: number): boolean {
  if (state.sessionEnded) return true;
  const age = dataAgeMs(state, nowMs);
  return age === null || age > STALE_AFTER_MS;
}

/** Applies one input at the display time `nowMs` and returns the next state and what to announce. */
export function step(
  state: DisplayState,
  input: DisplayInput,
  nowMs: number,
): { state: DisplayState; events: DisplayEvent[] } {
  const events: DisplayEvent[] = [];
  // Settle the countdown on the data as it was, so a clear that was due comes before anything this input starts.
  let next = settle(state, nowMs, events);

  switch (input.type) {
    case 'flashes':
      next = applyFlashes(next, input.flashes, nowMs, events);
      break;
    case 'heartbeat':
      next = {
        ...next,
        heartbeat: {
          latestFileEndMs: input.heartbeat.latestFileEndMs,
          serverTimeMs: input.heartbeat.serverTimeMs,
          receivedAtMs: nowMs,
        },
      };
      break;
    case 'session-ended':
      next = { ...next, sessionEnded: true };
      break;
    case 'session-resumed':
      next = { ...next, sessionEnded: false };
      break;
    case 'tick':
      break;
  }

  return { state: settle(next, nowMs, events), events };
}

/**
 * The state after a page load, from the flashes the server replays on connect (the last time-limit minutes) and,
 * when it has arrived, the first heartbeat. Raises no events: see the module comment.
 */
export function rebuildDisplayState(
  settings: DisplaySettings,
  replayed: readonly Flash[],
  nowMs: number,
  heartbeat?: Heartbeat,
): DisplayState {
  let state = createDisplayState(settings);
  if (heartbeat) state = step(state, { type: 'heartbeat', heartbeat }, nowMs).state;
  return step(state, { type: 'flashes', flashes: replayed }, nowMs).state;
}

export function displayView(state: DisplayState, nowMs: number): DisplayView {
  const remaining = state.countdownEndMs === null ? null : Math.max(0, state.countdownEndMs - serverNow(state, nowMs));
  const latest = state.latestStrikeId === null ? undefined : state.strikes.get(state.latestStrikeId);
  const unit = state.settings.radius.unit;
  return {
    mode: state.mode,
    countdown: remaining === null ? null : formatCountdown(remaining),
    countdownRemainingMs: remaining,
    latestStrike: latest ? { distance: roundedDistance(latest.distanceKm, unit), unit } : null,
    stale: isStale(state, nowMs),
    sessionEnded: state.sessionEnded,
  };
}

/** Drops strikes past the time limit, and clears an expired countdown when the data is fresh. */
function settle(state: DisplayState, nowMs: number, events: DisplayEvent[]): DisplayState {
  const now = serverNow(state, nowMs);
  const cutoff = now - timeLimitMs(state.settings);
  const kept = [...state.strikes.values()].filter((strike) => strike.timeMs > cutoff);
  let next = kept.length === state.strikes.size ? state : { ...state, strikes: new Map(kept.map((s) => [s.id, s])) };

  if (next.mode === 'ALERT' && next.countdownEndMs !== null && now >= next.countdownEndMs && !isStale(next, nowMs)) {
    next = { ...next, mode: 'NORMAL', countdownEndMs: null, latestStrikeId: null };
    events.push({ type: 'all-clear' });
  }
  return next;
}

function applyFlashes(
  state: DisplayState,
  flashes: readonly Flash[],
  nowMs: number,
  events: DisplayEvent[],
): DisplayState {
  const { settings } = state;
  const limit = timeLimitMs(settings);
  const maxKm = radiusKm(settings);
  const cutoff = serverNow(state, nowMs) - limit;

  const strikes = new Map(state.strikes);
  let nearestNew: Strike | null = null;
  let latestEnd = state.countdownEndMs;

  for (const flash of flashes) {
    if (strikes.has(flash.id)) continue;
    if (![flash.timeMs, flash.lat, flash.lon].every(Number.isFinite)) continue;
    if (flash.timeMs <= cutoff) continue;
    const km = distanceKm(settings.point.lat, settings.point.lon, flash.lat, flash.lon);
    if (km > maxKm) continue;

    const strike = { id: flash.id, timeMs: flash.timeMs, distanceKm: km };
    strikes.set(flash.id, strike);
    if (!nearestNew || km < nearestNew.distanceKm) nearestNew = strike;
    latestEnd = Math.max(latestEnd ?? -Infinity, flash.timeMs + limit);
  }

  if (!nearestNew) return state;

  const unit = settings.radius.unit;
  const distance = roundedDistance(nearestNew.distanceKm, unit);
  if (state.mode === 'NORMAL') {
    events.push({ type: 'alert', distance, unit, flashId: nearestNew.id });
  } else if (settings.replayAudioDuringCountdown) {
    events.push({ type: 'repeat', distance, unit, flashId: nearestNew.id });
  }
  return { ...state, mode: 'ALERT', countdownEndMs: latestEnd, strikes, latestStrikeId: nearestNew.id };
}
