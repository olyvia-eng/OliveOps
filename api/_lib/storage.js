import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireEnv } from './env.js';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);
const IMAGE_LIMIT_BYTES = 25 * 1024 * 1024;
const PDF_LIMIT_BYTES = 25 * 1024 * 1024;
const OFFICE_LIMIT_BYTES = 15 * 1024 * 1024;
const CSV_LIMIT_BYTES = 5 * 1024 * 1024;
const DEFAULT_EXPIRES_IN_MS = 10 * 60 * 1000;
const ALLOWED_EXTENSIONS_BY_MIME = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/webp', new Set(['.webp'])],
  ['image/heic', new Set(['.heic'])],
  ['image/heif', new Set(['.heif'])],
  ['application/pdf', new Set(['.pdf'])],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['.docx'])],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Set(['.xlsx'])],
  ['text/csv', new Set(['.csv'])],
]);

function nowIso() {
  return new Date().toISOString();
}

export function sanitizeFilename(fileName) {
  if (typeof fileName !== 'string' || !fileName.trim()) return 'file';

  const trimmed = fileName.trim().replace(/\\/g, '/').replace(/^\.+/, '').replace(/\s+/g, '-');
  const baseName = trimmed.split('/').pop() ?? 'file';
  const lastDot = baseName.lastIndexOf('.');
  const extension = lastDot > -1 ? baseName.slice(lastDot) : '';
  const nameWithoutExtension = lastDot > -1 ? baseName.slice(0, lastDot) : baseName;
  const safeName = nameWithoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'file';

  return `${safeName}${extension}`;
}

export function buildStorageKey({ businessId, fileId, fileName }) {
  const resolvedName = sanitizeFilename(fileName);
  return `${businessId}/${fileId}/${resolvedName}`;
}

export function createPendingUploadPlan({ businessId, fileName, mimeType, sizeBytes, expiresInMs = DEFAULT_EXPIRES_IN_MS }) {
  const fileId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const sanitizedName = sanitizeFilename(fileName);
  const key = buildStorageKey({ businessId, fileId, fileName: sanitizedName });
  const now = Date.now();

  return {
    fileId,
    key,
    objectKey: key,
    fileName: sanitizedName,
    mimeType: normalizeMimeType(mimeType),
    sizeBytes,
    expiresAt: new Date(now + expiresInMs).toISOString(),
    createdAt: nowIso(),
  };
}

export function isPendingUploadExpired(expiresAt) {
  return typeof expiresAt === 'string' && new Date(expiresAt).getTime() <= Date.now();
}

function normalizeMimeType(mimeType) {
  if (typeof mimeType !== 'string') return 'application/octet-stream';
  const trimmed = mimeType.trim().toLowerCase();
  return trimmed || 'application/octet-stream';
}

function getFileExtension(fileName) {
  if (typeof fileName !== 'string') return '';
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot < 0) return '';
  return trimmed.slice(lastDot).toLowerCase();
}

function getMaxSizeForMimeType(mimeType) {
  const normalizedMime = normalizeMimeType(mimeType);
  if (IMAGE_MIME_TYPES.has(normalizedMime)) return IMAGE_LIMIT_BYTES;
  if (normalizedMime === 'application/pdf') return PDF_LIMIT_BYTES;
  if (normalizedMime === 'text/csv') return CSV_LIMIT_BYTES;
  if (DOCUMENT_MIME_TYPES.has(normalizedMime)) return OFFICE_LIMIT_BYTES;
  return IMAGE_LIMIT_BYTES;
}

