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
