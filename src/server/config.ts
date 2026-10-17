/** Google's shared Map ID for trying out vector maps and Advanced Markers. Deployers can create their own. */
export const DEMO_MAP_ID = 'DEMO_MAP_ID';

export interface Config {
  port: number;
  /** Browser key for the Google Maps JavaScript API and Places. Empty when not configured. */
  googleMapsApiKey: string;
  /** Map ID for the location picker's vector map and Advanced Marker. Google's DEMO_MAP_ID when not configured. */
  googleMapsMapId: string;
  /** User-Agent for api.weather.gov, with contact details. Empty when not configured. */
  nwsUserAgent: string;
  /** Public URL of the app, without a trailing slash. */
  publicBaseUrl: string;
  /**
   * Minutes after which the server ends a display session, so a demo deployment can scale back to zero.
   * 0 means no limit (ADR 0003).
   */
  sessionLimitMinutes: number;
  /** Table Storage endpoint of the flash tables (ADR 0004). Empty: no flash store, and /api/stream answers 503. */
  strikesTableEndpoint: string;
  /** Shows the display's "Simulate a strike" button (BOLT-21). Off unless TEST_MODE is exactly "true". */
  testMode: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT?.trim() || '8080';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, got "${rawPort}"`);
  }

  const rawSessionLimit = env.SESSION_LIMIT_MINUTES?.trim() || '0';
  const sessionLimitMinutes = Number(rawSessionLimit);
  if (!Number.isInteger(sessionLimitMinutes) || sessionLimitMinutes < 0) {
    throw new Error(`SESSION_LIMIT_MINUTES must be a whole number of minutes, got "${rawSessionLimit}"`);
  }

  return {
    port,
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY?.trim() ?? '',
    googleMapsMapId: env.GOOGLE_MAPS_MAP_ID?.trim() || DEMO_MAP_ID,
    nwsUserAgent: env.NWS_USER_AGENT?.trim() ?? '',
    publicBaseUrl: (env.PUBLIC_BASE_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, ''),
    sessionLimitMinutes,
    strikesTableEndpoint: (env.STRIKES_TABLE_ENDPOINT?.trim() ?? '').replace(/\/+$/, ''),
    testMode: env.TEST_MODE?.trim().toLowerCase() === 'true',
  };
}
