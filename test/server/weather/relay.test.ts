import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../src/server/app.js';
import { FAILURE_BACKOFF_MS, OUTSIDE_COVERAGE_MESSAGE, WeatherRelay } from '../../../src/server/weather/relay.js';
import type { WeatherReport } from '../../../src/shared/weather.js';

const UA = '(BoltClock, you@example.com)';
const NWS = 'https://api.weather.gov';
const T0 = Date.parse('2026-07-15T18:20:00Z');
const MIN = 60_000;

const POINTS_URL = `${NWS}/points/28.5384,-81.3789`;
const HOURLY_URL = `${NWS}/gridpoints/MLB/26,68/forecast/hourly`;
const STATIONS_URL = `${NWS}/gridpoints/MLB/26,68/stations`;
const OBS_URL = (station: string) => `${NWS}/stations/${station}/observations/latest`;

const iso = (ms: number) => new Date(ms).toISOString();

const points = () => ({
  properties: {
    forecastHourly: HOURLY_URL,
    observationStations: STATIONS_URL,
    relativeLocation: { properties: { city: 'Orlando', state: 'FL' } },
  },
});

const stations = () => ({
  features: [{ properties: { stationIdentifier: 'KORL' } }, { properties: { stationIdentifier: 'KMCO' } }],
});

const observation = (overrides: Record<string, unknown> = {}) => ({
  properties: {
    timestamp: iso(T0 - 20 * MIN),
    textDescription: 'Partly Cloudy',
    icon: `${NWS}/icons/land/day/sct?size=medium`,
    temperature: { unitCode: 'wmoUnit:degC', value: 25 },
    windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 16.09344 },
    windGust: { unitCode: 'wmoUnit:km_h-1', value: 40.2336 },
    windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 230 },
    ...overrides,
  },
});

const HOUR = 60 * MIN;
const START = Date.parse('2026-07-15T18:00:00Z');
const period = (i: number, overrides: Record<string, unknown> = {}) => ({
  number: i + 1,
  startTime: iso(START + i * HOUR),
  endTime: iso(START + (i + 1) * HOUR),
  isDaytime: true,
  temperature: 88 + i,
  temperatureUnit: 'F',
  probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 20 * i },
  windSpeed: i === 1 ? '5 to 10 mph' : '10 mph',
  windDirection: 'SW',
  icon: `${NWS}/icons/land/day/tsra_sct,${20 * i}?size=small`,
  shortForecast: 'Chance Showers And Thunderstorms',
  ...overrides,
});
const forecast = () => ({ properties: { periods: [0, 1, 2, 3].map((i) => period(i)) } });

type Route = (attempt: number) => Response | unknown;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/geo+json', ...headers } });

/** A fake fetch: each URL answers from its route (a body, or a Response for errors); counts and records requests. */
function fakeNws(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    [POINTS_URL]: () => points(),
    [STATIONS_URL]: () => stations(),
    [OBS_URL('KORL')]: () => observation(),
    [OBS_URL('KMCO')]: () => observation({ textDescription: 'Mostly Cloudy', icon: `${NWS}/icons/land/day/bkn?size=medium` }),
    [HOURLY_URL]: () => forecast(),
    ...overrides,
  };
  const calls: string[] = [];
  const userAgents: (string | null)[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    userAgents.push(new Headers(init?.headers).get('user-agent'));
    const route = routes[url];
    if (!route) return json({ title: 'Not Found' }, 404);
    const answer = route(calls.filter((c) => c === url).length);
    return answer instanceof Response ? answer : json(answer);
  });
  const count = (url: string) => calls.filter((c) => c === url).length;
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, userAgents, count };
}

function relayWith(nws: ReturnType<typeof fakeNws>, extra: { warn?: (m: string) => void } = {}) {
  const clock = { now: T0 };
  const sleep = vi.fn(async (ms: number) => {
    void ms;
  });
  const relay = new WeatherRelay({ userAgent: UA, fetch: nws.fetch, now: () => clock.now, sleep, ...extra });
  return { relay, clock, sleep };
}

