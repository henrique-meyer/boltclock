import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';

/** Bump this with the `?v=` on the favicon and share URLs when the bolt artwork changes. */
const ICON_VERSION = 'v=yellow';

const PAGES = ['index.html', 'location.html'] as const;

function page(name: (typeof PAGES)[number]): string {
  return readFileSync(new URL(`../../src/client/${name}`, import.meta.url), 'utf8');
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('favicon and share image', () => {
  it('puts a cache-buster on every favicon and share URL in both pages', () => {
    for (const name of PAGES) {
      const html = page(name);
      expect(html, name).toContain(`href="/favicon.ico?${ICON_VERSION}"`);
      expect(html, name).toContain(`href="/assets/logo.png?${ICON_VERSION}"`);
      expect(html, name).toContain(`href="/assets/logo.svg?${ICON_VERSION}"`);
      expect(html, name).toContain(`content="__PUBLIC_BASE_URL__/assets/logo.png?${ICON_VERSION}"`);
      expect(html, name).not.toMatch(/href="\/favicon\.ico"/);
      expect(html, name).not.toMatch(/href="\/assets\/logo\.(png|svg)"/);
      expect(html, name).not.toMatch(/content="__PUBLIC_BASE_URL__\/assets\/logo\.png"/);
    }
    expect(page('index.html')).toContain(`"image": "__PUBLIC_BASE_URL__/assets/logo.png?${ICON_VERSION}"`);
  });

  it('serves the icon at /favicon.ico and the versioned brand URLs', async () => {
    app = await buildApp({ assetsDir: resolve('assets') });

    const ico = await app.inject({ method: 'GET', url: `/favicon.ico?${ICON_VERSION}` });
    expect(ico.statusCode).toBe(200);
    expect(ico.headers['content-type']).toMatch(/icon/);
    expect(ico.headers['cache-control']).toBe('no-cache');
    expect(ico.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));

    for (const url of [`/assets/logo.png?${ICON_VERSION}`, `/assets/logo.svg?${ICON_VERSION}`, `/assets/favicon.ico?${ICON_VERSION}`]) {
      const asset = await app.inject({ method: 'GET', url });
      expect(asset.statusCode, url).toBe(200);
    }
  });
});
