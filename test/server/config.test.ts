import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

describe('loadConfig', () => {
  it('defaults to port 8080 and a localhost base URL', () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      googleMapsApiKey: '',
      nwsUserAgent: '',
      publicBaseUrl: 'http://localhost:8080',
    });
  });

  it('reads and trims the contract variables', () => {
    const config = loadConfig({
      PORT: ' 3000 ',
      GOOGLE_MAPS_API_KEY: ' test-key ',
      NWS_USER_AGENT: ' (BoltClock, you@example.com) ',
      PUBLIC_BASE_URL: 'https://your-domain.example/',
    });

    expect(config).toEqual({
      port: 3000,
      googleMapsApiKey: 'test-key',
      nwsUserAgent: '(BoltClock, you@example.com)',
      publicBaseUrl: 'https://your-domain.example',
    });
  });

  it('treats an empty PORT as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(8080);
  });

  it.each(['abc', '0', '70000', '80.5'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT must be a port number/);
  });
});
