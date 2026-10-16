export interface Config {
  port: number;
  /** Browser key for the Google Maps JavaScript API and Places. Empty when not configured. */
  googleMapsApiKey: string;
  /** User-Agent for api.weather.gov, with contact details. Empty when not configured. */
  nwsUserAgent: string;
  /** Public URL of the app, without a trailing slash. */
  publicBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT?.trim() || '8080';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, got "${rawPort}"`);
  }

  return {
    port,
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY?.trim() ?? '',
    nwsUserAgent: env.NWS_USER_AGENT?.trim() ?? '',
    publicBaseUrl: (env.PUBLIC_BASE_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, ''),
  };
}
