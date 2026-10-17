import { describe, expect, it, vi } from 'vitest';
import { fetchClientConfig } from '../../src/client/client-config.js';

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('fetchClientConfig', () => {
  it('reads the key and the Map ID from the server, uncached', async () => {
    const fetcher = answer({ googleMapsApiKey: 'test-key', googleMapsMapId: 'test-map-id' });

    expect(await fetchClientConfig(fetcher)).toEqual({ googleMapsApiKey: 'test-key', googleMapsMapId: 'test-map-id' });
    expect(fetcher).toHaveBeenCalledWith('/api/client-config', { cache: 'no-store' });
  });

  it('falls back to no key and DEMO_MAP_ID for missing or odd values', async () => {
    expect(await fetchClientConfig(answer({ googleMapsApiKey: 42 }))).toEqual({
      googleMapsApiKey: '',
      googleMapsMapId: 'DEMO_MAP_ID',
    });
  });

  it('fails when the server does', async () => {
    await expect(fetchClientConfig(answer({}, 503))).rejects.toThrow(/503/);
  });
});
