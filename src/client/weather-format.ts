import type { ForecastHour, WeatherResponse } from '../shared/weather.js';

/** The text the weather panel shows, worked out without the DOM so it can be tested. */
export interface WeatherPanelView {
  /** A message in place of the weather: outside NWS coverage, or nothing to show yet. */
  message?: string;
  place: string;
  temperature: string;
  condition: string;
  wind: string;
  forecast: { time: string; temperature: string; text: string; precipitation: string }[];
  /** "National Weather Service · observed 12 min ago". */
  credit: string;
  /** The observation is old, or the relay served a cached copy because NWS failed. */
  stale: boolean;
}

export const NWS_CREDIT = 'National Weather Service';

/** An observation older than this is shown as stale. */
const OLD_OBSERVATION_MS = 90 * 60_000;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass name for a direction in degrees. */
export function compassPoint(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16]!;
}

export function formatTemperature(fahrenheit: number | null): string {
  return fahrenheit === null ? '--°F' : `${Math.round(fahrenheit)}°F`;
}

/** "SW 12 mph, gusts 20", "Calm", or "Wind not reported". */
export function formatWind(speedMph: number | null, gustMph: number | null, direction: number | string | null): string {
  if (speedMph === null) return 'Wind not reported';
  const speed = Math.round(speedMph);
  if (speed === 0) return 'Calm';
  const from = typeof direction === 'number' ? compassPoint(direction) : (direction ?? '');
  const gusts = gustMph !== null && Math.round(gustMph) > speed ? `, gusts ${Math.round(gustMph)}` : '';
  return `${from ? `${from} ` : ''}${speed} mph${gusts}`;
}

/** "3 PM" in the display's time zone (or the one given). */
export function formatHour(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', timeZone });
}

/** "just now", "12 min ago", "2 h ago". */
export function formatAge(ageMs: number): string {
  const minutes = Math.floor(Math.max(0, ageMs) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/** "40%" when there is a chance of precipitation, otherwise nothing. */
export function formatPrecipitation(chance: number | null): string {
  return chance ? `${Math.round(chance)}%` : '';
}

function forecastRow(hour: ForecastHour, timeZone?: string) {
  return {
    time: formatHour(hour.startMs, timeZone),
    temperature: formatTemperature(hour.temperatureF),
    text: hour.text,
    precipitation: formatPrecipitation(hour.precipitationChance),
  };
}

/** Just a message and the credit. */
export function messageView(message: string): WeatherPanelView {
  return { message, place: '', temperature: '', condition: '', wind: '', forecast: [], credit: NWS_CREDIT, stale: false };
}

export function weatherPanelView(response: WeatherResponse, nowMs: number, timeZone?: string): WeatherPanelView {
  if (response.status === 'outside-coverage') return messageView(response.message);

  const { current } = response;
  const forecast = response.forecast.map((hour) => forecastRow(hour, timeZone));
  const age = current
    ? `observed ${formatAge(nowMs - current.observedAtMs)}`
    : `forecast updated ${formatAge(nowMs - response.updatedAtMs)}`;
  const view: WeatherPanelView = {
    ...messageView(''),
    message: undefined,
    place: response.place ?? '',
    forecast,
    credit: `${NWS_CREDIT} · ${age}`,
    stale: response.stale || (current !== null && nowMs - current.observedAtMs > OLD_OBSERVATION_MS),
  };
  if (!current) {
    return forecast.length ? { ...view, condition: 'No current observation' } : { ...view, message: 'No weather data right now.' };
  }
  return {
    ...view,
    temperature: formatTemperature(current.temperatureF),
    condition: current.text || response.forecast[0]?.text || '',
    wind: formatWind(current.windSpeedMph, current.windGustMph, current.windDirectionDeg),
  };
}
