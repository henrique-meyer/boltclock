import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { registerClientConfig, type ClientConfig } from './client-config.js';
import { DEMO_MAP_ID } from './config.js';

export interface AppOptions {
  /** Served to the browser at GET /api/client-config. Without it the Maps key is empty and the picker says so. */
  clientConfig?: ClientConfig;
  /** The built client (dist/client). Skipped when missing: `npm run dev` serves the client through Vite. */
  clientDir?: string;
  /** The brand files (assets/), served under /assets/. */
  assetsDir?: string;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  // Request logging stays off: the health probes alone would fill the log workspace's daily cap.
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });

  // Process health only. It never reflects lightning-data freshness: stale data is a warning on the display.
  app.get('/health', async () => ({ status: 'ok' }));

  registerClientConfig(app, options.clientConfig ?? { googleMapsApiKey: '', googleMapsMapId: DEMO_MAP_ID });

  if (options.assetsDir && existsSync(options.assetsDir)) {
    await app.register(fastifyStatic, { root: options.assetsDir, prefix: '/assets/', decorateReply: false });
  }
  if (options.clientDir && existsSync(options.clientDir)) {
    await app.register(fastifyStatic, { root: options.clientDir, prefix: '/' });
  }

  return app;
}
