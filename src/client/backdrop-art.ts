/**
 * Original background art for each weather scene, drawn as inline SVG in the brand colours (navy, paper, bolt cyan).
 * Everything is translucent and kept to the edges where it can be, so the display's large text reads over it. Each
 * scene is a stack of layers: static scenery, slowly drifting layers, and tiled rain or snow that falls. Moving
 * layers move as whole elements, so the browser composites them instead of repainting the SVG every frame.
 *
 * Every id is prefixed `bg-<scene>-`, because two scenes share the page while they crossfade.
 */
import type { BackgroundScene } from './weather-background.js';

const PAPER = '#f4f0e6';
const BOLT = '#4cc9f0';

/** A full-screen layer, 1600 × 900 units, cropped (not squashed) to the screen's shape. */
function layer(className: string, body: string, defs = ''): string {
  return (
    `<svg class="bg-layer ${className}" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    body +
    '</svg>'
  );
}

/** One puffy cloud, `width` units wide, sitting on the line y = `base`. The group's opacity applies to the whole. */
function cloud(cx: number, base: number, width: number, fill: string, opacity: number): string {
  const w = width;
  const circle = (dx: number, dy: number, r: number) =>
    `<circle cx="${(cx + dx * w).toFixed(1)}" cy="${(base + dy * w).toFixed(1)}" r="${(r * w).toFixed(1)}"/>`;
  return (
    `<g fill="${fill}" opacity="${opacity}">` +
    circle(-0.3, -0.1, 0.16) +
    circle(-0.08, -0.2, 0.24) +
    circle(0.18, -0.13, 0.19) +
    circle(0.36, -0.04, 0.12) +
    `<rect x="${(cx - 0.44 * w).toFixed(1)}" y="${(base - 0.12 * w).toFixed(1)}" width="${(0.84 * w).toFixed(1)}" ` +
    `height="${(0.2 * w).toFixed(1)}" rx="${(0.1 * w).toFixed(1)}"/>` +
    '</g>'
  );
}

/** A solid overcast deck across the top of the screen, with a scalloped lower edge at about y = `base`. */
function cloudDeck(base: number, fill: string, opacity: number, seed: number): string {
  const random = seeded(seed);
  let bumps = '';
  for (let x = -260; x <= 1860; x += 110 + random() * 60) {
    const r = 70 + random() * 70;
    bumps += `<circle cx="${x.toFixed(0)}" cy="${(base - r * 0.35 + random() * 30).toFixed(0)}" r="${r.toFixed(0)}"/>`;
  }
  return `<g fill="${fill}" opacity="${opacity}"><rect x="-300" y="-100" width="2200" height="${base + 100}"/>${bumps}</g>`;
}

/** A small deterministic random number generator, so the stars and cloud edges are the same on every load. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A tiled layer of rain or snow that falls. The tile is an SVG drawn in `width` × `height` units. */
function precipitation(className: string, width: number, height: number, tile: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${tile}</svg>`;
  return `<div class="bg-precip ${className}" style="background-image:url('data:image/svg+xml,${encodeURIComponent(svg)}')"></div>`;
}

/** Rain streaks slanted along the tile's diagonal, which is the direction the layer falls. */
function rainTile(count: number, opacity: number, seed: number): string {
  const random = seeded(seed);
  let lines = '';
  for (let i = 0; i < count; i++) {
    const x = random() * 60;
    const y = random() * 240;
    const length = 22 + random() * 16;
    // Slope 60:240, the tile's diagonal.
    for (const shift of [0, -60, 60]) {
      for (const lift of [0, -240, 240]) {
        const x1 = x + shift;
        const y1 = y + lift;
        lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x1 - length / 4).toFixed(1)}" y2="${(y1 + length).toFixed(1)}"/>`;
      }
    }
  }
  return `<g stroke="${BOLT}" stroke-width="2.4" stroke-linecap="round" opacity="${opacity}">${lines}</g>`;
}

function snowTile(count: number, size: number, opacity: number, seed: number): string {
  const random = seeded(seed);
  let flakes = '';
  for (let i = 0; i < count; i++) {
    const x = random() * 200;
    const y = random() * 200;
    const r = size * (0.6 + random() * 0.6);
    // Repeated across the tile's edges, so flakes at a border are not cut in half.
    for (const dx of [0, -200, 200]) {
      for (const dy of [0, -200, 200]) {
        flakes += `<circle cx="${(x + dx).toFixed(1)}" cy="${(y + dy).toFixed(1)}" r="${r.toFixed(1)}"/>`;
      }
    }
  }
  return `<g fill="${PAPER}" opacity="${opacity}">${flakes}</g>`;
}

function stars(count: number, seed: number): string {
  const random = seeded(seed);
  let dots = '';
  for (let i = 0; i < count; i++) {
    const x = random() * 1600;
    // Thinner towards the horizon.
    const y = random() ** 1.4 * 820;
    const r = 0.9 + random() * 1.8;
    const opacity = 0.25 + random() * 0.55;
    dots += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" opacity="${opacity.toFixed(2)}"/>`;
  }
  return `<g fill="${PAPER}">${dots}</g>`;
}

/** A soft horizontal band of fog, fading out at its edges. */
function fogBand(id: string, cx: number, cy: number, rx: number, ry: number): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id})"/>`;
}

