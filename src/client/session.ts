/** The time left in a demo session as H:mm ("1:59", "0:05"), counted down to the whole minute. */
export function formatSessionLeft(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Where the session ends on the display's own clock, from a heartbeat's server times; null without a session limit.
 * Using the offset keeps the countdown right on a display whose clock is off.
 */
export function sessionEndOnDisplayClock(
  heartbeat: { serverTimeMs: number; sessionEndsAtMs?: number | null },
  receivedAtMs: number,
): number | null {
  const ends = heartbeat.sessionEndsAtMs;
  return typeof ends === 'number' && Number.isFinite(ends) ? receivedAtMs + (ends - heartbeat.serverTimeMs) : null;
}
