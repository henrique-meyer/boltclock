import { describe, expect, it } from 'vitest';
import { placeLabel, START_MESSAGES } from '../../src/client/start-screen.js';
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
