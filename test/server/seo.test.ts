import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { BASE_URL_PLACEHOLDER, fillBaseUrl, robotsTxt, sitemapXml } from '../../src/server/seo.js';

const BASE = 'https://your-domain.example';
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function clientDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'boltclock-seo-'));
  writeFileSync(join(dir, 'index.html'), `<link rel="canonical" href="${BASE_URL_PLACEHOLDER}/"><meta property="og:image" content="${BASE_URL_PLACEHOLDER}/assets/logo.png">`);
  writeFileSync(join(dir, 'location.html'), `<link rel="canonical" href="${BASE_URL_PLACEHOLDER}/location">`);
  return dir;
}

describe('SEO', () => {
  it('fills every placeholder with the base URL', () => {
    expect(fillBaseUrl(`${BASE_URL_PLACEHOLDER}/ and ${BASE_URL_PLACEHOLDER}/location`, BASE)).toBe(`${BASE}/ and ${BASE}/location`);
  });

  it('allows everything but the API, and points to the sitemap', () => {
    expect(robotsTxt(BASE)).toBe(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${BASE}/sitemap.xml\n`);
  });

  it('lists the display and the picker in the sitemap', () => {
    const xml = sitemapXml(BASE);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${BASE}/</loc>`);
    expect(xml).toContain(`<loc>${BASE}/location</loc>`);
    expect(sitemapXml('https://a.example/?x=1&y=2')).toContain('&amp;');
  });

  it('serves the pages with absolute URLs from PUBLIC_BASE_URL, and robots and the sitemap', async () => {
    app = await buildApp({ clientDir: clientDir(), publicBaseUrl: `${BASE}/` });

    for (const url of ['/', '/index.html', '/?lat=28.5&lon=-81.3']) {
      const page = await app.inject({ method: 'GET', url });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toMatch(/^text\/html/);
      expect(page.body).toContain(`<link rel="canonical" href="${BASE}/">`);
      expect(page.body).toContain(`${BASE}/assets/logo.png`);
      expect(page.body).not.toContain(BASE_URL_PLACEHOLDER);
    }
    const picker = await app.inject({ method: 'GET', url: '/location' });
    expect(picker.body).toContain(`href="${BASE}/location"`);

    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.headers['content-type']).toMatch(/^text\/plain/);
    expect(robots.body).toContain(`Sitemap: ${BASE}/sitemap.xml`);
    const sitemap = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(sitemap.headers['content-type']).toMatch(/xml/);
    expect(sitemap.body).toContain(`<loc>${BASE}/location</loc>`);
  });

  it('keeps robots and the sitemap without a built client', async () => {
    app = await buildApp({ publicBaseUrl: BASE });
    expect((await app.inject({ method: 'GET', url: '/robots.txt' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/sitemap.xml' })).statusCode).toBe(200);
  });
});
