import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { registerClientConfig, type ClientConfig } from './client-config.js';
import { DEMO_MAP_ID } from './config.js';
import { registerStream, type StreamOptions } from './push/stream.js';
import { registerSeo } from './seo.js';
import { registerWeather, type WeatherOptions } from './weather/route.js';

export interface AppOptions {
  /** Served to the browser at GET /api/client-config. Without it the Maps key is empty and the picker says so. */
  clientConfig?: ClientConfig;
  /** The display's push channel, GET /api/stream. Without it the route answers 503. */
  stream?: StreamOptions;
  /** The weather relay, GET /api/weather. Without a User-Agent the route answers 503. */
  weather?: WeatherOptions;
  /** The built client (dist/client). Skipped when missing: `npm run dev` serves the client through Vite. */
  clientDir?: string;
  /** The brand files (assets/), served under /assets/. */
  assetsDir?: string;
  /** PUBLIC_BASE_URL: the pages' canonical and share URLs, robots.txt and the sitemap (BOLT-54). */
  publicBaseUrl?: string;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  // Request logging stays off: the health probes alone would fill the log workspace's daily cap.
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    // Display streams never finish by themselves; close them on shutdown so a new revision starts promptly.
    // Browsers reconnect, and the server replays their window.
    forceCloseConnections: true,
  });

  // Process health only. It never reflects lightning-data freshness: stale data is a warning on the display.
  app.get('/health', async () => ({ status: 'ok' }));

  registerClientConfig(
    app,
    options.clientConfig ?? { googleMapsApiKey: '', googleMapsMapId: DEMO_MAP_ID, testMode: false, allowSimulation: false, buttonIconsOnly: false, gaMeasurementId: '' },
  );
  registerStream(app, options.stream ?? { sessionLimitMinutes: 0 });
  registerWeather(app, options.weather ?? { userAgent: '' });

  if (options.assetsDir && existsSync(options.assetsDir)) {
    await app.register(fastifyStatic, { root: options.assetsDir, prefix: '/assets/', decorateReply: false });
  }
  const clientDir = options.clientDir && existsSync(options.clientDir) ? options.clientDir : undefined;
  // robots.txt, sitemap.xml and the pages with their absolute URLs filled in (BOLT-54).
  registerSeo(app, { publicBaseUrl: options.publicBaseUrl ?? 'http://localhost:8080', clientDir });
  if (clientDir) {
    // The pages come from registerSeo; the static files serve everything else (bundles under /static/).
    await app.register(fastifyStatic, { root: clientDir, prefix: '/', index: false });
    // The picker's address is /location (BOLT-39). The old /location.html redirects there, keeping its query.
    app.get('/location.html', (request, reply) => {
      const query = request.url.indexOf('?');
      return reply.redirect(`/location${query === -1 ? '' : request.url.slice(query)}`, 301);
    });
  }

  return app;
}
