import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

describe('loadConfig', () => {
  it('defaults to port 8080 and a localhost base URL', () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      googleMapsApiKey: '',
      nwsUserAgent: '',
      publicBaseUrl: 'http://localhost:8080',
      sessionLimitMinutes: 0,
    });
  });

  it('reads and trims the contract variables', () => {
    const config = loadConfig({
      PORT: ' 3000 ',
      GOOGLE_MAPS_API_KEY: ' test-key ',
      NWS_USER_AGENT: ' (BoltClock, you@example.com) ',
      PUBLIC_BASE_URL: 'https://your-domain.example/',
      SESSION_LIMIT_MINUTES: ' 15 ',
    });

    expect(config).toEqual({
      port: 3000,
      googleMapsApiKey: 'test-key',
      nwsUserAgent: '(BoltClock, you@example.com)',
      publicBaseUrl: 'https://your-domain.example',
      sessionLimitMinutes: 15,
    });
  });

  it('treats an empty or zero SESSION_LIMIT_MINUTES as no limit', () => {
    expect(loadConfig({ SESSION_LIMIT_MINUTES: '' }).sessionLimitMinutes).toBe(0);
    expect(loadConfig({ SESSION_LIMIT_MINUTES: '0' }).sessionLimitMinutes).toBe(0);
  });

  it.each(['-1', '2.5', 'ten'])('rejects SESSION_LIMIT_MINUTES=%s', (minutes) => {
    expect(() => loadConfig({ SESSION_LIMIT_MINUTES: minutes })).toThrow(/SESSION_LIMIT_MINUTES must be/);
  });

  it('treats an empty PORT as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(8080);
  });

  it.each(['abc', '0', '70000', '80.5'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT must be a port number/);
  });
});
