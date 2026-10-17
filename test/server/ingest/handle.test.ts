import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { glmKeysFromS3Event, handleSnsRequest, resetPurgeClock, type IngestDeps } from '../../../src/server/ingest/handle.js';
import { NOAA_GOES19_TOPIC_ARN, SnsVerificationError, type SnsMessage } from '../../../src/server/sns/verify.js';
import { MemoryTableStore } from '../../../src/server/strikes/store.js';

const NAME = 'OR_GLM-L2-LCFA_G19_s20261962021200_e20261962021400_c20261962021423.nc';
const KEY = `GLM-L2-LCFA/2026/196/20/${NAME}`;
const fixture = new Uint8Array(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'glm', NAME)));

function s3Event(...keys: [bucket: string, key: string][]): string {
  return JSON.stringify({ Records: keys.map(([bucket, key]) => ({ eventName: 'ObjectCreated:Put', s3: { bucket: { name: bucket }, object: { key } } })) });
}

function message(fields: Partial<SnsMessage>): SnsMessage {
  return {
    Type: 'Notification',
    MessageId: 'id',
    TopicArn: NOAA_GOES19_TOPIC_ARN,
    Message: '',
    Timestamp: '2026-07-15T20:21:45.000Z',
    SignatureVersion: '2',
    Signature: 'sig',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/c.pem',
    ...fields,
  };
}

function deps(overrides: Partial<IngestDeps> = {}) {
  const fetched: string[] = [];
  const confirmed: string[] = [];
  const store = new MemoryTableStore();
  const d: IngestDeps = {
    store,
    verify: async (body) => body as SnsMessage, // signatures are tested in verify.test.ts
    fetchObject: async (key) => (fetched.push(key), fixture),
    confirmSubscription: async (url) => void confirmed.push(url),
    now: () => Date.UTC(2026, 6, 15, 20, 22),
    log: () => {},
    ...overrides,
  };
  return { d, store, fetched, confirmed };
}

beforeEach(() => resetPurgeClock());

describe('glmKeysFromS3Event', () => {
  it('keeps GLM-L2-LCFA files from the GOES-19 bucket only', () => {
    expect(
      glmKeysFromS3Event(s3Event(['noaa-goes19', KEY], ['noaa-goes19', 'ABI-L2-CMIPF/2026/196/20/x.nc'], ['other-bucket', KEY])),
    ).toEqual([KEY]);
  });

  it('ignores anything that is not an S3 event', () => {
    expect(glmKeysFromS3Event('not json')).toEqual([]);
    expect(glmKeysFromS3Event('{"Event":"s3:TestEvent"}')).toEqual([]);
  });
});

describe('handleSnsRequest', () => {
  it('stores the flashes of an announced GLM file', async () => {
    const { d, store, fetched } = deps();
    const result = await handleSnsRequest(message({ Message: s3Event(['noaa-goes19', KEY]) }), d);

    expect(result).toEqual({ status: 200, detail: 'stored 297 flashes' });
    expect(fetched).toEqual([KEY]);
    expect(await store.latestFileEnd()).toBe(Date.UTC(2026, 6, 15, 20, 21, 40));
  });

  it('answers 200 without downloading anything for other files', async () => {
    const { d, fetched } = deps();
    const result = await handleSnsRequest(message({ Message: s3Event(['noaa-goes19', 'ABI-L1b-RadF/2026/196/20/x.nc']) }), d);

    expect(result.status).toBe(200);
    expect(fetched).toEqual([]);
  });

  it('confirms a subscription only through an SNS confirmation link', async () => {
    const good = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t';
    const { d, confirmed } = deps();

    expect((await handleSnsRequest(message({ Type: 'SubscriptionConfirmation', SubscribeURL: good }), d)).status).toBe(200);
    expect((await handleSnsRequest(message({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://evil.example/?Action=ConfirmSubscription&' }), d)).status).toBe(400);
    expect(confirmed).toEqual([good]);
  });

  it('answers 403 to anything that fails verification, and does nothing else', async () => {
    const { d, fetched } = deps({ verify: async () => { throw new SnsVerificationError('bad signature'); } });
    const result = await handleSnsRequest(message({ Message: s3Event(['noaa-goes19', KEY]) }), d);

    expect(result.status).toBe(403);
    expect(fetched).toEqual([]);
  });

  it('lets a failed download surface, so SNS retries', async () => {
    const { d } = deps({ fetchObject: async () => { throw new Error('503'); } });
    await expect(handleSnsRequest(message({ Message: s3Event(['noaa-goes19', KEY]) }), d)).rejects.toThrow('503');
  });
});
