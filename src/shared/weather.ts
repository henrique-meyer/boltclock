/**
 * The weather relay's answer (GET /api/weather?lat&lon), shared by the server (src/server/weather) and the browser
 * (src/client/weather-panel.ts). api.weather.gov only covers the United States, so values are in °F and mph.
 */

/**
 * The weather reduced to the cases the display's background graphics draw. Derived from the NWS icon code, or from
 * the condition text when there is no icon.
 */
export type WeatherCondition = 'clear-day' | 'clear-night' | 'cloudy' | 'rain' | 'thunderstorm' | 'fog' | 'snow' | 'wind';

/** The latest observation from the nearest station that reported a temperature. */
export interface CurrentWeather {
  /** When the station observed it, UTC ms. Observations are often 20–60 minutes old. */
  observedAtMs: number;
  temperatureF: number | null;
  /** NWS's description, e.g. "Partly Cloudy". May be empty. */
  text: string;
  /** NWS icon URL, which encodes the condition code, e.g. ".../icons/land/day/sct?size=medium". */
  icon: string | null;
  condition: WeatherCondition;
  windSpeedMph: number | null;
  windGustMph: number | null;
  /** Where the wind blows from, in degrees clockwise from north. Null when calm or not reported. */
  windDirectionDeg: number | null;
  /** The observing station's identifier, e.g. "KMCO". */
  station: string;
}

/** One hour of NWS's hourly forecast. */
export interface ForecastHour {
  /** Start of the hour, UTC ms. */
  startMs: number;
  temperatureF: number;
  /** NWS's short forecast, e.g. "Chance Showers And Thunderstorms". */
  text: string;
  icon: string | null;
  condition: WeatherCondition;
  /** Chance of precipitation in percent, or null when NWS gives none. */
  precipitationChance: number | null;
  /** The top of NWS's range ("5 to 10 mph" is 10). */
  windSpeedMph: number | null;
  /** Compass point the wind blows from, e.g. "SW". Empty when NWS gives none. */
  windDirection: string;
}

export interface WeatherReport {
  status: 'ok';
  /** NWS's nearest town for the point, e.g. "Orlando, FL". */
  place: string | null;
  /** Null when no nearby station has a usable observation. */
  current: CurrentWeather | null;
  /** The next hours after the current one, at most WEATHER_FORECAST_HOURS. */
  forecast: ForecastHour[];
  /** When the relay last heard from NWS for this point, UTC ms. */
  updatedAtMs: number;
  /** True when NWS failed and part of this answer is an older cached copy. */
  stale: boolean;
}

/** api.weather.gov has no data for the point (outside the United States and its waters). Not an error. */
export interface WeatherOutsideCoverage {
  status: 'outside-coverage';
  message: string;
}

export type WeatherResponse = WeatherReport | WeatherOutsideCoverage;

/** How many forecast hours after the current one the relay returns. */
export const WEATHER_FORECAST_HOURS = 2;

/** How often the relay refreshes the latest observation, and how often the display asks for the weather. */
export const OBSERVATION_REFRESH_MS = 10 * 60_000;

/** How often the relay refreshes the hourly forecast. */
export const FORECAST_REFRESH_MS = 30 * 60_000;
