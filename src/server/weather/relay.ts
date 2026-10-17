import {
  FORECAST_REFRESH_MS,
  OBSERVATION_REFRESH_MS,
  WEATHER_FORECAST_HOURS,
  type CurrentWeather,
  type ForecastHour,
  type WeatherResponse,
} from '../../shared/weather.js';
import { weatherCondition } from './condition.js';
import { createNwsClient, NWS_BASE_URL, NwsError, type NwsClientOptions } from './nws.js';

export interface WeatherRelayOptions extends NwsClientOptions {
  now?: () => number;
  /** Told when NWS fails, without the point. */
  warn?: (message: string) => void;
}

/** /points answers change only when NWS redraws its grid, so they are kept for hours. */
export const POINTS_TTL_MS = 6 * 60 * 60_000;
/** After NWS fails, the cached copy is served for this long before NWS is asked again. */
export const FAILURE_BACKOFF_MS = 60_000;
/** Stations past this many are not tried for a current observation. */
const MAX_STATIONS = 3;
/** An observation older than this is not "current"; the next station is tried. */
const MAX_OBSERVATION_AGE_MS = 2 * 60 * 60_000;
/** Entries per cache. The oldest go first, so a client cannot grow memory without bound. */
const MAX_ENTRIES = 1000;

export const OUTSIDE_COVERAGE_MESSAGE = 'No National Weather Service data here. It covers the United States only.';

interface PointInfo {
  forecastHourlyUrl: string;
  stationsUrl: string;
  place: string | null;
}

/** One hourly period as cached, with the fields the answer leaves out. */
interface ForecastPeriod extends ForecastHour {
  endMs: number;
  isDaytime: boolean;
}

interface Entry<T> {
  value: T;
  fetchedMs: number;
  expiresMs: number;
  /** NWS failed when this was due for a refresh; it is being served during the backoff. */
  stale: boolean;
}

interface Cached<T> {
  value: T;
  fetchedMs: number;
  stale: boolean;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round1 = (value: number) => Math.round(value * 10) / 10;

/** NWS's precision for /points, without trailing zeros (NWS redirects anything else). */
export const pointKey = (lat: number, lon: number) => `${Number(lat.toFixed(4))},${Number(lon.toFixed(4))}`;

/** A WMO quantity ({ unitCode, value }) in °F. */
function fahrenheit(quantity: unknown): number | null {
  const { unitCode, value } = obj(quantity);
  const v = finite(value);
  if (v === null) return null;
  if (unitCode === 'wmoUnit:degC') return round1((v * 9) / 5 + 32);
  if (unitCode === 'wmoUnit:degF') return round1(v);
  return null;
}

/** A WMO quantity in mph. */
function mph(quantity: unknown): number | null {
  const { unitCode, value } = obj(quantity);
  const v = finite(value);
  if (v === null) return null;
  if (unitCode === 'wmoUnit:km_h-1') return round1(v / 1.609344);
  if (unitCode === 'wmoUnit:m_s-1') return round1(v * 2.2369363);
  return null;
}

function parsePoint(body: unknown): PointInfo | null {
  const properties = obj(obj(body).properties);
  const forecastHourlyUrl = str(properties.forecastHourly);
  const stationsUrl = str(properties.observationStations);
  if (!forecastHourlyUrl || !stationsUrl) return null;
  const town = obj(obj(properties.relativeLocation).properties);
  const city = str(town.city);
  const state = str(town.state);
  return { forecastHourlyUrl, stationsUrl, place: city ? (state ? `${city}, ${state}` : city) : null };
}

function parseStations(body: unknown): string[] {
  const features = obj(body).features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature) => str(obj(obj(feature).properties).stationIdentifier) ?? []);
}

