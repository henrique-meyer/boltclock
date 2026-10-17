import type { FlashesMessage, HeartbeatMessage, StreamFlash, StreamQuery } from '../shared/messages.js';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'failed' | 'ended';

export interface StreamHandlers {
  /** New flashes only: the server's replay after a reconnect is filtered out here. */
  onFlashes: (flashes: StreamFlash[]) => void;
  onHeartbeat: (heartbeat: HeartbeatMessage) => void;
  onConnection: (state: ConnectionState) => void;
}

/** The parts of EventSource this module uses, so tests can pass a fake. */
export interface EventSourceLike {
  readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const CLOSED = 2; // EventSource.CLOSED

export function streamUrl(query: StreamQuery): string {
  const params = new URLSearchParams({
    lat: String(query.lat),
    lon: String(query.lon),
    radiusKm: String(query.radiusKm),
    minutes: String(query.minutes),
  });
  return `/api/stream?${params}`;
}

/**
 * Opens the display's push channel. The browser reconnects by itself when the stream drops (for example at the
 * ingress's 240 s limit); the server then replays the window and the duplicates are dropped here.
 * A session-ended message stops reconnecting for good. Returns a function that closes the stream.
 */
export function openStream(
  query: StreamQuery,
  handlers: StreamHandlers,
  createSource: EventSourceFactory = (url) => new EventSource(url),
): () => void {
  const seen = new Set<string>();
  const source = createSource(streamUrl(query));
  handlers.onConnection('connecting');

  source.addEventListener('open', () => handlers.onConnection('open'));
  source.addEventListener('error', () => {
    // CLOSED after an error means the server refused the stream (4xx/5xx); EventSource will not retry that.
    handlers.onConnection(source.readyState === CLOSED ? 'failed' : 'reconnecting');
  });
  source.addEventListener('flashes', (event) => {
    const message = JSON.parse(event.data) as FlashesMessage;
    const fresh = message.flashes.filter((flash) => !seen.has(flash.id));
    for (const flash of fresh) seen.add(flash.id);
    handlers.onFlashes(fresh);
  });
  source.addEventListener('heartbeat', (event) => handlers.onHeartbeat(JSON.parse(event.data) as HeartbeatMessage));
  source.addEventListener('session-ended', () => {
    source.close();
    handlers.onConnection('ended');
  });

  return () => source.close();
}
