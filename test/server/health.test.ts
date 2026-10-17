import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';

let app: FastifyInstance | undefined;
const tempDirs: string[] = [];

function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'boltclock-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('GET /health', () => {
  it('answers 200 with {"status":"ok"}', async () => {
    app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('static files', () => {
  it('serves the built client at / and the brand files under /assets/', async () => {
    app = await buildApp({
      clientDir: tempDir({ 'index.html': '<h1>BoltClock</h1>' }),
      assetsDir: tempDir({ 'logo.svg': '<svg/>' }),
    });

    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('BoltClock');

    const logo = await app.inject({ method: 'GET', url: '/assets/logo.svg' });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toMatch(/^image\/svg\+xml/);
  });

  it('serves the client bundles next to the brand files', async () => {
    const clientDir = tempDir({ 'index.html': '<h1>BoltClock</h1>' });
    mkdirSync(join(clientDir, 'static'));
    writeFileSync(join(clientDir, 'static', 'index.js'), 'console.log(1)');
    app = await buildApp({ clientDir, assetsDir: tempDir({ 'logo.svg': '<svg/>' }) });

    const bundle = await app.inject({ method: 'GET', url: '/static/index.js' });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers['content-type']).toMatch(/javascript/);
  });

  it('serves the location picker at /location and redirects the old .html address there', async () => {
    app = await buildApp({ clientDir: tempDir({ 'index.html': '<h1>BoltClock</h1>', 'location.html': '<h1>Location</h1>' }) });

    const page = await app.inject({ method: 'GET', url: '/location' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.body).toContain('Location');

    const old = await app.inject({ method: 'GET', url: '/location.html' });
    expect(old.statusCode).toBe(301);
    expect(old.headers.location).toBe('/location');

    const withQuery = await app.inject({ method: 'GET', url: '/location.html?from=bookmark' });
    expect(withQuery.headers.location).toBe('/location?from=bookmark');
  });

  it('keeps /health when the client is served at /', async () => {
    app = await buildApp({ clientDir: tempDir({ 'index.html': '<h1>BoltClock</h1>' }) });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('skips a client directory that does not exist', async () => {
    app = await buildApp({ clientDir: join(tmpdir(), 'boltclock-missing-client') });
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(404);
  });
});
