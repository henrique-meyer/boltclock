import type { WeatherResponse } from '../shared/weather.js';
import type { Point } from './location-settings.js';

/** The line under the Start button. Its space is kept when it is empty, so the button never moves. */
export const START_MESSAGES = {
  askingForLocation: 'Allow your location to watch where you are, or choose a place on the map.',
  noLocation: 'Choose a place on the map to watch for lightning.',
  sessionEnded: 'Your session has ended. Press Start display to continue.',
} as const;

/** "Orlando, FL" from the weather relay's NWS lookup, or the coordinates where NWS has no name (outside the US). */
export function placeLabel(point: Point, weather?: WeatherResponse): string {
  if (weather?.status === 'ok' && weather.place) return weather.place;
  return `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
}

/** Set by the location picker on its way back, read once by the display (BOLT-44). */
export const RETURN_TO_DISPLAY_KEY = 'boltclock.returnToDisplay';

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStore(): SessionStore | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The picker is going back to the display: open on the main screen, not the Start screen. */
export function markReturnToDisplay(store: SessionStore | undefined = sessionStore()): void {
  try {
    store?.setItem(RETURN_TO_DISPLAY_KEY, '1');
  } catch {
    // Blocked storage: the display shows the Start screen as usual.
  }
}

/** True once after the picker sent the browser back here; clears the mark. */
export function takeReturnToDisplay(store: SessionStore | undefined = sessionStore()): boolean {
  try {
    const marked = store?.getItem(RETURN_TO_DISPLAY_KEY) === '1';
    store?.removeItem(RETURN_TO_DISPLAY_KEY);
    return marked;
  } catch {
    return false;
  }
}