function parseObservation(body: unknown, station: string): CurrentWeather | null {
  const p = obj(obj(body).properties);
  const observedAtMs = Date.parse(str(p.timestamp) ?? '');
  if (Number.isNaN(observedAtMs)) return null;
  const text = str(p.textDescription) ?? '';
  const icon = str(p.icon);
  return {
    observedAtMs,
    temperatureF: fahrenheit(p.temperature),
    text,
    icon,
    condition: weatherCondition(icon, text),
    windSpeedMph: mph(p.windSpeed),
    windGustMph: mph(p.windGust),
    windDirectionDeg: finite(obj(p.windDirection).value),
    station,
  };
}

function parseForecast(body: unknown): ForecastPeriod[] {
  const periods = obj(obj(body).properties).periods;
  if (!Array.isArray(periods)) return [];
  return periods.slice(0, 12).flatMap((raw): ForecastPeriod[] => {
    const p = obj(raw);
    const startMs = Date.parse(str(p.startTime) ?? '');
    const endMs = Date.parse(str(p.endTime) ?? '');
    const temperature = finite(p.temperature);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || temperature === null) return [];
    const temperatureF = p.temperatureUnit === 'C' ? round1((temperature * 9) / 5 + 32) : temperature;
    const text = str(p.shortForecast) ?? '';
    const icon = str(p.icon);
    const isDaytime = p.isDaytime !== false;
    // "10 mph" or "5 to 10 mph": the top of the range.
    const speeds = (str(p.windSpeed) ?? '').match(/\d+(\.\d+)?/g);
    return [
      {
        startMs,
        endMs,
        isDaytime,
        temperatureF,
        text,
        icon,
        condition: weatherCondition(icon, text, isDaytime),
        precipitationChance: finite(obj(p.probabilityOfPrecipitation).value),
        windSpeedMph: speeds ? Number(speeds[speeds.length - 1]) : null,
        windDirection: str(p.windDirection) ?? '',
      },
    ];
  });
}

const publicHour = (p: ForecastPeriod): ForecastHour => ({
  startMs: p.startMs,
  temperatureF: p.temperatureF,
  text: p.text,
  icon: p.icon,
  condition: p.condition,
  precipitationChance: p.precipitationChance,
  windSpeedMph: p.windSpeedMph,
  windDirection: p.windDirection,
});

/**
 * Relays api.weather.gov for one point: /points (cached for hours), then the nearest station's latest observation
 * (about every 10 minutes) and the hourly forecast (about every 30). Caches live in this process; the app runs one
 * stateless replica. When NWS fails, the last good copy is served, marked stale.
 */
