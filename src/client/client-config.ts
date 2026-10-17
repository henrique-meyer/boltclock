/** What the server tells the browser about its configuration (GET /api/client-config). */
export interface ClientConfig {
  googleMapsApiKey: string;
  googleMapsMapId: string;
}

export async function fetchClientConfig(fetcher: typeof fetch = fetch): Promise<ClientConfig> {
  const response = await fetcher('/api/client-config', { cache: 'no-store' });
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  const body = (await response.json()) as Partial<ClientConfig>;
  return {
    googleMapsApiKey: typeof body.googleMapsApiKey === 'string' ? body.googleMapsApiKey : '',
    googleMapsMapId: typeof body.googleMapsMapId === 'string' && body.googleMapsMapId ? body.googleMapsMapId : 'DEMO_MAP_ID',
  };
}

let loading: Promise<void> | undefined;

/**
 * Loads the Maps JavaScript API once, then `google.maps.importLibrary` gives each library. `onAuthFailure` runs if
 * Google rejects the key, for example when the page's address is not one of the key's allowed referrers.
 */
export function loadGoogleMaps(apiKey: string, onAuthFailure: () => void): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const callback = '__boltclockMapsReady';
    const global = window as unknown as Record<string, unknown>;
    global[callback] = () => {
      delete global[callback];
      resolve();
    };
    // Google calls this global by name when the key is refused.
    global.gm_authFailure = onAuthFailure;

    const params = new URLSearchParams({ key: apiKey, v: 'weekly', loading: 'async', callback });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => reject(new Error('The Google Maps script did not load.'));
    document.head.append(script);
  });
  return loading;
}
