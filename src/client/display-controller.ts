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
import { EARTH_RADIUS_KM } from '../shared/geo.js';
import type { Announcement } from './audio.js';

/** Simulated strikes carry this id prefix, so the display can label them and nothing mistakes them for real ones. */
export const TEST_FLASH_PREFIX = 'test-';

export interface ControllerView extends DisplayView {
  /** The nearest strike in the window is a simulated one. */
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
   * Test mode: a flash due north of the point at 60% of the radius, timed now on the server's clock. It goes through
   * the state machine like a real one (alert, countdown, replay), but exists only in this page.
   */
  simulateStrike(nowMs: number): void {
    const km = radiusKm(this.settings) * 0.6;
    const flash: Flash = {
      id: `${TEST_FLASH_PREFIX}${++this.testCount}`,
      timeMs: serverNow(this.state, nowMs),
      lat: this.settings.point.lat + (km / EARTH_RADIUS_KM) * (180 / Math.PI),
      lon: this.settings.point.lon,
    };
    this.apply(step(this.state, { type: 'flashes', flashes: [flash] }, nowMs));
  }

  view(nowMs: number): ControllerView {
    const view = displayView(this.state, nowMs);
    let nearestId: string | undefined;
    let nearestKm = Infinity;
    for (const strike of this.state.strikes.values()) {
      if (strike.distanceKm < nearestKm) {
        nearestKm = strike.distanceKm;
        nearestId = strike.id;
      }
    }
    const heartbeat = this.state.heartbeat;
    return {
      ...view,
      testStrike: nearestId?.startsWith(TEST_FLASH_PREFIX) ?? false,
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
