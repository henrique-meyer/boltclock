import type { WeatherCondition, WeatherResponse } from '../shared/weather.js';

/**
 * Which full-screen background the display draws: one per weather condition, plus a plain navy while the weather is
 * unknown (before the first answer, outside NWS coverage, or when NWS reports nothing usable).
 */
export type BackgroundScene = WeatherCondition | 'neutral';

export const BACKGROUND_SCENES: readonly BackgroundScene[] = [
  'neutral',
  'clear-day',
  'clear-night',
  'cloudy',
  'rain',
  'thunderstorm',
  'fog',
  'snow',
  'wind',
];

const isScene = (value: unknown): value is BackgroundScene =>
  typeof value === 'string' && (BACKGROUND_SCENES as readonly string[]).includes(value);

/**
 * The scene for a weather answer: the latest observation's condition, else the first forecast hour's (no nearby
 * station reported), else neutral.
 */
export function backgroundScene(weather: WeatherResponse | undefined): BackgroundScene {
  if (weather?.status !== 'ok') return 'neutral';
  for (const condition of [weather.current?.condition, weather.forecast[0]?.condition]) {
    if (isScene(condition)) return condition;
  }
  return 'neutral';
}

/** `?background=rain` in the address shows that scene whatever the weather, to preview the art. */
export function backgroundOverride(search: string): BackgroundScene | undefined {
  const value = new URLSearchParams(search).get('background');
  return isScene(value) ? value : undefined;
}

/**
 * Each scene's sky, top to bottom. The art over it is translucent, so the sky sets the contrast for the display's
 * paper-coloured text: every stop stays dark enough for 7:1 or better (tested).
 */
export const SCENE_SKIES: Record<BackgroundScene, { top: string; bottom: string }> = {
  neutral: { top: '#0c2340', bottom: '#081a30' },
  'clear-day': { top: '#0b3157', bottom: '#134e7c' },
  'clear-night': { top: '#040b1a', bottom: '#0c2340' },
  cloudy: { top: '#1a2433', bottom: '#263244' },
  rain: { top: '#111c2a', bottom: '#1a2838' },
  thunderstorm: { top: '#0e0b1e', bottom: '#1c1733' },
  fog: { top: '#222b34', bottom: '#2f3a45' },
  snow: { top: '#17233a', bottom: '#24344f' },
  wind: { top: '#0d2a38', bottom: '#15404f' },
};

/** WCAG relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!digits) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const channel = (offset: number) => {
    const value = parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two #rrggbb colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
