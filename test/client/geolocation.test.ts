import { describe, expect, it } from 'vitest';
import { currentPosition } from '../../src/client/geolocation.js';

type Geo = Pick<Geolocation, 'getCurrentPosition'>;

const answering = (lat: number, lon: number): Geo => ({
  getCurrentPosition: (success) => success({ coords: { latitude: lat, longitude: lon } } as GeolocationPosition),
});
const refusing: Geo = {
  getCurrentPosition: (_success, error) => error?.({ code: 1, message: 'denied' } as GeolocationPositionError),
};

describe('currentPosition', () => {
  it('answers the browser position as a point', async () => {
    await expect(currentPosition(answering(28.5384, -81.3789))).resolves.toEqual({ lat: 28.5384, lon: -81.3789 });
  });

  it('answers undefined when the location is denied or unavailable', async () => {
    await expect(currentPosition(refusing)).resolves.toBeUndefined();
  });

  it('answers undefined without geolocation', async () => {
    await expect(currentPosition(undefined)).resolves.toBeUndefined();
  });
});
