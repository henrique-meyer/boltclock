import type { FastifyInstance } from 'fastify';
import { WeatherRelay, type WeatherRelayOptions } from './relay.js';

export type WeatherOptions = Omit<WeatherRelayOptions, 'warn'>;

export function parseWeatherQuery(query: unknown): { lat: number; lon: number } | { error: string } {
  const q = (query ?? {}) as Record<string, unknown>;
  const num = (name: string) => (typeof q[name] === 'string' && q[name] !== '' ? Number(q[name]) : Number.NaN);
  const lat = num('lat');
  const lon = num('lon');
  if (!(lat >= -90 && lat <= 90)) return { error: 'lat must be between -90 and 90' };
  if (!(lon >= -180 && lon <= 180)) return { error: 'lon must be between -180 and 180' };
  return { lat, lon };
}

/**
 * GET /api/weather?lat&lon: current conditions and the next hours from api.weather.gov (see src/shared/weather.ts).
 * Browsers cannot set the User-Agent NWS requires, so the server asks for them. Without NWS_USER_AGENT it answers 503.
 */
export function registerWeather(app: FastifyInstance, options: WeatherOptions): void {
  const relay = options.userAgent ? new WeatherRelay({ ...options, warn: (message) => app.log.warn(message) }) : undefined;

  app.get('/api/weather', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    // The server warns once at startup when NWS_USER_AGENT is missing (src/server/index.ts).
    if (!relay) return reply.code(503).send({ error: 'weather is not configured on this server' });
    const query = parseWeatherQuery(request.query);
    if ('error' in query) return reply.code(400).send(query);
    try {
      return await relay.get(query.lat, query.lon);
    } catch {
      // The relay has already logged why, without the point.
      return reply.code(502).send({ error: 'api.weather.gov is not answering' });
    }
  });
}
