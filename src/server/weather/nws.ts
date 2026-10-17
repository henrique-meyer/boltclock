/** api.weather.gov. Every request names the app and a contact in its User-Agent, as NWS requires. */
export const NWS_BASE_URL = 'https://api.weather.gov';

/** NWS answered with an error status (after retries for 429 and 5xx). */
export class NwsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NwsError';
  }
}

export interface NwsClientOptions {
  /** e.g. "(BoltClock, you@example.com)". */
  userAgent: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Wait before retrying a throttled or failed request. NWS asks for about 5 s. */
  retryDelayMs?: number;
  /** Tries per request, including the first. */
  maxAttempts?: number;
  /** Per-try timeout. */
  timeoutMs?: number;
}

/** A Retry-After longer than this is not waited out: the relay serves its cached copy instead. */
const MAX_RETRY_AFTER_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Returns a function that GETs an NWS URL as JSON. NWS's rate limit is unpublished: on 429, a 5xx or a network
 * failure it waits about 5 s (longer if Retry-After says so) and tries again, up to maxAttempts. Other 4xx answers
 * are thrown at once as NwsError. 404 is how NWS says a point is outside its coverage.
 */
export function createNwsClient(options: NwsClientOptions): (url: string) => Promise<unknown> {
  const fetcher = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const retryDelayMs = options.retryDelayMs ?? 5000;
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers = { 'user-agent': options.userAgent, accept: 'application/geo+json' };

  return async (url) => {
    let lastError: Error = new Error('no attempt made');
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let waitMs = retryDelayMs;
      try {
        const response = await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) return await response.json();
        const error = new NwsError(response.status, `api.weather.gov answered ${response.status}`);
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
        const retryAfterS = Number(response.headers.get('retry-after'));
        if (retryAfterS > 0) waitMs = Math.max(waitMs, retryAfterS * 1000);
        if (waitMs > MAX_RETRY_AFTER_MS) break;
      } catch (error) {
        if (error instanceof NwsError) throw error;
        // A network failure or the timeout: worth another try.
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (attempt < maxAttempts) await sleep(waitMs);
    }
    throw lastError;
  };
}
