import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({
  clientDir: resolve('dist/client'),
  assetsDir: resolve('assets'),
  logger: true,
});

// Say what is missing, never the values.
if (!config.googleMapsApiKey) app.log.warn('GOOGLE_MAPS_API_KEY is not set. The location picker will not load.');
if (!config.nwsUserAgent) app.log.warn('NWS_USER_AGENT is not set. api.weather.gov requires one.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
