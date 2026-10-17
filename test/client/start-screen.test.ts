import { describe, expect, it } from 'vitest';
import { markReturnToDisplay, placeLabel, START_MESSAGES, takeReturnToDisplay } from '../../src/client/start-screen.js';
import type { WeatherResponse } from '../../src/shared/weather.js';

const POINT = { lat: 28.538412, lon: -81.378912 };

describe('Start screen', () => {
  it('names the place from the weather relay', () => {
    const weather = { status: 'ok', place: 'Orlando, FL' } as WeatherResponse;
    expect(placeLabel(POINT, weather)).toBe('Orlando, FL');
  });

  it('falls back to the coordinates without a name', () => {
    expect(placeLabel(POINT)).toBe('28.5384, -81.3789');
    expect(placeLabel(POINT, { status: 'ok', place: null } as WeatherResponse)).toBe('28.5384, -81.3789');
    expect(placeLabel(POINT, { status: 'outside-coverage', message: 'x' } as WeatherResponse)).toBe('28.5384, -81.3789');
  });

  it('says how to continue after a session ends', () => {
    expect(START_MESSAGES.sessionEnded).toBe('Your session has ended. Press Start display to continue.');
  });
});

describe('return from the picker', () => {
  function memory() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it('skips the Start screen once after the picker marks the way back', () => {
    const store = memory();
    expect(takeReturnToDisplay(store)).toBe(false);
    markReturnToDisplay(store);
    expect(takeReturnToDisplay(store)).toBe(true);
    expect(takeReturnToDisplay(store)).toBe(false);
  });

  it('shows the Start screen when session storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(() => markReturnToDisplay(blocked)).not.toThrow();
    expect(takeReturnToDisplay(blocked)).toBe(false);
    expect(takeReturnToDisplay(undefined)).toBe(false);
  });
});
