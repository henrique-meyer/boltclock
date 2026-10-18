import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Search engine basics (BOLT-54; the instructions live in the local SEO.md). The pages' absolute URLs (canonical,
 * Open Graph, structured data) hold this placeholder, filled in from PUBLIC_BASE_URL when the page is served, so no
 * domain is ever written into the repository.
 */
export const BASE_URL_PLACEHOLDER = '__PUBLIC_BASE_URL__';

/** The pages search engines may index. The sitemap lists exactly these. */
export const INDEXED_PATHS = ['/', '/location'] as const;

export interface SeoOptions {
  /** PUBLIC_BASE_URL, without a trailing slash. */
  publicBaseUrl: string;
  /** The built client (dist/client), whose pages carry the placeholder. Without it only robots and sitemap exist. */
  clientDir?: string;
}

export function fillBaseUrl(html: string, publicBaseUrl: string): string {
  return html.replaceAll(BASE_URL_PLACEHOLDER, publicBaseUrl);
}

export function robotsTxt(publicBaseUrl: string): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${publicBaseUrl}/sitemap.xml`, ''].join('\n');
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function sitemapXml(publicBaseUrl: string): string {
  const urls = INDEXED_PATHS.map((path) => `  <url><loc>${escapeXml(`${publicBaseUrl}${path}`)}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join(
    '\n',
  );
}

/** GET /robots.txt and /sitemap.xml; with the built client, the pages themselves with the base URL filled in. */
export function registerSeo(app: FastifyInstance, options: SeoOptions): void {
  const base = options.publicBaseUrl.replace(/\/+$/, '');

  app.get('/robots.txt', async (_request, reply) => reply.type('text/plain; charset=utf-8').send(robotsTxt(base)));
  app.get('/sitemap.xml', async (_request, reply) => reply.type('application/xml; charset=utf-8').send(sitemapXml(base)));

  const clientDir = options.clientDir;
  if (!clientDir) return;
  // The built pages never change while the server runs: read and fill each one once.
  const pages = new Map<string, Promise<string>>();
  const page = (file: string) => {
    let filled = pages.get(file);
    if (!filled) {
      filled = readFile(join(clientDir, file), 'utf8').then((html) => fillBaseUrl(html, base));
      pages.set(file, filled);
    }
    return filled;
  };
  const serve = (file: string) => async (_request: unknown, reply: import('fastify').FastifyReply) =>
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(await page(file));

  app.get('/', serve('index.html'));
  app.get('/index.html', serve('index.html'));
  app.get('/location', serve('location.html'));
}