/** A wind streamline that ends in a curl. */
function gust(y: number, startX: number, length: number, rise: number): string {
  const end = startX + length;
  return (
    `<path d="M ${startX} ${y} C ${startX + length * 0.3} ${y - rise}, ${startX + length * 0.6} ${y + rise}, ${end} ${y} ` +
    `c 40 -8, 70 -40, 46 -70 c -18 -22, -56 -12, -50 18"/>`
  );
}

const SCENES: Record<BackgroundScene, () => string> = {
  neutral: () => '',

  'clear-day': () =>
    layer(
      'bg-static',
      '<circle cx="1390" cy="250" r="430" fill="url(#bg-clear-day-glow)"/>' +
        '<circle cx="1390" cy="250" r="96" fill="url(#bg-clear-day-sun)"/>',
      '<radialGradient id="bg-clear-day-glow"><stop offset="0" stop-color="#ffd98a" stop-opacity="0.32"/>' +
        '<stop offset="0.35" stop-color="#ffd98a" stop-opacity="0.1"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="bg-clear-day-sun"><stop offset="0" stop-color="#fff3cf"/><stop offset="0.75" stop-color="#f8d98c"/>' +
        '<stop offset="1" stop-color="#f1c56a"/></radialGradient>',
    ) +
    layer('bg-drift-slow', cloud(260, 720, 420, PAPER, 0.08) + cloud(1240, 800, 340, PAPER, 0.07)),

  'clear-night': () =>
    layer(
      'bg-static',
      stars(110, 7) +
        '<circle cx="1400" cy="220" r="260" fill="url(#bg-clear-night-glow)"/>' +
        '<circle cx="1400" cy="220" r="72" fill="#efe8d6" mask="url(#bg-clear-night-crescent)"/>',
      '<radialGradient id="bg-clear-night-glow"><stop offset="0" stop-color="#cfd9ff" stop-opacity="0.16"/>' +
        '<stop offset="1" stop-color="#cfd9ff" stop-opacity="0"/></radialGradient>' +
        '<mask id="bg-clear-night-crescent"><rect width="1600" height="900" fill="#fff"/>' +
        '<circle cx="1432" cy="198" r="64" fill="#000"/></mask>',
    ),

  cloudy: () =>
    layer('bg-drift-slow', cloud(260, 300, 760, '#4a576c', 0.55) + cloud(1300, 250, 860, '#4a576c', 0.5) + cloud(820, 130, 600, '#55627a', 0.4)) +
    layer('bg-drift-fast', cloud(420, 640, 560, '#5d6a80', 0.28) + cloud(1380, 700, 600, '#5d6a80', 0.26)),

  rain: () =>
    layer('bg-drift-slow', cloudDeck(210, '#374459', 0.6, 11) + cloudDeck(150, '#2b3748', 0.95, 12)) +
    precipitation('bg-rain', 60, 240, rainTile(3, 0.3, 21)),

  thunderstorm: () =>
    // A still bolt, dim and off to the side, coming out of the clouds: no flashes, which would look like an alarm
    // (and can trigger seizures).
    layer(
      'bg-static',
      `<path d="M 262 160 L 182 410 L 236 410 L 170 600 L 318 360 L 258 360 L 312 160 Z" fill="${BOLT}" opacity="0.38"/>`,
    ) +
    layer('bg-drift-slow', cloudDeck(250, '#3a3358', 0.6, 31) + cloudDeck(190, '#29233f', 0.97, 32)) +
    precipitation('bg-rain bg-rain--heavy', 60, 240, rainTile(5, 0.26, 41)),

  fog: () => {
    const gradient = (id: string) =>
      `<radialGradient id="${id}"><stop offset="0" stop-color="#c3ccd4" stop-opacity="0.14"/>` +
      `<stop offset="0.6" stop-color="#c3ccd4" stop-opacity="0.08"/><stop offset="1" stop-color="#c3ccd4" stop-opacity="0"/></radialGradient>`;
    return (
      layer(
        'bg-drift-slow',
        fogBand('bg-fog-a', 420, 280, 760, 90) + fogBand('bg-fog-a', 1250, 560, 820, 110) + fogBand('bg-fog-a', 300, 820, 900, 100),
        gradient('bg-fog-a'),
      ) +
      layer('bg-drift-fast', fogBand('bg-fog-b', 1200, 180, 700, 80) + fogBand('bg-fog-b', 560, 640, 760, 90), gradient('bg-fog-b'))
    );
  },

  snow: () =>
    layer('bg-drift-slow', cloudDeck(110, '#3c4d6a', 0.55, 51)) +
    precipitation('bg-snow bg-snow--far', 200, 200, snowTile(16, 2.2, 0.35, 61)) +
    precipitation('bg-snow bg-snow--near', 200, 200, snowTile(7, 3.6, 0.5, 62)),

  wind: () =>
    layer('bg-drift-slow', cloud(300, 260, 420, '#3e6676', 0.4) + cloud(1320, 200, 360, '#3e6676', 0.35)) +
    layer(
      'bg-drift-wind',
      `<g fill="none" stroke="${PAPER}" stroke-width="4" stroke-linecap="round" opacity="0.16">` +
        gust(170, -120, 820, 40) +
        gust(330, 760, 700, 50) +
        gust(640, -60, 640, 36) +
        gust(790, 820, 760, 44) +
        '</g>',
    ),
};

/** The layers for a scene, as markup for the backdrop. Neutral is the sky alone. */
export function sceneArt(scene: BackgroundScene): string {
  return SCENES[scene]();
}
