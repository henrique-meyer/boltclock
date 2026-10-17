import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/client-config', () => {
  it('serves the Maps key and Map ID from the environment, uncached', async () => {
    const config = loadConfig({ GOOGLE_MAPS_API_KEY: 'test-key', GOOGLE_MAPS_MAP_ID: 'test-map-id' });
    app = await buildApp({ clientConfig: config });
    const response = await app.inject({ method: 'GET', url: '/api/client-config' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ googleMapsApiKey: 'test-key', googleMapsMapId: 'test-map-id', testMode: false, allowSimulation: false, buttonIconsOnly: false });
  });

  it('shows icons only when BUTTON_ICONS_ONLY is true', async () => {
    app = await buildApp({ clientConfig: loadConfig({ BUTTON_ICONS_ONLY: 'true' }) });
    const response = await app.inject({ method: 'GET', url: '/api/client-config' });

    expect(response.json()).toMatchObject({ buttonIconsOnly: true, testMode: false });
  });

  it('turns test mode on only when TEST_MODE is true', async () => {
    app = await buildApp({ clientConfig: loadConfig({ TEST_MODE: 'true' }) });
    const response = await app.inject({ method: 'GET', url: '/api/client-config' });

    expect(response.json()).toMatchObject({ testMode: true });
  });

  it('offers simulation only when ALLOW_SIMULATION is true', async () => {
    app = await buildApp({ clientConfig: loadConfig({ ALLOW_SIMULATION: 'true' }) });
    const response = await app.inject({ method: 'GET', url: '/api/client-config' });

    expect(response.json()).toMatchObject({ allowSimulation: true, testMode: false });
  });

  it('sends nothing else from the configuration', async () => {
    const config = loadConfig({
      GOOGLE_MAPS_API_KEY: 'test-key',
      NWS_USER_AGENT: '(BoltClock, you@example.com)',
      STRIKES_TABLE_ENDPOINT: 'https://account.table.core.windows.net',
    });
    app = await buildApp({ clientConfig: config });
    const response = await app.inject({ method: 'GET', url: '/api/client-config' });

    expect(Object.keys(response.json()).sort()).toEqual(['allowSimulation', 'buttonIconsOnly', 'googleMapsApiKey', 'googleMapsMapId', 'testMode']);
    expect(response.body).not.toContain('you@example.com');
  });

  it('answers with an empty key and test mode off when nothing is configured', async () => {
    app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/client-config' });

    expect(response.json()).toEqual({ googleMapsApiKey: '', googleMapsMapId: 'DEMO_MAP_ID', testMode: false, allowSimulation: false, buttonIconsOnly: false });
  });
});
