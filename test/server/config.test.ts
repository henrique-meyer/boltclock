import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

describe('loadConfig', () => {
  it('defaults to port 8080 and a localhost base URL', () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      googleMapsApiKey: '',
      googleMapsMapId: 'DEMO_MAP_ID',
      nwsUserAgent: '',
      publicBaseUrl: 'http://localhost:8080',
      sessionLimitMinutes: 0,
      strikesTableEndpoint: '',
      testMode: false,
      allowSimulation: false,
      buttonIconsOnly: false,
      gaMeasurementId: '',
    });
  });

  it('reads and trims the contract variables', () => {
    const config = loadConfig({
      PORT: ' 3000 ',
      GOOGLE_MAPS_API_KEY: ' test-key ',
      GOOGLE_MAPS_MAP_ID: ' test-map-id ',
      NWS_USER_AGENT: ' (BoltClock, you@example.com) ',
      PUBLIC_BASE_URL: 'https://your-domain.example/',
      SESSION_LIMIT_MINUTES: ' 15 ',
      STRIKES_TABLE_ENDPOINT: ' https://account.table.core.windows.net/ ',
      TEST_MODE: ' TRUE ',
      ALLOW_SIMULATION: ' true ',
      BUTTON_ICONS_ONLY: ' true ',
      GA_MEASUREMENT_ID: ' G-ABC123XYZ ',
    });

    expect(config).toEqual({
      port: 3000,
      googleMapsApiKey: 'test-key',
      googleMapsMapId: 'test-map-id',
      nwsUserAgent: '(BoltClock, you@example.com)',
      publicBaseUrl: 'https://your-domain.example',
      sessionLimitMinutes: 15,
      strikesTableEndpoint: 'https://account.table.core.windows.net',
      testMode: true,
      allowSimulation: true,
      buttonIconsOnly: true,
      gaMeasurementId: 'G-ABC123XYZ',
    });
  });

  it('uses DEMO_MAP_ID when GOOGLE_MAPS_MAP_ID is empty', () => {
    expect(loadConfig({ GOOGLE_MAPS_MAP_ID: '  ' }).googleMapsMapId).toBe('DEMO_MAP_ID');
  });

  it('treats an empty or zero SESSION_LIMIT_MINUTES as no limit', () => {
    expect(loadConfig({ SESSION_LIMIT_MINUTES: '' }).sessionLimitMinutes).toBe(0);
    expect(loadConfig({ SESSION_LIMIT_MINUTES: '0' }).sessionLimitMinutes).toBe(0);
  });

  it.each(['-1', '2.5', 'ten'])('rejects SESSION_LIMIT_MINUTES=%s', (minutes) => {
    expect(() => loadConfig({ SESSION_LIMIT_MINUTES: minutes })).toThrow(/SESSION_LIMIT_MINUTES must be/);
  });

  it.each(['', 'false', '1', 'yes'])('keeps labels on the buttons for BUTTON_ICONS_ONLY=%s', (value) => {
    expect(loadConfig({ BUTTON_ICONS_ONLY: value }).buttonIconsOnly).toBe(false);
  });

  it.each(['', 'false', '1', 'yes'])('keeps test mode off for TEST_MODE=%s', (value) => {
    expect(loadConfig({ TEST_MODE: value }).testMode).toBe(false);
  });

  it('treats an empty PORT as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(8080);
  });

  it.each(['abc', '0', '70000', '80.5'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT must be a port number/);
  });

  it.each(['', 'UA-12345-1', 'G-', 'G-abc def', 'javascript:alert(1)'])('turns analytics off for GA_MEASUREMENT_ID=%s', (value) => {
    expect(loadConfig({ GA_MEASUREMENT_ID: value }).gaMeasurementId).toBe('');
  });
});
