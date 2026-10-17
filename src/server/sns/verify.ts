import { createPublicKey, createVerify, X509Certificate, type KeyObject } from 'node:crypto';

/** NOAA's public topic announcing every new object in the noaa-goes19 bucket. */
export const NOAA_GOES19_TOPIC_ARN = 'arn:aws:sns:us-east-1:123901341784:NewGOES19Object';

export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: '1' | '2';
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

export class SnsVerificationError extends Error {}

/** Signing certificates are only accepted over HTTPS from an SNS endpoint, never from anywhere a message names. */
const CERT_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/[A-Za-z0-9._/-]+\.pem$/;

/** Field order and contents of the string to sign, per AWS's SNS signature documentation. */
const SIGNED_FIELDS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
} as const;

export function stringToSign(message: SnsMessage): string {
  const fields = SIGNED_FIELDS[message.Type];
  if (!fields) throw new SnsVerificationError(`Unknown SNS message type "${message.Type}"`);
  let text = '';
  for (const field of fields) {
    const value = message[field];
    if (value === undefined) {
      if (field === 'Subject') continue; // Subject is signed only when present
      throw new SnsVerificationError(`SNS message has no ${field}`);
    }
    text += `${field}\n${value}\n`;
  }
  return text;
}

export type FetchCertificate = (url: string) => Promise<string>;

export interface VerifyOptions {
  /** The only topic accepted. Defaults to NOAA's GOES-19 topic. */
  topicArn?: string;
  /** Downloads a PEM certificate. Defaults to fetch over HTTPS. */
  fetchCertificate?: FetchCertificate;
  /** Reject messages older than this many milliseconds (replay guard). Default 1 hour. */
  maxAgeMs?: number;
  nowMs?: number;
}

const keyCache = new Map<string, Promise<KeyObject>>();

async function defaultFetchCertificate(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new SnsVerificationError(`Signing certificate download failed: ${response.status}`);
  return response.text();
}

function publicKeyFrom(pem: string): KeyObject {
  // A real SNS certificate yields its public key; tests may hand over a bare public key.
  return pem.includes('BEGIN CERTIFICATE') ? new X509Certificate(pem).publicKey : createPublicKey(pem);
}

/**
 * The same message whether it came as an SNS HTTP POST or as the `Sns` object of a Lambda event (forwarded by the
 * relay, ADR 0004). Lambda spells SigningCertURL as SigningCertUrl and sends Subject as null when there is none.
 * Only the fields that SNS signs, or that verification needs, are kept.
 */
export function normalizeSnsMessage(body: Record<string, unknown>): SnsMessage {
  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = body[name];
      if (typeof value === 'string') return value;
    }
    return undefined;
  };
  const message = {
    Type: pick('Type'),
    MessageId: pick('MessageId'),
    TopicArn: pick('TopicArn'),
    Message: pick('Message'),
    Timestamp: pick('Timestamp'),
    SignatureVersion: pick('SignatureVersion'),
    Signature: pick('Signature'),
    SigningCertURL: pick('SigningCertURL', 'SigningCertUrl'),
    Subject: pick('Subject'),
    SubscribeURL: pick('SubscribeURL', 'SubscribeUrl'),
    Token: pick('Token'),
  };
  for (const key of Object.keys(message) as (keyof typeof message)[]) if (message[key] === undefined) delete message[key];
  return message as SnsMessage;
}

/**
 * Checks that a parsed request body is a genuine SNS message from the expected topic. Throws SnsVerificationError
 * otherwise. Nothing in an unverified message is trusted or acted on.
 */
export async function verifySnsMessage(body: unknown, options: VerifyOptions = {}): Promise<SnsMessage> {
  if (typeof body !== 'object' || body === null) throw new SnsVerificationError('Body is not an SNS message');
  const message = normalizeSnsMessage(body as Record<string, unknown>);
  for (const field of ['Type', 'MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'] as const) {
    if (typeof message[field] !== 'string') throw new SnsVerificationError(`SNS message has no ${field}`);
  }

  const topicArn = options.topicArn ?? NOAA_GOES19_TOPIC_ARN;
  if (message.TopicArn !== topicArn) throw new SnsVerificationError(`Unexpected topic ${message.TopicArn}`);
  if (!CERT_URL.test(message.SigningCertURL)) throw new SnsVerificationError('Signing certificate is not on an SNS endpoint');

  const algorithm = message.SignatureVersion === '1' ? 'RSA-SHA1' : message.SignatureVersion === '2' ? 'RSA-SHA256' : undefined;
  if (!algorithm) throw new SnsVerificationError(`Unsupported SignatureVersion ${message.SignatureVersion}`);

  const age = (options.nowMs ?? Date.now()) - Date.parse(message.Timestamp);
  if (!(age <= (options.maxAgeMs ?? 3_600_000))) throw new SnsVerificationError('SNS message is too old or has a bad timestamp');

  const fetchCertificate = options.fetchCertificate ?? defaultFetchCertificate;
  let key = keyCache.get(message.SigningCertURL);
  if (!key) {
    key = fetchCertificate(message.SigningCertURL).then(publicKeyFrom);
    keyCache.set(message.SigningCertURL, key);
    key.catch(() => keyCache.delete(message.SigningCertURL));
  }

  const verifier = createVerify(algorithm);
  verifier.update(stringToSign(message), 'utf8');
  if (!verifier.verify(await key, message.Signature, 'base64')) throw new SnsVerificationError('SNS signature does not match');
  return message;
}

/** Test hook: forget cached signing keys. */
export function clearSigningKeyCache(): void {
  keyCache.clear();
}
