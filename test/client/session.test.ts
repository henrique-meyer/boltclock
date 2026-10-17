import { describe, expect, it } from 'vitest';
import { formatSessionLeft, sessionEndOnDisplayClock } from '../../src/client/session.js';

const MIN = 60_000;

describe('session countdown', () => {
  it('shows the time left as H:mm, down to the whole minute', () => {
    expect(formatSessionLeft(120 * MIN)).toBe('2:00');
    expect(formatSessionLeft(119 * MIN + 59_000)).toBe('1:59');
    expect(formatSessionLeft(65 * MIN)).toBe('1:05');
    expect(formatSessionLeft(59_000)).toBe('0:00');
    expect(formatSessionLeft(-5_000)).toBe('0:00');
  });

  it('puts the end on the display clock, whatever its offset from the server', () => {
    // The display's clock is 5 minutes fast: the heartbeat arrives at server time 1000, display time 1000 + 5 min.
    expect(sessionEndOnDisplayClock({ serverTimeMs: 1_000, sessionEndsAtMs: 1_000 + 30 * MIN }, 1_000 + 5 * MIN)).toBe(1_000 + 35 * MIN);
    expect(sessionEndOnDisplayClock({ serverTimeMs: 1_000, sessionEndsAtMs: null }, 2_000)).toBeNull();
    expect(sessionEndOnDisplayClock({ serverTimeMs: 1_000 }, 2_000)).toBeNull();
  });
});
