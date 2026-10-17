/**
 * Messages on the display's server-sent events stream (GET /api/stream). The SSE event name is the message type and
 * the data is the JSON below. Shared by the server (src/server/push) and the browser (src/client/stream.ts).
 */

/** One flash near the display's point. */
export interface StreamFlash {
  /** Globally unique: the GLM file's start time plus GLM's flash id, e.g. "1784146880000-39659". */
  id: string;
  /** Time of the flash's first event, UTC milliseconds. */
  timeMs: number;
  lat: number;
  lon: number;
}

/** Flashes within the requested radius. On connect: the replay of the requested window. Later: only new ones. */
export interface FlashesMessage {
  type: 'flashes';
  flashes: StreamFlash[];
}

/** Sent on connect and every ~15 s. The display goes stale when latestFileEndMs is more than 3 minutes old. */
export interface HeartbeatMessage {
  type: 'heartbeat';
  /** End time of the newest GLM file ingested, UTC ms, or null before the first one. */
  latestFileEndMs: number | null;
  serverTimeMs: number;
}

/** The demo's session limit was reached (ADR 0003). The display stops reconnecting and asks for a reload. */
export interface SessionEndedMessage {
  type: 'session-ended';
}

export type StreamMessage = FlashesMessage | HeartbeatMessage | SessionEndedMessage;

/** Stream parameters, as query string values. */
export interface StreamQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  /** How far back to replay on connect: the display's time limit, 1–120 minutes. */
  minutes: number;
}

/** 100 miles, the largest radius a display may set. */
export const MAX_RADIUS_KM = 160.9344;
export const MAX_WINDOW_MINUTES = 120;

export function flashId(fileStartMs: number, glmFlashId: number): string {
  return `${fileStartMs}-${glmFlashId}`;
}
