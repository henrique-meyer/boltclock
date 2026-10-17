import { describe, expect, it, vi } from 'vitest';
import { fetchClientConfig } from '../../src/client/client-config.js';

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('fetchClientConfig', () => {
  it('reads the key, the Map ID and test mode from the server, uncached', async () => {
    const fetcher = answer({ googleMapsApiKey: 'test-key', googleMapsMapId: 'test-map-id', testMode: true });

    expect(await fetchClientConfig(fetcher)).toEqual({ googleMapsApiKey: 'test-key', googleMapsMapId: 'test-map-id', testMode: true });
    expect(fetcher).toHaveBeenCalledWith('/api/client-config', { cache: 'no-store' });
  });

  it('falls back to no key, DEMO_MAP_ID and test mode off for missing or odd values', async () => {
    expect(await fetchClientConfig(answer({ googleMapsApiKey: 42, testMode: 'true' }))).toEqual({
      googleMapsApiKey: '',
      googleMapsMapId: 'DEMO_MAP_ID',
      testMode: false,
    });
  });

  it('fails when the server does', async () => {
    await expect(fetchClientConfig(answer({}, 503))).rejects.toThrow(/503/);
  });
});
