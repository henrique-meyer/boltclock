import type { Point } from './location-settings.js';

const GEOLOCATION_TIMEOUT_MS = 10_000;

/**
 * The browser's location, or undefined when it is denied, unavailable or slow. Never stored unless the caller saves
 * it. The first call may show the browser's permission prompt.
 */
export function currentPosition(
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined = 'geolocation' in navigator ? navigator.geolocation : undefined,
  timeoutMs = GEOLOCATION_TIMEOUT_MS,
): Promise<Point | undefined> {
  if (!geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      () => resolve(undefined),
      { timeout: timeoutMs, maximumAge: 10 * 60_000 },
    );
  });
}

/** Calls `onGranted` whenever the browser's location permission turns to granted. Does nothing without the API. */
export function onLocationGranted(onGranted: () => void): void {
  navigator.permissions
    ?.query({ name: 'geolocation' })
    .then((permission) =>
      permission.addEventListener('change', () => {
        if (permission.state === 'granted') onGranted();
      }),
    )
    .catch(() => {});
}
