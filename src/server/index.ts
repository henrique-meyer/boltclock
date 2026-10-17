import { resolve } from 'node:path';
import { DefaultAzureCredential } from '@azure/identity';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { AzureTableStore } from './strikes/azure-store.js';

const config = loadConfig();
// In Azure the container app reads the flash tables with its managed identity (Storage Table Data Reader).
const store = config.strikesTableEndpoint
  ? new AzureTableStore(config.strikesTableEndpoint, new DefaultAzureCredential())
  : undefined;
const app = await buildApp({
  clientConfig: { googleMapsApiKey: config.googleMapsApiKey, googleMapsMapId: config.googleMapsMapId, testMode: config.testMode },
  clientDir: resolve('dist/client'),
  assetsDir: resolve('assets'),
  logger: true,
  stream: { store, sessionLimitMinutes: config.sessionLimitMinutes },
});

// Say what is missing, never the values.
if (!config.googleMapsApiKey) app.log.warn('GOOGLE_MAPS_API_KEY is not set. The location picker will not load.');
if (!config.nwsUserAgent) app.log.warn('NWS_USER_AGENT is not set. api.weather.gov requires one.');
if (config.sessionLimitMinutes > 0) app.log.info(`Display sessions end after ${config.sessionLimitMinutes} minutes.`);
if (config.testMode) app.log.info('TEST_MODE is on: the display offers a simulated strike.');
if (!store) app.log.warn('STRIKES_TABLE_ENDPOINT is not set. /api/stream answers 503.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
