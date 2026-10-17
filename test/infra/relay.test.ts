import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Runs the exact inline code from the CloudFormation template, so the tested code is the deployed code.
const template = readFileSync(join(import.meta.dirname, '..', '..', 'infra', 'aws', 'relay.yaml'), 'utf8');

function relayCode(): string {
  const lines = template.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === 'ZipFile: |');
  if (start < 0) throw new Error('relay.yaml has no inline ZipFile code');
  const indent = /^\s*/.exec(lines[start + 1]!)![0].length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && /^\s*/.exec(line)![0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

type Handler = (event: unknown) => Promise<void>;

function loadRelay(fetch: (url: string, init: RequestInit) => Promise<{ status: number }>) {
  const module = { exports: {} as { handler?: Handler } };
  const warnings: string[] = [];
  runInNewContext(relayCode(), {
    exports: module.exports,
    module,
    process: { env: { TARGET_URL: 'https://ingest.example/api/glm' } },
    fetch,
    AbortSignal,
    console: { warn: (m: string) => warnings.push(m) },
  });
  return { handler: module.exports.handler!, warnings };
}

const record = (id: string) => ({ EventSource: 'aws:sns', Sns: { Type: 'Notification', MessageId: id, Signature: 'sig', SigningCertUrl: 'https://sns.us-east-1.amazonaws.com/c.pem', Message: '{}' } });

describe('relay Lambda (inline code in infra/aws/relay.yaml)', () => {
  it('posts each SNS record, unchanged, to the ingest URL', async () => {
    const fetch = vi.fn(async () => ({ status: 200 }));
    const { handler } = loadRelay(fetch);

    await handler({ Records: [record('a'), record('b')] });

    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ingest.example/api/glm');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(record('a').Sns);
  });

  it('throws on a server error or throttling, so Lambda retries', async () => {
    for (const status of [500, 503, 429]) {
      const { handler } = loadRelay(async () => ({ status }));
      await expect(handler({ Records: [record('a')] })).rejects.toThrow(String(status));
    }
  });

  it('does not retry a message the receiver refused', async () => {
    const { handler, warnings } = loadRelay(async () => ({ status: 403 }));

    await expect(handler({ Records: [record('a')] })).resolves.toBeUndefined();
    expect(warnings[0]).toMatch(/refused a: 403/);
  });

  it('accepts an event without records', async () => {
    const fetch = vi.fn(async () => ({ status: 200 }));
    await loadRelay(fetch).handler({});
    expect(fetch).not.toHaveBeenCalled();
  });
});
