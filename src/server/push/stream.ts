import type { FastifyInstance } from 'fastify';
import {
  flashId,
  MAX_RADIUS_KM,
  MAX_WINDOW_MINUTES,
  type StreamFlash,
  type StreamMessage,
  type StreamQuery,
} from '../../shared/messages.js';
import { queryStrikes, type TableStore } from '../strikes/store.js';

export interface StreamOptions {
  /** Where flashes are read from. Without one, the stream answers 503. */
  store?: TableStore;
  /** End each session after this many minutes so a demo can scale to zero (ADR 0003). 0: no limit. */
  sessionLimitMinutes: number;
  /** How often to read new flashes and send a heartbeat. Default 15 s, well inside the ingress's 240 s timeout. */
  pollMs?: number;
  now?: () => number;
}

/** GLM files arrive 20–60 s after their window, so each read looks back this far for flashes not yet sent. */
const LATE_ARRIVAL_MS = 3 * 60_000;

export function parseStreamQuery(query: unknown): StreamQuery | { error: string } {
  const q = (query ?? {}) as Record<string, unknown>;
  const num = (name: string) => (typeof q[name] === 'string' && q[name] !== '' ? Number(q[name]) : Number.NaN);
  const lat = num('lat');
  const lon = num('lon');
  const radiusKm = num('radiusKm');
  const minutes = num('minutes');
  if (!(lat >= -90 && lat <= 90)) return { error: 'lat must be between -90 and 90' };
  if (!(lon >= -180 && lon <= 180)) return { error: 'lon must be between -180 and 180' };
  if (!(radiusKm > 0 && radiusKm <= MAX_RADIUS_KM)) return { error: `radiusKm must be above 0 and at most ${MAX_RADIUS_KM}` };
  if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_WINDOW_MINUTES)) {
    return { error: `minutes must be a whole number from 1 to ${MAX_WINDOW_MINUTES}` };
  }
  return { lat, lon, radiusKm, minutes };
}

/** GET /api/stream: server-sent events with the flashes near one point (see src/shared/messages.ts). */
export function registerStream(app: FastifyInstance, options: StreamOptions): void {
  const pollMs = options.pollMs ?? 15_000;
  const now = options.now ?? Date.now;

  app.get('/api/stream', async (request, reply) => {
    const store = options.store;
    if (!store) return reply.code(503).send({ error: 'no flash store is configured' });
    const query = parseStreamQuery(request.query);
    if ('error' in query) return reply.code(400).send(query);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n'); // EventSource waits 5 s before reconnecting

    let closed = false;
    let pollTimer: NodeJS.Timeout | undefined;
    let limitTimer: NodeJS.Timeout | undefined;
    const sent = new Set<string>();
    const windowStartMs = now() - query.minutes * 60_000;
    let lastReadMs: number | undefined;

    const write = (text: string) => {
      if (!closed) res.write(text);
    };
    const send = (message: StreamMessage) => write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(pollTimer);
      clearTimeout(limitTimer);
      res.end();
    };
    request.raw.on('close', close);

    const read = async () => {
      const nowMs = now();
      const sinceMs = lastReadMs === undefined ? windowStartMs : Math.max(windowStartMs, lastReadMs - LATE_ARRIVAL_MS);
      try {
        const [strikes, latestFileEnd] = await Promise.all([
          queryStrikes(store, { lat: query.lat, lon: query.lon, radiusKm: query.radiusKm, sinceMs, nowMs }),
          store.latestFileEnd(),
        ]);
        const fresh: StreamFlash[] = [];
        for (const s of strikes) {
          const id = flashId(s.fileStartMs, s.id);
          if (sent.has(id)) continue;
          sent.add(id);
          fresh.push({ id, timeMs: s.timeMs, lat: s.lat, lon: s.lon });
        }
        // The first message always comes, even empty, so the display knows the replay is complete.
        if (fresh.length > 0 || lastReadMs === undefined) send({ type: 'flashes', flashes: fresh });
        send({ type: 'heartbeat', latestFileEndMs: latestFileEnd ?? null, serverTimeMs: nowMs });
        lastReadMs = nowMs;
      } catch (error) {
        // No heartbeat: the display's data ages and it shows "NO LIGHTNING DATA". The comment keeps the stream open.
        request.log.error(`Flash read failed: ${error instanceof Error ? error.message : String(error)}`);
        write(': read failed\n\n');
      }
      if (!closed) pollTimer = setTimeout(() => void read(), pollMs);
    };

    if (options.sessionLimitMinutes > 0) {
      limitTimer = setTimeout(() => {
        send({ type: 'session-ended' });
        close();
      }, options.sessionLimitMinutes * 60_000);
    }

    await read();
  });
}
