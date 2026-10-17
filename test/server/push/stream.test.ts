import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../src/server/app.js';
import { parseStreamQuery } from '../../../src/server/push/stream.js';
import { MemoryTableStore, storeGlmFile } from '../../../src/server/strikes/store.js';
import type { StreamMessage } from '../../../src/shared/messages.js';

const ORLANDO = { lat: 28.54, lon: -81.38 };
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Stores one GLM file's worth of flashes, timed relative to now. */
async function addFile(store: MemoryTableStore, secondsAgo: number, flashes: { id: number; lat: number; lon: number }[]) {
  const startMs = Date.now() - secondsAgo * 1000;
  await storeGlmFile(store, {
    startMs,
    endMs: startMs + 20_000,
    totalFlashes: flashes.length,
    flashes: flashes.map((f) => ({ ...f, timeMs: startMs + 1000, quality: 0 })),
  });
  return startMs;
}

async function start(store: MemoryTableStore | undefined, extra: { pollMs?: number; sessionLimitMinutes?: number } = {}) {
  app = await buildApp({ stream: { store, sessionLimitMinutes: extra.sessionLimitMinutes ?? 0, pollMs: extra.pollMs ?? 50 } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

/** Reads SSE messages until `until` says stop (or the stream ends), then aborts. */
async function readMessages(url: string, until: (messages: StreamMessage[]) => boolean, timeoutMs = 3000): Promise<StreamMessage[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const messages: StreamMessage[] = [];
  try {
    const response = await fetch(url, { signal: abort.signal });
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (data) messages.push(JSON.parse(data.slice(6)) as StreamMessage);
      }
      if (until(messages)) break;
    }
  } catch (error) {
    // Our own abort, or the server hanging up (undici reports "terminated"), both just end the read.
    const ended = error instanceof Error && (error.name === 'AbortError' || error.message === 'terminated');
    if (!ended) throw error;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  return messages;
}

const query = (q: Record<string, number>) => `/api/stream?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`;

describe('GET /api/stream', () => {
  it('replays nearby flashes in the window, then a heartbeat', async () => {
    const store = new MemoryTableStore();
    const start1 = await addFile(store, 60, [
      { id: 1, ...ORLANDO }, // here
      { id: 2, lat: 28.54, lon: -80.9 }, // about 47 km east: outside 20 km
    ]);
    await addFile(store, 40 * 60, [{ id: 3, ...ORLANDO }]); // 40 minutes ago: outside a 30-minute window
    const base = await start(store);

    const messages = await readMessages(`${base}${query({ ...ORLANDO, radiusKm: 20, minutes: 30 })}`, (m) => m.some((x) => x.type === 'heartbeat'));

    expect(messages[0]).toEqual({ type: 'flashes', flashes: [{ id: `${start1}-1`, timeMs: start1 + 1000, lat: ORLANDO.lat, lon: ORLANDO.lon }] });
    expect(messages[1]).toMatchObject({ type: 'heartbeat', latestFileEndMs: start1 + 20_000 });
  });

  it('sends an empty flashes message first when nothing is nearby', async () => {
    const base = await start(new MemoryTableStore());
    const messages = await readMessages(`${base}${query({ ...ORLANDO, radiusKm: 20, minutes: 30 })}`, (m) => m.length >= 2);

    expect(messages[0]).toEqual({ type: 'flashes', flashes: [] });
    expect(messages[1]).toMatchObject({ type: 'heartbeat', latestFileEndMs: null });
  });

  it('sends each new flash once as it arrives', async () => {
    const store = new MemoryTableStore();
    await addFile(store, 60, [{ id: 1, ...ORLANDO }]);
    const base = await start(store);
    let added = false;

    const messages = await readMessages(`${base}${query({ ...ORLANDO, radiusKm: 20, minutes: 30 })}`, (m) => {
      if (!added && m.some((x) => x.type === 'heartbeat')) {
        added = true;
        void addFile(store, 30, [{ id: 7, ...ORLANDO }]);
      }
      return m.filter((x) => x.type === 'heartbeat').length >= 6;
    });

    const sent = messages.flatMap((m) => (m.type === 'flashes' ? m.flashes.map((f) => f.id) : []));
    expect(sent).toHaveLength(2);
    expect(new Set(sent).size).toBe(2);
  });

  it('ends the session at the limit', async () => {
    const base = await start(new MemoryTableStore(), { sessionLimitMinutes: 0.002 }); // 120 ms
    const messages = await readMessages(`${base}${query({ ...ORLANDO, radiusKm: 20, minutes: 30 })}`, (m) => m.some((x) => x.type === 'session-ended'));

    expect(messages.at(-1)).toEqual({ type: 'session-ended' });
  });

  it('answers 503 without a flash store and 400 for bad parameters', async () => {
    const noStore = await start(undefined);
    expect((await fetch(`${noStore}${query({ ...ORLANDO, radiusKm: 20, minutes: 30 })}`)).status).toBe(503);
    await app!.close();

    const base = await start(new MemoryTableStore());
    const bad = await fetch(`${base}${query({ lat: 95, lon: 0, radiusKm: 20, minutes: 30 })}`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'lat must be between -90 and 90' });
  });

  it('closes open streams when the server shuts down', async () => {
    const base = await start(new MemoryTableStore(), { pollMs: 10_000 });
    const reading = readMessages(`${base}${query({ ...ORLANDO, radiusKm: 20, minutes: 30 })}`, () => false, 5000);
    await new Promise((r) => setTimeout(r, 200));

    const started = Date.now();
    await app!.close();
    app = undefined;
    await reading;
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('parseStreamQuery', () => {
  it('accepts the documented ranges', () => {
    expect(parseStreamQuery({ lat: '28.5', lon: '-81.4', radiusKm: '160.9344', minutes: '120' })).toEqual({ lat: 28.5, lon: -81.4, radiusKm: 160.9344, minutes: 120 });
  });

  it.each([
    [{ lat: '', lon: '0', radiusKm: '1', minutes: '1' }, /lat/],
    [{ lat: '0', lon: '181', radiusKm: '1', minutes: '1' }, /lon/],
    [{ lat: '0', lon: '0', radiusKm: '0', minutes: '1' }, /radiusKm/],
    [{ lat: '0', lon: '0', radiusKm: '200', minutes: '1' }, /radiusKm/],
    [{ lat: '0', lon: '0', radiusKm: '1', minutes: '121' }, /minutes/],
    [{ lat: '0', lon: '0', radiusKm: '1', minutes: '2.5' }, /minutes/],
  ])('rejects %o', (q, message) => {
    expect((parseStreamQuery(q) as { error: string }).error).toMatch(message);
  });
});
