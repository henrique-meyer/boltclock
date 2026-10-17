import { describe, expect, it, vi } from 'vitest';
import {
  compassPoint,
  formatAge,
  formatHour,
  formatPrecipitation,
  formatTemperature,
  formatWind,
  weatherPanelView,
} from '../../src/client/weather-format.js';
import { fetchWeather } from '../../src/client/weather-panel.js';
import type { WeatherReport } from '../../src/shared/weather.js';

vi.mock('../../src/client/weather-panel.css', () => ({}));

const NOW = Date.parse('2026-07-15T18:20:00Z');
const MIN = 60_000;

const report = (overrides: Partial<WeatherReport> = {}): WeatherReport => ({
  status: 'ok',
  place: 'Orlando, FL',
  current: {
    observedAtMs: NOW - 12 * MIN,
    temperatureF: 77.4,
    text: 'Partly Cloudy',
    icon: null,
    condition: 'clear-day',
    windSpeedMph: 9.6,
    windGustMph: 21.2,
    windDirectionDeg: 230,
    station: 'KORL',
  },
  forecast: [
    {
      startMs: Date.parse('2026-07-15T19:00:00Z'),
      temperatureF: 89,
      text: 'Chance Showers And Thunderstorms',
      icon: null,
      condition: 'thunderstorm',
      precipitationChance: 40,
      windSpeedMph: 10,
      windDirection: 'SW',
    },
    {
      startMs: Date.parse('2026-07-15T20:00:00Z'),
      temperatureF: 87,
      text: 'Mostly Sunny',
      icon: null,
      condition: 'clear-day',
      precipitationChance: 0,
      windSpeedMph: 5,
      windDirection: 'S',
    },
  ],
  updatedAtMs: NOW - 2 * MIN,
  stale: false,
  ...overrides,
});

describe('weather panel formatting', () => {
  it.each([
    [0, 'N'],
    [11, 'N'],
    [12, 'NNE'],
    [230, 'SW'],
    [350, 'N'],
    [360, 'N'],
    [-90, 'W'],
  ])('names %s° as %s', (degrees, name) => {
    expect(compassPoint(degrees)).toBe(name);
  });

  it('rounds temperatures and shows a gap for a missing one', () => {
    expect(formatTemperature(77.4)).toBe('77°F');
    expect(formatTemperature(-0.4)).toBe('0°F');
    expect(formatTemperature(null)).toBe('--°F');
  });

  it('describes the wind', () => {
    expect(formatWind(9.6, 21.2, 230)).toBe('SW 10 mph, gusts 21');
    expect(formatWind(10, 10.2, 'SW')).toBe('SW 10 mph');
    expect(formatWind(4, null, null)).toBe('4 mph');
    expect(formatWind(0.3, null, 0)).toBe('Calm');
    expect(formatWind(null, null, 180)).toBe('Wind not reported');
  });

  it('formats hours, ages and precipitation', () => {
    expect(formatHour(Date.parse('2026-07-15T19:00:00Z'), 'America/New_York')).toBe('3 PM');
    expect(formatAge(20_000)).toBe('just now');
    expect(formatAge(12 * MIN + 59_000)).toBe('12 min ago');
    expect(formatAge(135 * MIN)).toBe('2 h ago');
    expect(formatPrecipitation(40)).toBe('40%');
    expect(formatPrecipitation(0)).toBe('');
    expect(formatPrecipitation(null)).toBe('');
  });

  it('builds the panel from a report', () => {
    expect(weatherPanelView(report(), NOW, 'America/New_York')).toEqual({
      place: 'Orlando, FL',
      temperature: '77°F',
      condition: 'Partly Cloudy',
      wind: 'SW 10 mph, gusts 21',
      forecast: [
        { time: '3 PM', temperature: '89°F', text: 'Chance Showers And Thunderstorms', precipitation: '40%' },
        { time: '4 PM', temperature: '87°F', text: 'Mostly Sunny', precipitation: '' },
      ],
      credit: 'National Weather Service · observed 12 min ago',
      stale: false,
    });
  });

  it('marks old observations and cached copies as stale', () => {
    const old = report();
    old.current!.observedAtMs = NOW - 2 * 60 * MIN;
    expect(weatherPanelView(old, NOW).stale).toBe(true);
    expect(weatherPanelView(old, NOW).credit).toBe('National Weather Service · observed 2 h ago');
    expect(weatherPanelView(report({ stale: true }), NOW).stale).toBe(true);
  });

  it('shows the forecast alone when there is no current observation', () => {
    const view = weatherPanelView(report({ current: null }), NOW);
    expect(view).toMatchObject({ temperature: '', condition: 'No current observation', credit: 'National Weather Service · forecast updated 2 min ago' });
    expect(view.forecast).toHaveLength(2);
    expect(weatherPanelView(report({ current: null, forecast: [] }), NOW).message).toBe('No weather data right now.');
  });

  it('shows the outside-coverage message with the credit', () => {
    expect(weatherPanelView({ status: 'outside-coverage', message: 'No NWS data here.' }, NOW)).toMatchObject({
      message: 'No NWS data here.',
      credit: 'National Weather Service',
      forecast: [],
    });
  });
});

describe('fetchWeather', () => {
  const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('asks the relay for the point at 4 decimals, uncached', async () => {
    const fetcher = answer(report());
    await fetchWeather({ lat: 28.538421, lon: -81.378912 }, fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/weather?lat=28.5384&lon=-81.3789', { cache: 'no-store' });
  });

  it('fails on an error status or an odd body', async () => {
    await expect(fetchWeather({ lat: 0, lon: 0 }, answer({ error: 'x' }, 503))).rejects.toThrow(/503/);
    await expect(fetchWeather({ lat: 0, lon: 0 }, answer({ hello: 1 }))).rejects.toThrow(/unexpected/);
  });
});