export class WeatherRelay {
  private readonly nws: (url: string) => Promise<unknown>;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private readonly points = new Map<string, Entry<PointInfo | null>>();
  private readonly stations = new Map<string, Entry<string[]>>();
  private readonly observations = new Map<string, Entry<CurrentWeather | null>>();
  private readonly forecasts = new Map<string, Entry<ForecastPeriod[]>>();
  /** Requests on their way to NWS, so displays asking at once share one. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: WeatherRelayOptions) {
    this.nws = createNwsClient(options);
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? (() => {});
  }

  async get(lat: number, lon: number): Promise<WeatherResponse> {
    const point = await this.cached(this.points, `points ${pointKey(lat, lon)}`, POINTS_TTL_MS, () => this.loadPoint(lat, lon));
    if (!point.value) return { status: 'outside-coverage', message: OUTSIDE_COVERAGE_MESSAGE };
    const info = point.value;

    const [observation, forecast] = await Promise.allSettled([
      this.cached(this.observations, `observation ${info.stationsUrl}`, OBSERVATION_REFRESH_MS, () => this.loadObservation(info.stationsUrl)),
      this.cached(this.forecasts, `forecast ${info.forecastHourlyUrl}`, FORECAST_REFRESH_MS, () => this.loadForecast(info.forecastHourlyUrl)),
    ]);
    if (observation.status === 'rejected' && forecast.status === 'rejected') throw observation.reason;

    const now = this.now();
    const periods = forecast.status === 'fulfilled' ? forecast.value.value : [];
    let current = observation.status === 'fulfilled' ? observation.value.value : null;
    if (current && !current.icon) {
      // Without an icon the observation cannot tell day from night; the forecast hour it falls in can.
      const hour = periods.find((p) => p.startMs <= current!.observedAtMs && current!.observedAtMs < p.endMs);
      current = { ...current, condition: weatherCondition(null, current.text, hour?.isDaytime) };
    }
    const used = [observation, forecast].flatMap((part) => (part.status === 'fulfilled' ? [part.value] : []));
    return {
      status: 'ok',
      place: info.place,
      current,
      forecast: periods.filter((p) => p.startMs > now).slice(0, WEATHER_FORECAST_HOURS).map(publicHour),
      updatedAtMs: Math.min(...used.map((part) => part.fetchedMs)),
      stale: point.stale || used.some((part) => part.stale),
    };
  }

  private async loadPoint(lat: number, lon: number): Promise<PointInfo | null> {
    try {
      return parsePoint(await this.nws(`${NWS_BASE_URL}/points/${pointKey(lat, lon)}`));
    } catch (error) {
      // NWS answers 404 for points it has no grid for: outside the US. Cached like an answer, so it is not asked again.
      if (error instanceof NwsError && error.status === 404) return null;
      throw error;
    }
  }

  private async loadObservation(stationsUrl: string): Promise<CurrentWeather | null> {
    const { value: stations } = await this.cached(this.stations, `stations ${stationsUrl}`, POINTS_TTL_MS, async () =>
      parseStations(await this.nws(stationsUrl)),
    );
    // Stations come nearest first. Some report no temperature or stop reporting for a while; try the next.
    for (const station of stations.slice(0, MAX_STATIONS)) {
      let body: unknown;
      try {
        body = await this.nws(`${NWS_BASE_URL}/stations/${encodeURIComponent(station)}/observations/latest`);
      } catch (error) {
        if (error instanceof NwsError && error.status === 404) continue;
        throw error;
      }
      const observation = parseObservation(body, station);
      if (observation && observation.temperatureF !== null && this.now() - observation.observedAtMs <= MAX_OBSERVATION_AGE_MS) {
        return observation;
      }
    }
    return null;
  }

  private async loadForecast(url: string): Promise<ForecastPeriod[]> {
    return parseForecast(await this.nws(url));
  }

  /**
   * The cached value while it is fresh. Otherwise loads it; if that fails, serves the old value (stale) and waits
   * FAILURE_BACKOFF_MS before asking NWS again. Fails only when there is nothing cached.
   */
  private async cached<T>(cache: Map<string, Entry<T>>, key: string, ttlMs: number, load: () => Promise<T>): Promise<Cached<T>> {
    const entry = cache.get(key);
    if (entry && entry.expiresMs > this.now()) return { value: entry.value, fetchedMs: entry.fetchedMs, stale: entry.stale };

    let pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load().finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    try {
      const value = await pending;
      const fresh = cache.get(key);
      // Another caller sharing this load already stored it.
      if (fresh && fresh !== entry) return { value: fresh.value, fetchedMs: fresh.fetchedMs, stale: false };
      const now = this.now();
      cache.delete(key);
      cache.set(key, { value, fetchedMs: now, expiresMs: now + ttlMs, stale: false });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      return { value, fetchedMs: now, stale: false };
    } catch (error) {
      const kind = key.split(' ')[0];
      const reason = error instanceof Error ? error.message : String(error);
      if (!entry) {
        this.warn(`NWS ${kind} request failed: ${reason}`);
        throw error;
      }
      if (entry.expiresMs <= this.now()) {
        this.warn(`NWS ${kind} request failed: ${reason}. Serving the cached copy.`);
        entry.expiresMs = this.now() + FAILURE_BACKOFF_MS;
        entry.stale = true;
      }
      return { value: entry.value, fetchedMs: entry.fetchedMs, stale: true };
    }
  }
}