const ORLANDO = { lat: 28.53842, lon: -81.37891 };

describe('WeatherRelay', () => {
  it('follows points, then the nearest station and the hourly forecast, and shapes a compact answer', async () => {
    const nws = fakeNws();
    const { relay } = relayWith(nws);

    const report = await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(nws.calls[0]).toBe(POINTS_URL);
    expect(nws.calls).toEqual(expect.arrayContaining([STATIONS_URL, OBS_URL('KORL'), HOURLY_URL]));
    expect(nws.calls).toHaveLength(4);
    expect(nws.userAgents.every((ua) => ua === UA)).toBe(true);
    expect(report).toEqual({
      status: 'ok',
      place: 'Orlando, FL',
      current: {
        observedAtMs: T0 - 20 * MIN,
        temperatureF: 77,
        text: 'Partly Cloudy',
        icon: `${NWS}/icons/land/day/sct?size=medium`,
        condition: 'clear-day',
        windSpeedMph: 10,
        windGustMph: 25,
        windDirectionDeg: 230,
        station: 'KORL',
      },
      // 18:00 is the current hour; the answer starts at the next one.
      forecast: [
        {
          startMs: START + HOUR,
          temperatureF: 89,
          text: 'Chance Showers And Thunderstorms',
          icon: `${NWS}/icons/land/day/tsra_sct,20?size=small`,
          condition: 'thunderstorm',
          precipitationChance: 20,
          windSpeedMph: 10,
          windDirection: 'SW',
        },
        expect.objectContaining({ startMs: START + 2 * HOUR, temperatureF: 90, precipitationChance: 40 }),
      ],
      updatedAtMs: T0,
      stale: false,
    } satisfies WeatherReport);
  });

  it('asks /points at NWS precision without trailing zeros, and shares it between nearby requests', async () => {
    const url = `${NWS}/points/28.5,-81.1`;
    const nws = fakeNws({ [url]: () => points() });
    const { relay } = relayWith(nws);

    await relay.get(28.5, -81.1);
    await relay.get(28.50001, -81.10003);

    expect(nws.count(url)).toBe(1);
  });

  it('serves from the cache, refreshing observations after 10 minutes, the forecast after 30 and points after hours', async () => {
    const nws = fakeNws();
    const { relay, clock } = relayWith(nws);
    await relay.get(ORLANDO.lat, ORLANDO.lon);

    clock.now = T0 + 9 * MIN;
    await relay.get(ORLANDO.lat, ORLANDO.lon);
    expect(nws.calls).toHaveLength(4);

    clock.now = T0 + 11 * MIN;
    const refreshed = await relay.get(ORLANDO.lat, ORLANDO.lon);
    expect(nws.count(OBS_URL('KORL'))).toBe(2);
    expect(nws.count(HOURLY_URL)).toBe(1);
    expect(nws.count(STATIONS_URL)).toBe(1);
    // The oldest part used decides the age.
    expect(refreshed.status === 'ok' && refreshed.updatedAtMs).toBe(T0);

    clock.now = T0 + 31 * MIN;
    await relay.get(ORLANDO.lat, ORLANDO.lon);
    expect(nws.count(HOURLY_URL)).toBe(2);
    expect(nws.count(POINTS_URL)).toBe(1);

    clock.now = T0 + 7 * HOUR;
    await relay.get(ORLANDO.lat, ORLANDO.lon);
    expect(nws.count(POINTS_URL)).toBe(2);
    expect(nws.count(STATIONS_URL)).toBe(2);
  });

  it('shares one NWS request between displays asking at the same time', async () => {
    const nws = fakeNws();
    const { relay } = relayWith(nws);

    await Promise.all([relay.get(ORLANDO.lat, ORLANDO.lon), relay.get(ORLANDO.lat, ORLANDO.lon)]);

    expect(nws.calls).toHaveLength(4);
  });

  it('retries a throttled request after about 5 s', async () => {
    const nws = fakeNws({ [OBS_URL('KORL')]: (n) => (n < 3 ? json({ title: 'Too Many Requests' }, 429) : observation()) });
    const { relay, sleep } = relayWith(nws);

    const report = await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(nws.count(OBS_URL('KORL'))).toBe(3);
    expect(sleep.mock.calls).toEqual([[5000], [5000]]);
    expect(report.status === 'ok' && report.current?.station).toBe('KORL');
  });

  it('waits longer when NWS sends Retry-After', async () => {
    const nws = fakeNws({ [HOURLY_URL]: (n) => (n === 1 ? json({}, 503, { 'retry-after': '8' }) : forecast()) });
    const { relay, sleep } = relayWith(nws);

    await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(sleep).toHaveBeenCalledWith(8000);
  });

  it('serves the cached copy, marked stale, when NWS keeps throttling, then backs off', async () => {
    let throttle = false;
    const nws = fakeNws({
      [OBS_URL('KORL')]: () => (throttle ? json({ title: 'Too Many Requests' }, 429) : observation()),
    });
    const warn = vi.fn();
    const { relay, clock, sleep } = relayWith(nws, { warn });
    const fresh = await relay.get(ORLANDO.lat, ORLANDO.lon);

    throttle = true;
    clock.now = T0 + 11 * MIN;
    const report = await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(nws.count(OBS_URL('KORL'))).toBe(4); // 1 earlier, then 3 attempts
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(report.status === 'ok' && report.current).toEqual(fresh.status === 'ok' && fresh.current);
    expect(report.status === 'ok' && report.stale).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/observation request failed: api.weather.gov answered 429\. Serving the cached copy/);

    // During the backoff NWS is left alone and the answer stays marked stale.
    clock.now += FAILURE_BACKOFF_MS - 1000;
    const again = await relay.get(ORLANDO.lat, ORLANDO.lon);
    expect(nws.count(OBS_URL('KORL'))).toBe(4);
    expect(again.status === 'ok' && again.stale).toBe(true);

    throttle = false;
    clock.now += 2000;
    const recovered = await relay.get(ORLANDO.lat, ORLANDO.lon);
    expect(recovered.status === 'ok' && recovered.stale).toBe(false);
  });

  it('never logs the point', async () => {
    const nws = fakeNws({ [POINTS_URL]: () => json({}, 500) });
    const warn = vi.fn();
    const { relay } = relayWith(nws, { warn });

    await expect(relay.get(ORLANDO.lat, ORLANDO.lon)).rejects.toThrow(/500/);

    expect(warn).toHaveBeenCalled();
    for (const [message] of warn.mock.calls) expect(message).not.toMatch(/28\.5|81\.3/);
  });

  it('answers "outside coverage" for points NWS has no grid for, and does not ask again', async () => {
    const url = `${NWS}/points/51.5074,-0.1278`;
    const nws = fakeNws({
      [url]: () => json({ title: 'Data Unavailable For Requested Point', status: 404 }, 404),
    });
    const { relay, sleep } = relayWith(nws);

    expect(await relay.get(51.5074, -0.1278)).toEqual({ status: 'outside-coverage', message: OUTSIDE_COVERAGE_MESSAGE });
    await relay.get(51.5074, -0.1278);

    expect(nws.count(url)).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('tries the next station when the nearest has no recent temperature', async () => {
    const nws = fakeNws({ [OBS_URL('KORL')]: () => observation({ temperature: { unitCode: 'wmoUnit:degC', value: null } }) });
    const { relay } = relayWith(nws);

    const report = await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(report.status === 'ok' && report.current).toMatchObject({ station: 'KMCO', text: 'Mostly Cloudy', condition: 'cloudy' });
  });

  it('skips stations without a latest observation, and gives no current weather when none has one', async () => {
    const nws = fakeNws({
      [OBS_URL('KORL')]: () => json({}, 404),
      [OBS_URL('KMCO')]: () => observation({ timestamp: iso(T0 - 3 * HOUR) }),
    });
    const { relay } = relayWith(nws);

    const report = await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(report.status === 'ok' && report.current).toBeNull();
    expect(report.status === 'ok' && report.forecast).toHaveLength(2);
  });

  it('tells clear night from the forecast hour when the observation has no icon', async () => {
    const nws = fakeNws({
      [OBS_URL('KORL')]: () => observation({ icon: null, textDescription: 'Clear' }),
      [HOURLY_URL]: () => ({ properties: { periods: [0, 1, 2].map((i) => period(i, { isDaytime: false, icon: null, shortForecast: 'Mostly Clear' })) } }),
    });
    const { relay } = relayWith(nws);

    const report = await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(report.status === 'ok' && report.current?.condition).toBe('clear-night');
    expect(report.status === 'ok' && report.forecast[0]?.condition).toBe('clear-night');
  });

  it('still answers with the forecast when observations fail', async () => {
    const nws = fakeNws({ [STATIONS_URL]: () => json({}, 500) });
    const { relay } = relayWith(nws);

    const report = await relay.get(ORLANDO.lat, ORLANDO.lon);

    expect(report).toMatchObject({ status: 'ok', current: null, stale: false });
    expect(report.status === 'ok' && report.forecast).toHaveLength(2);
  });
});

describe('GET /api/weather', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const sleep = async () => {};

  it('relays the weather for a point, uncached by browsers', async () => {
    const nws = fakeNws();
    app = await buildApp({ weather: { userAgent: UA, fetch: nws.fetch, now: () => T0, sleep } });

    const response = await app.inject({ method: 'GET', url: '/api/weather?lat=28.53842&lon=-81.37891' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ status: 'ok', place: 'Orlando, FL', current: { temperatureF: 77 } });
  });

  it('answers 503 without asking NWS when NWS_USER_AGENT is empty', async () => {
    const nws = fakeNws();
    app = await buildApp({ weather: { userAgent: '', fetch: nws.fetch } });

    const response = await app.inject({ method: 'GET', url: '/api/weather?lat=28.5&lon=-81.4' });

    expect(response.statusCode).toBe(503);
    expect(nws.fetch).not.toHaveBeenCalled();
  });

  it('answers 503 by default, when the app is built without weather options', async () => {
    app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/api/weather?lat=28.5&lon=-81.4' })).statusCode).toBe(503);
  });

  it.each(['', '?lat=28.5', '?lat=91&lon=0', '?lat=0&lon=-181', '?lat=abc&lon=0'])('rejects bad coordinates: %s', async (query) => {
    const nws = fakeNws();
    app = await buildApp({ weather: { userAgent: UA, fetch: nws.fetch, sleep } });

    const response = await app.inject({ method: 'GET', url: `/api/weather${query}` });

    expect(response.statusCode).toBe(400);
    expect(nws.fetch).not.toHaveBeenCalled();
  });

  it('answers 502 when NWS fails and nothing is cached', async () => {
    const nws = fakeNws({ [POINTS_URL]: () => json({}, 503) });
    app = await buildApp({ weather: { userAgent: UA, fetch: nws.fetch, sleep } });

    const response = await app.inject({ method: 'GET', url: '/api/weather?lat=28.53842&lon=-81.37891' });

    expect(response.statusCode).toBe(502);
    expect(nws.count(POINTS_URL)).toBe(3);
  });

  it('answers outside coverage as a normal result', async () => {
    const nws = fakeNws();
    app = await buildApp({ weather: { userAgent: UA, fetch: nws.fetch, sleep } });

    const response = await app.inject({ method: 'GET', url: '/api/weather?lat=48.8566&lon=2.3522' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'outside-coverage', message: OUTSIDE_COVERAGE_MESSAGE });
  });
});
