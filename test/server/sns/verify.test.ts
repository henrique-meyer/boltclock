import { createSign, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSigningKeyCache,
  NOAA_GOES19_TOPIC_ARN,
  SnsVerificationError,
  stringToSign,
  verifySnsMessage,
  type SnsMessage,
} from '../../../src/server/sns/verify.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000000000000000000000.pem';
const NOW = Date.parse('2026-10-17T15:00:05.000Z');

function signed(fields: Partial<SnsMessage>, version: '1' | '2' = '2'): SnsMessage {
  const message: SnsMessage = {
    Type: 'Notification',
    MessageId: '4d4dc071-ddbf-465d-bba8-08f81c89da64',
    TopicArn: NOAA_GOES19_TOPIC_ARN,
    Message: '{"Records":[]}',
    Timestamp: '2026-10-17T15:00:00.000Z',
    SignatureVersion: version,
    Signature: '',
    SigningCertURL: CERT_URL,
    ...fields,
  };
  const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
  signer.update(stringToSign(message), 'utf8');
  return { ...message, Signature: signer.sign(privateKey, 'base64') };
}

const options = { fetchCertificate: async () => publicPem, nowMs: NOW };

beforeEach(() => clearSigningKeyCache());

describe('stringToSign', () => {
  it('follows the documented order and includes Subject only when present', () => {
    const base = signed({});
    expect(stringToSign(base)).toBe(
      `Message\n{"Records":[]}\nMessageId\n${base.MessageId}\nTimestamp\n${base.Timestamp}\nTopicArn\n${NOAA_GOES19_TOPIC_ARN}\nType\nNotification\n`,
    );
    expect(stringToSign({ ...base, Subject: 'Hi' })).toContain('MessageId\n4d4dc071-ddbf-465d-bba8-08f81c89da64\nSubject\nHi\nTimestamp');
  });

  it('signs SubscribeURL and Token for confirmations', () => {
    const text = stringToSign(signed({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&x', Token: 't' }));
    expect(text).toMatch(/SubscribeURL\nhttps:\/\/sns[^\n]+\nTimestamp\n[^\n]+\nToken\nt\nTopicArn/);
  });
});

describe('verifySnsMessage', () => {
  it('accepts a correctly signed message (SHA256 and SHA1)', async () => {
    await expect(verifySnsMessage(signed({}, '2'), options)).resolves.toMatchObject({ Type: 'Notification' });
    await expect(verifySnsMessage(signed({}, '1'), options)).resolves.toMatchObject({ Type: 'Notification' });
  });

  it('rejects a changed message', async () => {
    const message = { ...signed({}), Message: '{"Records":[{"s3":{}}]}' };
    await expect(verifySnsMessage(message, options)).rejects.toThrow(/signature does not match/);
  });

  it('rejects other topics, even when signed', async () => {
    await expect(verifySnsMessage(signed({ TopicArn: 'arn:aws:sns:us-east-1:111111111111:Other' }), options)).rejects.toThrow(/Unexpected topic/);
  });

  it('never downloads a certificate from outside SNS', async () => {
    let fetched = false;
    const message = signed({ SigningCertURL: 'https://evil.example/cert.pem' });
    await expect(
      verifySnsMessage(message, { ...options, fetchCertificate: async () => ((fetched = true), publicPem) }),
    ).rejects.toThrow(/not on an SNS endpoint/);
    expect(fetched).toBe(false);
  });

  it('rejects look-alike SNS hosts', async () => {
    const message = signed({ SigningCertURL: 'https://sns.us-east-1.amazonaws.com.evil.example/x.pem' });
    await expect(verifySnsMessage(message, options)).rejects.toThrow(/not on an SNS endpoint/);
  });

  it('rejects old messages', async () => {
    await expect(verifySnsMessage(signed({}), { ...options, nowMs: NOW + 2 * 3_600_000 })).rejects.toThrow(/too old/);
  });

  it('accepts the same signed record as the Lambda relay forwards it', async () => {
    // A Lambda event's Sns object: SigningCertUrl instead of SigningCertURL, Subject null, extra unsigned fields.
    const { SigningCertURL, ...rest } = signed({});
    const fromLambda = { ...rest, SigningCertUrl: SigningCertURL, Subject: null, UnsubscribeUrl: 'https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe', MessageAttributes: {} };

    await expect(verifySnsMessage(fromLambda, options)).resolves.toMatchObject({ Type: 'Notification', SigningCertURL });
  });

  it('still rejects a changed record in the Lambda form', async () => {
    const { SigningCertURL, ...rest } = signed({});
    const tampered = { ...rest, SigningCertUrl: SigningCertURL, Subject: null, Message: '{"Records":[1]}' };

    await expect(verifySnsMessage(tampered, options)).rejects.toThrow(/signature does not match/);
  });

  it('rejects bodies that are not SNS messages', async () => {
    await expect(verifySnsMessage({ hello: 'world' }, options)).rejects.toBeInstanceOf(SnsVerificationError);
    await expect(verifySnsMessage(null, options)).rejects.toBeInstanceOf(SnsVerificationError);
  });
});
