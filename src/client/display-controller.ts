import {
  createDisplayState,
  displayView,
  radiusKm,
  rebuildDisplayState,
  serverNow,
  step,
  type DisplayEvent,
  type DisplaySettings,
  type DisplayState,
  type DisplayView,
  type Flash,
  type Heartbeat,
} from '../shared/display-state.js';
import { destinationPoint } from '../shared/geo.js';
import type { Announcement } from './audio.js';

/** Simulated strikes carry this id prefix, so the display can label them and nothing mistakes them for real ones. */
export const TEST_FLASH_PREFIX = 'test-';

export interface ControllerView extends DisplayView {
  /** The strike the alert shows (the latest one) is a simulated one. */
  testStrike: boolean;
  /** Seconds since the newest GLM file, or null before the first heartbeat. */
  dataAgeSeconds: number | null;
}

/**
 * Runs the display state machine for one page: the first replay rebuilds the state silently (a reload must not
 * sound the siren again), later flashes, heartbeats and clock ticks step it, and the events become announcements.
 */
export class DisplayController {
  private state: DisplayState;
  private replayed = false;
  private testCount = 0;

  constructor(
    private readonly settings: DisplaySettings,
    private readonly announce: (announcement: Announcement) => void,
    private readonly random: () => number = Math.random,
  ) {
    this.state = createDisplayState(settings);
  }

  flashes(flashes: readonly Flash[], nowMs: number): void {
    if (!this.replayed) {
      // The server's first message is the replay of the time-limit window (src/shared/messages.ts).
      this.replayed = true;
      const heartbeat = this.state.heartbeat ?? undefined;
      this.state = rebuildDisplayState(this.settings, flashes, nowMs, heartbeat && toHeartbeat(heartbeat));
      return;
    }
    this.apply(step(this.state, { type: 'flashes', flashes }, nowMs));
  }

  heartbeat(heartbeat: Heartbeat, nowMs: number): void {
    this.apply(step(this.state, { type: 'heartbeat', heartbeat }, nowMs));
  }

  sessionEnded(nowMs: number): void {
    this.apply(step(this.state, { type: 'session-ended' }, nowMs));
  }

  tick(nowMs: number): void {
    this.apply(step(this.state, { type: 'tick' }, nowMs));
  }

  /**
   * Test mode: a flash at a random distance inside the radius (5 to 95% of it) in a random direction, timed now on
   * the server's clock. It goes through the state machine like a real one (alert, countdown) and exists only in this
   * page. Unlike a real strike it always sounds, even during a countdown with replay off: the button is there to
   * test the alarm.
   */
  simulateStrike(nowMs: number): void {
    const km = radiusKm(this.settings) * (0.05 + 0.9 * this.random());
    const { lat, lon } = destinationPoint(this.settings.point.lat, this.settings.point.lon, 360 * this.random(), km);
    const flash: Flash = { id: `${TEST_FLASH_PREFIX}${++this.testCount}`, timeMs: serverNow(this.state, nowMs), lat, lon };
    const { settings } = this.state;
    const loud = { ...this.state, settings: { ...settings, replayAudioDuringCountdown: true } };
    const result = step(loud, { type: 'flashes', flashes: [flash] }, nowMs);
    this.apply({ state: { ...result.state, settings }, events: result.events });
  }

  /**
   * Test mode: ends a countdown at once with the all-clear sound, so a test can start over. Simulated strikes are
   * dropped; real ones stay, so a replayed real flash is still recognised.
   */
  simulateAllClear(): void {
    if (this.state.mode !== 'ALERT') return;
    const strikes = new Map([...this.state.strikes].filter(([id]) => !id.startsWith(TEST_FLASH_PREFIX)));
    this.apply({
      state: { ...this.state, mode: 'NORMAL', countdownEndMs: null, strikes, latestStrikeId: null },
      events: [{ type: 'all-clear' }],
    });
  }

  view(nowMs: number): ControllerView {
    const view = displayView(this.state, nowMs);
    const heartbeat = this.state.heartbeat;
    return {
      ...view,
      testStrike: view.latestStrike !== null && (this.state.latestStrikeId?.startsWith(TEST_FLASH_PREFIX) ?? false),
      dataAgeSeconds: heartbeat ? Math.max(0, Math.round((serverNow(this.state, nowMs) - heartbeat.latestFileEndMs) / 1000)) : null,
    };
  }

  private apply(result: { state: DisplayState; events: DisplayEvent[] }): void {
    this.state = result.state;
    // Several events in one step (an expired countdown, then a new strike) play in order; the newest wins the speaker.
    for (const event of result.events) this.announce(toAnnouncement(event));
  }
}

function toHeartbeat(h: { latestFileEndMs: number; serverTimeMs: number }): Heartbeat {
  return { latestFileEndMs: h.latestFileEndMs, serverTimeMs: h.serverTimeMs };
}

export function toAnnouncement(event: DisplayEvent): Announcement {
  return event.type === 'all-clear' ? { kind: 'all-clear' } : { kind: 'strike', distance: event.distance, unit: event.unit };
}
