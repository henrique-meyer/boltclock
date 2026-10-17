import { describe, expect, it } from 'vitest';
import { weatherCondition } from '../../../src/server/weather/condition.js';

const icon = (path: string) => `https://api.weather.gov/icons/land/${path}?size=medium`;

describe('weatherCondition', () => {
  it.each([
    ['day/skc', 'clear-day'],
    ['night/few', 'clear-night'],
    ['day/sct', 'clear-day'],
    ['night/bkn', 'cloudy'],
    ['day/ovc', 'cloudy'],
    ['day/rain_showers,40', 'rain'],
    ['day/fzra', 'rain'],
    ['night/tsra_hi,30', 'thunderstorm'],
    ['day/snow,60', 'snow'],
    ['day/rain_snow', 'snow'],
    ['day/fog', 'fog'],
    ['day/haze', 'fog'],
    ['day/wind_bkn', 'wind'],
    ['night/wind_skc', 'wind'],
  ])('reads %s as %s', (path, expected) => {
    expect(weatherCondition(icon(path), '')).toBe(expected);
  });

  it('takes the more severe of two codes', () => {
    expect(weatherCondition(icon('day/rain_showers,40/tsra,60'), '')).toBe('thunderstorm');
    expect(weatherCondition(icon('night/bkn/rain,20'), '')).toBe('rain');
  });

  it.each([
    ['Thunderstorms and Rain', 'thunderstorm'],
    ['Light Snow', 'snow'],
    ['Light Rain and Mist', 'rain'],
    ['Fog/Mist', 'fog'],
    ['Breezy', 'wind'],
    ['Mostly Cloudy', 'cloudy'],
    ['Overcast', 'cloudy'],
    ['Partly Cloudy', 'clear-day'],
    ['', 'clear-day'],
  ])('falls back to the text without an icon: %s', (text, expected) => {
    expect(weatherCondition(null, text)).toBe(expected);
  });

  it('uses isDaytime for clear skies only when the icon does not say', () => {
    expect(weatherCondition(null, 'Clear', false)).toBe('clear-night');
    expect(weatherCondition(icon('day/skc'), 'Sunny', false)).toBe('clear-day');
  });
});
