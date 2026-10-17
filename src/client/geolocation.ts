import type { Point } from './location-settings.js';

const GEOLOCATION_TIMEOUT_MS = 10_000;

/**
 * The browser's location, or undefined when it is denied, unavailable or slow. Never stored unless the caller saves
 * it. The first call may show the browser's permission prompt.
 */
export function currentPosition(
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined = 'geolocation' in navigator ? navigator.geolocation : undefined,
): Promise<Point | undefined> {
  if (!geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      () => resolve(undefined),
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 10 * 60_000 },
    );
  });
}
