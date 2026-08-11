import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { requireEnv } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 1;

function resolveKey(encodedKey) {
  const value = encodedKey ?? requireEnv('GOOGLE_TOKEN_ENCRYPTION_KEY');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

function buildAdditionalData({ businessId, userId }) {
  if (typeof businessId !== 'string' || !businessId || typeof userId !== 'string' || !userId) {
    throw new Error('Credential encryption requires businessId and userId');
  }
  return Buffer.from(`google-calendar:${businessId}:${userId}`, 'utf8');
}

export function encryptSecret(secret, context, encodedKey) {
  if (typeof secret !== 'string' || !secret) {
    throw new Error('Secret must be a non-empty string');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, resolveKey(encodedKey), iv);
  cipher.setAAD(buildAdditionalData(context));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);

  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSecret(envelope, context, encodedKey) {
  if (
    !envelope
    || envelope.version !== ENVELOPE_VERSION
    || envelope.algorithm !== ALGORITHM
    || typeof envelope.iv !== 'string'
    || typeof envelope.authTag !== 'string'
    || typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('Unsupported encrypted secret envelope');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    resolveKey(encodedKey),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAAD(buildAdditionalData(context));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}