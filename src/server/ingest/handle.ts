import { parseGlmFileName } from '../glm/filename.js';
import { parseGlm } from '../glm/parse.js';
import { SnsVerificationError, type SnsMessage } from '../sns/verify.js';
import { purgeOldTables, storeGlmFile, type TableStore } from '../strikes/store.js';

export const GLM_BUCKET = 'noaa-goes19';
const GLM_KEY = /^GLM-L2-LCFA\/\d{4}\/\d{3}\/\d{2}\/OR_GLM-L2-LCFA_G19_s\d{14}_e\d{14}_c\d{14}\.nc$/;
const CONFIRM_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\/\?Action=ConfirmSubscription&/;
const PURGE_EVERY_MS = 5 * 60_000;

export interface IngestDeps {
  store: TableStore;
  verify: (body: unknown) => Promise<SnsMessage>;
  /** Downloads one object from the GLM bucket. */
  fetchObject: (key: string) => Promise<Uint8Array>;
  /** Visits a SubscribeURL to confirm the subscription. */
  confirmSubscription: (url: string) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

export interface IngestResult {
  status: number;
  detail: string;
}

let lastPurgeMs = 0;

/** Test hook. */
export function resetPurgeClock(): void {
  lastPurgeMs = 0;
}

/** GLM keys in an S3 event notification (the Message of a NewGOES19Object notification). Others are ignored. */
export function glmKeysFromS3Event(message: string): string[] {
  let event: unknown;
  try {
    event = JSON.parse(message);
  } catch {
    return [];
  }
  const records = (event as { Records?: unknown }).Records;
  if (!Array.isArray(records)) return [];
  const keys: string[] = [];
  for (const record of records) {
    const s3 = (record as { s3?: { bucket?: { name?: unknown }; object?: { key?: unknown } } }).s3;
    if (s3?.bucket?.name !== GLM_BUCKET || typeof s3.object?.key !== 'string') continue;
    const key = decodeURIComponent(s3.object.key.replace(/\+/g, ' '));
    if (GLM_KEY.test(key)) keys.push(key);
  }
  return keys;
}

/** Handles one HTTP request from SNS. 2xx tells SNS the delivery succeeded; any other status makes it retry. */
export async function handleSnsRequest(body: unknown, deps: IngestDeps): Promise<IngestResult> {
  let message: SnsMessage;
  try {
    message = await deps.verify(body);
  } catch (error) {
    if (error instanceof SnsVerificationError) {
      deps.log(`Rejected a request that is not a valid NOAA SNS message: ${error.message}`);
      return { status: 403, detail: 'not a valid SNS message' };
    }
    throw error;
  }

  if (message.Type === 'SubscriptionConfirmation') {
    if (!message.SubscribeURL || !CONFIRM_URL.test(message.SubscribeURL)) {
      return { status: 400, detail: 'SubscribeURL is not an SNS confirmation link' };
    }
    await deps.confirmSubscription(message.SubscribeURL);
    deps.log(`Confirmed the SNS subscription to ${message.TopicArn}`);
    return { status: 200, detail: 'subscription confirmed' };
  }
  if (message.Type === 'UnsubscribeConfirmation') return { status: 200, detail: 'unsubscribe noted' };

  const keys = glmKeysFromS3Event(message.Message);
  let rows = 0;
  let newestEndMs = 0;
  for (const key of keys) {
    const glm = await parseGlm(await deps.fetchObject(key));
    const stored = await storeGlmFile(deps.store, glm);
    rows += stored.rows;
    newestEndMs = Math.max(newestEndMs, parseGlmFileName(key).endMs);
  }

  const nowMs = deps.now();
  if (keys.length > 0 && nowMs - lastPurgeMs >= PURGE_EVERY_MS) {
    lastPurgeMs = nowMs;
    const deleted = await purgeOldTables(deps.store, nowMs);
    if (deleted.length) deps.log(`Deleted expired flash tables: ${deleted.join(', ')}`);
  }

  if (keys.length) {
    deps.log(`Stored ${rows} flashes from ${keys.length} file(s), latency ${Math.round((nowMs - newestEndMs) / 1000)} s`);
  }
  return { status: 200, detail: keys.length ? `stored ${rows} flashes` : 'not a GLM file' };
}
