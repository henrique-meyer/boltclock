import { describe, expect, it } from 'vitest';
import { openStream, streamUrl, type ConnectionState, type EventSourceLike } from '../../src/client/stream.js';
import type { HeartbeatMessage, StreamFlash } from '../../src/shared/messages.js';

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data?: unknown) {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

function setup() {
  let source: FakeEventSource | undefined;
  const flashes: StreamFlash[][] = [];
  const heartbeats: HeartbeatMessage[] = [];
  const states: ConnectionState[] = [];
  const close = openStream(
    { lat: 28.5, lon: -81.4, radiusKm: 16.09344, minutes: 30 },
    { onFlashes: (f) => flashes.push(f), onHeartbeat: (h) => heartbeats.push(h), onConnection: (s) => states.push(s) },
    (url) => (source = new FakeEventSource(url)),
  );
  return { source: source!, flashes, heartbeats, states, close };
}

const flash = (id: string): StreamFlash => ({ id, timeMs: 1, lat: 28.5, lon: -81.4 });

describe('openStream', () => {
  it('builds the stream URL from the query', () => {
    expect(streamUrl({ lat: 28.5, lon: -81.4, radiusKm: 16.09344, minutes: 30 })).toBe('/api/stream?lat=28.5&lon=-81.4&radiusKm=16.09344&minutes=30');
  });

  it('drops flashes the server replays after a reconnect', () => {
    const { source, flashes } = setup();
    source.emit('flashes', { type: 'flashes', flashes: [flash('a'), flash('b')] });
    source.emit('flashes', { type: 'flashes', flashes: [flash('a'), flash('b'), flash('c')] }); // replay after reconnect

    expect(flashes.map((batch) => batch.map((f) => f.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('passes heartbeats through and reports the connection state', () => {
    const { source, heartbeats, states } = setup();
    source.emit('open');
    source.emit('heartbeat', { type: 'heartbeat', latestFileEndMs: 5, serverTimeMs: 6 });
    source.readyState = 0;
    source.emit('error'); // dropped, will reconnect

    expect(heartbeats).toEqual([{ type: 'heartbeat', latestFileEndMs: 5, serverTimeMs: 6 }]);
    expect(states).toEqual(['connecting', 'open', 'reconnecting']);
  });

  it('reports a refused stream as failed', () => {
    const { source, states } = setup();
    source.readyState = 2;
    source.emit('error');

    expect(states.at(-1)).toBe('failed');
  });

  it('stops for good when the session ends', () => {
    const { source, states } = setup();
    source.emit('session-ended', { type: 'session-ended' });

    expect(source.closed).toBe(true);
    expect(states.at(-1)).toBe('ended');
  });
});
