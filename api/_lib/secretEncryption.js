import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { requireEnv } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 1;

function resolveKey(encodedKey, envName = 'GOOGLE_TOKEN_ENCRYPTION_KEY') {
  const value = encodedKey ?? requireEnv(envName);
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error(`${envName} must be a base64-encoded 32-byte key`);
  }
  return key;
}

function buildAdditionalData(context) {
  const { businessId, userId, provider, realmId } = context ?? {};
  if (typeof businessId !== 'string' || !businessId) {
    throw new Error('Credential encryption requires businessId');
  }

  if (provider === undefined || provider === 'google-calendar') {
    if (typeof userId !== 'string' || !userId) throw new Error('Google credential encryption requires userId');
    return Buffer.from(`google-calendar:${businessId}:${userId}`, 'utf8');
  }

  if (typeof provider !== 'string' || !provider || typeof realmId !== 'string' || !realmId) {
    throw new Error('Provider credential encryption requires provider and realmId');
  }

  return Buffer.from(`${provider}:${businessId}:${realmId}`, 'utf8');
}

export function encryptSecret(secret, context, encodedKey, options = {}) {
  if (typeof secret !== 'string' || !secret) {
    throw new Error('Secret must be a non-empty string');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, resolveKey(encodedKey, options.envName), iv);
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

export function decryptSecret(envelope, context, encodedKey, options = {}) {
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
    resolveKey(encodedKey, options.envName),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAAD(buildAdditionalData(context));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}