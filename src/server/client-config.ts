import type { FastifyInstance } from 'fastify';

/** What the browser needs from the server's configuration. Only values that are public by design belong here. */
export interface ClientConfig {
  /**
   * The Google Maps browser key. It is visible to every visitor anyway (it is in the Maps script URL), so it is
   * protected by its HTTP-referrer and API restrictions, not by secrecy. Empty when not configured.
   */
  googleMapsApiKey: string;
  googleMapsMapId: string;
  /** Simulation mode's default on each display (TEST_MODE). */
  testMode: boolean;
  /** Displays offer Simulation mode at all (ALLOW_SIMULATION). Off in a real deployment. */
  allowSimulation: boolean;
  /** The display's top-right buttons show only their icons, without text labels. */
  buttonIconsOnly: boolean;
}

/** GET /api/client-config: read at runtime, so one image serves any deployment and the key is never built in. */
export function registerClientConfig(app: FastifyInstance, config: ClientConfig): void {
  const body: ClientConfig = {
    googleMapsApiKey: config.googleMapsApiKey,
    googleMapsMapId: config.googleMapsMapId,
    testMode: config.testMode === true,
    allowSimulation: config.allowSimulation === true,
    buttonIconsOnly: config.buttonIconsOnly === true,
  };
  app.get('/api/client-config', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return body;
  });
}
