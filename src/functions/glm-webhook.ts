import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { GLM_BUCKET, handleSnsRequest } from '../server/ingest/handle.js';
import { verifySnsMessage } from '../server/sns/verify.js';
import { AzureTableStore } from '../server/strikes/azure-store.js';

// NOAA's SNS topic posts here for every new GOES-19 object; the subscription filter passes only GLM-L2-LCFA keys.
// The endpoint is anonymous on purpose: every request is checked against SNS's signature, and anything else gets 403.

const endpoint = process.env.STRIKES_TABLE_ENDPOINT;
if (!endpoint) throw new Error('STRIKES_TABLE_ENDPOINT is not set');
const store = new AzureTableStore(endpoint, new DefaultAzureCredential());

async function fetchObject(key: string): Promise<Uint8Array> {
  const url = `https://${GLM_BUCKET}.s3.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GET ${key} failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function confirmSubscription(url: string): Promise<void> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Subscription confirmation failed: ${response.status}`);
}

export async function glmWebhook(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return { status: 400, body: 'expected an SNS JSON message' };
  }

  try {
    const result = await handleSnsRequest(body, {
      store,
      verify: (b) => verifySnsMessage(b),
      fetchObject,
      confirmSubscription,
      now: Date.now,
      log: (m) => context.log(m),
    });
    return { status: result.status, body: result.detail };
  } catch (error) {
    // 5xx makes SNS retry the delivery, which suits a failed download or a throttled write.
    context.error(`GLM ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 500, body: 'ingest failed' };
  }
}

app.http('glm', { methods: ['POST'], authLevel: 'anonymous', handler: glmWebhook });
