import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sceneArt } from '../../src/client/backdrop-art.js';
import {
  BACKGROUND_SCENES,
  backgroundOverride,
  backgroundScene,
  contrastRatio,
  SCENE_SKIES,
} from '../../src/client/weather-background.js';
import type { CurrentWeather, ForecastHour, WeatherReport } from '../../src/shared/weather.js';

const NOW = Date.parse('2026-07-15T18:20:00Z');

const current = (condition: CurrentWeather['condition']): CurrentWeather => ({
  observedAtMs: NOW,
  temperatureF: 77,
  text: '',
  icon: null,
  condition,
  windSpeedMph: null,
  windGustMph: null,
  windDirectionDeg: null,
  station: 'KORL',
});

const hour = (condition: ForecastHour['condition']): ForecastHour => ({
  startMs: NOW,
  temperatureF: 80,
  text: '',
  icon: null,
  condition,
  precipitationChance: null,
  windSpeedMph: null,
  windDirection: '',
});

const report = (overrides: Partial<WeatherReport>): WeatherReport => ({
  status: 'ok',
  place: 'Orlando, FL',
  current: current('cloudy'),
  forecast: [hour('rain'), hour('thunderstorm')],
  updatedAtMs: NOW,
  stale: false,
  ...overrides,
});

describe('backgroundScene', () => {
  it("uses the latest observation's condition", () => {
    expect(backgroundScene(report({}))).toBe('cloudy');
    expect(backgroundScene(report({ current: current('clear-night') }))).toBe('clear-night');
  });

  it('falls back to the first forecast hour when no station reports', () => {
    expect(backgroundScene(report({ current: null }))).toBe('rain');
  });

  it('is neutral with neither an observation nor a forecast', () => {
    expect(backgroundScene(report({ current: null, forecast: [] }))).toBe('neutral');
  });

  it('is neutral before the first answer and outside NWS coverage', () => {
    expect(backgroundScene(undefined)).toBe('neutral');
    expect(backgroundScene({ status: 'outside-coverage', message: 'No NWS data here.' })).toBe('neutral');
  });

  it('keeps using a stale cached answer', () => {
    expect(backgroundScene(report({ stale: true, current: current('snow') }))).toBe('snow');
  });

  it('skips a condition it has no art for', () => {
    const odd = current('fog');
    (odd as { condition: string }).condition = 'volcanic-ash';
    expect(backgroundScene(report({ current: odd }))).toBe('rain');
  });
});

describe('backgroundOverride', () => {
  it('reads ?background= when it names a scene', () => {
    expect(backgroundOverride('?lat=28.5&lon=-81.4&background=thunderstorm')).toBe('thunderstorm');
    expect(backgroundOverride('?background=neutral')).toBe('neutral');
  });

  it('ignores a missing or unknown scene', () => {
    expect(backgroundOverride('?lat=28.5&lon=-81.4')).toBeUndefined();
    expect(backgroundOverride('?background=lava')).toBeUndefined();
  });
});

/** The colours the stylesheet defines on :root. */
function cssColors(): (name: string) => string {
  const css = readFileSync(new URL('../../src/client/styles.css', import.meta.url), 'utf8');
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const colors = new Map([...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
  return (name) => {
    const value = colors.get(name);
    if (!value) throw new Error(`styles.css has no --${name}`);
    return value;
  };
}

describe('contrast, read from 20 ft', () => {
  const color = cssColors();

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('keeps paper text at 7:1 or better on every sky', () => {
    for (const scene of BACKGROUND_SCENES) {
      for (const stop of [SCENE_SKIES[scene].top, SCENE_SKIES[scene].bottom]) {
        expect(contrastRatio(color('paper'), stop), `${scene} ${stop}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('keeps alert text readable on the alert reds', () => {
    for (const red of [color('alert'), color('alert-deep')]) {
      expect(contrastRatio(color('paper'), red)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(color('amber'), red)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('sceneArt', () => {
  it('draws every scene but neutral', () => {
    expect(sceneArt('neutral')).toBe('');
    for (const scene of BACKGROUND_SCENES.filter((s) => s !== 'neutral')) {
      expect(sceneArt(scene), scene).toContain('bg-layer');
    }
  });

  it("prefixes every id with the scene's name, so two scenes can crossfade", () => {
    for (const scene of BACKGROUND_SCENES) {
      const art = sceneArt(scene);
      for (const [, id = ''] of art.matchAll(/\bid="([^"]+)"/g)) expect(id.startsWith(`bg-${scene}-`), id).toBe(true);
      for (const [, ref] of art.matchAll(/url\(#([^)]+)\)/g)) expect(art).toContain(`id="${ref}"`);
    }
  });

  it('uses no images or external files', () => {
    for (const scene of BACKGROUND_SCENES) expect(sceneArt(scene)).not.toMatch(/<image|href=|https?:\/\/(?!www\.w3\.org)/);
  });

  it('is the same on every load', () => {
    expect(sceneArt('clear-night')).toBe(sceneArt('clear-night'));
  });
});
