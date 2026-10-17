import type { WeatherCondition } from '../../shared/weather.js';

/**
 * NWS icon codes (https://api.weather.gov/icons) by the condition they draw. An icon URL can carry two codes, e.g.
 * ".../land/day/rain_showers,40/tsra,60", and the more severe one wins.
 */
const CODES: [WeatherCondition | 'clear', string[]][] = [
  ['thunderstorm', ['tsra', 'tsra_sct', 'tsra_hi', 'tornado', 'hurricane', 'tropical_storm']],
  ['snow', ['snow', 'rain_snow', 'snow_sleet', 'snow_fzra', 'sleet', 'blizzard']],
  ['rain', ['rain', 'rain_showers', 'rain_showers_hi', 'rain_sleet', 'fzra', 'rain_fzra']],
  ['fog', ['fog', 'haze', 'smoke', 'dust']],
  ['wind', ['wind_skc', 'wind_few', 'wind_sct', 'wind_bkn', 'wind_ovc']],
  ['cloudy', ['bkn', 'ovc']],
  ['clear', ['skc', 'few', 'sct', 'hot', 'cold']],
];

/** Keywords in NWS's text for when there is no icon, most severe first. */
const WORDS: [WeatherCondition, RegExp][] = [
  ['thunderstorm', /thunder|t-storm|tornado|hurricane|tropical storm/],
  ['snow', /snow|sleet|flurr|blizzard|ice pellets/],
  ['rain', /rain|shower|drizzle/],
  ['fog', /fog|haze|smoke|mist|dust/],
  ['wind', /wind|breez|gust/],
  ['cloudy', /mostly cloudy|overcast|^cloudy/],
];

/** Reads the codes and the day/night half from an NWS icon URL. */
function parseIcon(icon: string): { codes: string[]; night: boolean } | undefined {
  const match = /\/icons\/land\/(day|night)\/([^?]+)/.exec(icon);
  if (!match) return undefined;
  const codes = match[2]!.split('/').map((part) => part.split(',')[0]!);
  return { codes, night: match[1] === 'night' };
}

/**
 * The background category for an NWS icon and text. `isDaytime` decides clear day or night when the icon does not;
 * without either, it is day.
 */
export function weatherCondition(icon: string | null, text: string, isDaytime?: boolean): WeatherCondition {
  const parsed = icon ? parseIcon(icon) : undefined;
  const night = parsed ? parsed.night : isDaytime === false;
  const clear = night ? 'clear-night' : 'clear-day';

  if (parsed) {
    for (const [condition, codes] of CODES) {
      if (parsed.codes.some((code) => codes.includes(code))) return condition === 'clear' ? clear : condition;
    }
  }
  const words = text.toLowerCase().trim();
  for (const [condition, pattern] of WORDS) {
    if (pattern.test(words)) return condition;
  }
  return clear;
}