export function validateUploadPayload({ fileName, mimeType, sizeBytes }) {
  const normalizedMime = normalizeMimeType(mimeType);
  const allowedMimes = new Set([...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES]);
  allowedMimes.add('application/pdf');
  if (!allowedMimes.has(normalizedMime)) {
    return { ok: false, error: 'Unsupported file type.' };
  }

  const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME.get(normalizedMime);
  const fileExtension = getFileExtension(fileName);
  if (allowedExtensions && (!fileExtension || !allowedExtensions.has(fileExtension))) {
    return { ok: false, error: 'File extension does not match the file type.' };
  }

  const safeSize = Number(sizeBytes);
  if (!Number.isFinite(safeSize) || safeSize <= 0) {
    return { ok: false, error: 'Invalid file size.' };
  }

  const maxSize = getMaxSizeForMimeType(normalizedMime);
  if (safeSize > maxSize) {
    const limitLabel = maxSize >= 1024 * 1024 ? `${maxSize / (1024 * 1024)} MB` : `${maxSize} bytes`;
    return { ok: false, error: `File exceeds ${limitLabel} limit.` };
  }

  return { ok: true, fileName: sanitizeFilename(fileName), mimeType: normalizedMime, sizeBytes: safeSize };
}

function getS3Client() {
  const region = requireEnv('AWS_REGION');
  const endpoint = process.env.S3_ENDPOINT;
  const forcePathStyle = Boolean(process.env.S3_FORCE_PATH_STYLE);

  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
      : undefined,
  });
}

function getBucketName() {
  return requireEnv('AWS_S3_BUCKET_NAME');
}

function isStorageKeyScopedToBusiness({ businessId, key }) {
  return typeof key === 'string' && key.startsWith(`${businessId}/`);
}

export async function createPresignedUploadUrl({ businessId, fileName, mimeType, sizeBytes, plan: trustedPlan }) {
  const validation = trustedPlan
    ? { ok: true, fileName: trustedPlan.fileName, mimeType: trustedPlan.mimeType, sizeBytes: trustedPlan.sizeBytes }
    : validateUploadPayload({ fileName, mimeType, sizeBytes });
  if (!validation.ok) return { ok: false, error: validation.error };

  const plan = trustedPlan ?? createPendingUploadPlan({ businessId, fileName: validation.fileName, mimeType: validation.mimeType, sizeBytes: validation.sizeBytes });
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: plan.key,
    ContentType: validation.mimeType,
    ContentLength: validation.sizeBytes,
    ...(plan.writeOnce ? { IfNoneMatch: '*' } : {}),
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 600 });
  return { ok: true, uploadUrl, plan };
}

export async function headStoredFile({ businessId, key }) {
  if (!isStorageKeyScopedToBusiness({ businessId, key })) {
    return { ok: false, status: 403, error: 'Unauthorized storage key.' };
  }

  const client = getS3Client();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: getBucketName(), Key: key }));
    return {
      ok: true,
      contentLength: Number(result.ContentLength ?? 0),
      contentType: typeof result.ContentType === 'string' ? result.ContentType : '',
      etag: typeof result.ETag === 'string' ? result.ETag.replaceAll('"', '') : '',
      checksumSha256: typeof result.ChecksumSHA256 === 'string' ? result.ChecksumSHA256 : '',
    };
  } catch (error) {
    const httpStatusCode = Number(error?.$metadata?.httpStatusCode ?? error?.statusCode ?? 0);
    if (httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') {
      return { ok: false, status: 404, error: 'Stored file not found.' };
    }
    return { ok: false, status: Number.isFinite(httpStatusCode) && httpStatusCode >= 400 ? httpStatusCode : 503, error: 'Stored file could not be verified.' };
  }
}

export async function createPresignedDownloadUrl({ businessId, key }) {
  if (!isStorageKeyScopedToBusiness({ businessId, key })) {
    return { ok: false, error: 'Unauthorized storage key.' };
  }

  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: getBucketName(), Key: key });
  return { ok: true, downloadUrl: await getSignedUrl(client, command, { expiresIn: 600 }) };
}

export async function removeStoredFile({ businessId, key }) {
  if (!isStorageKeyScopedToBusiness({ businessId, key })) {
    return { ok: false, error: 'Unauthorized storage key.' };
  }

  const client = getS3Client();
  const command = new DeleteObjectCommand({ Bucket: getBucketName(), Key: key });
  await client.send(command);
  return { ok: true };
}
