import { requireSession } from './_lib/session.js';
import {
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  createPendingUploadPlan,
  headStoredFile,
  removeStoredFile,
  validateUploadPayload,
} from './_lib/storage.js';
import {
  createAuditEventForBusiness,
  createPendingFileForBusiness,
  deleteFileForBusiness,
  getCustomerForBusiness,
  getExpenseForBusiness,
  getFileForBusiness,
  getEstimateForBusiness,
  getJobForBusiness,
  getEmployeeForBusiness,
  getFeedbackForBusiness,
  getTimeEntryForBusiness,
  listFilesForBusiness,
  updateFeedbackForBusiness,
  updateFileForBusiness,
  updateExpenseForBusiness,
  updateTimeEntryForBusiness,
} from './_lib/authRepo.js';
import { authorizeRecordAccess, canReadEntity, canWriteEntity } from './_lib/authorization.js';

const STORAGE_FAILURE_MESSAGE = 'Storage service is temporarily unavailable.';
const DOCUMENT_ENTITY_TYPE = 'document';
const DOCUMENT_ENTITY_ID = 'library';
const DOCUMENT_CATEGORIES = new Set(['contracts', 'proposals', 'permits', 'insurance', 'compliance', 'photos', 'misc']);
const ATTACHMENT_ALLOWLIST = {
  'time-entry': new Set(['clock-in-photo', 'clock-out-photo']),
  expense: new Set(['receipt']),
  document: DOCUMENT_CATEGORIES,
  job: new Set(['document', 'photo', 'misc']),
  customer: new Set(['document', 'photo', 'misc']),
  estimate: new Set(['document', 'photo', 'misc']),
  employee: new Set(['document', 'photo', 'misc']),
  feedback: new Set(['screenshot']),
};

const COMPLETION_ALLOWED_KEYS = new Set(['action', 'fileId', 'checksum', 'etag']);
const DOWNLOAD_ALLOWED_KEYS = new Set(['action', 'fileId']);
const DELETE_ALLOWED_KEYS = new Set(['action', 'fileId']);

function nowIso() {
  return new Date().toISOString();
}

function businessScopedKey(file) {
  return file?.objectKey ?? file?.key ?? '';
}

function isAttachmentEntityType(entityType) {
  return typeof entityType === 'string' && Object.prototype.hasOwnProperty.call(ATTACHMENT_ALLOWLIST, entityType);
}

function normalizeAttachmentCategory(entityType, category) {
  if (!isAttachmentEntityType(entityType)) return null;
  if (typeof category !== 'string') return null;

  const normalized = category.trim().toLowerCase();
  if (!normalized) return null;

  if (entityType === DOCUMENT_ENTITY_TYPE) {
    return DOCUMENT_CATEGORIES.has(normalized) ? normalized : null;
  }

  return ATTACHMENT_ALLOWLIST[entityType].has(normalized) ? normalized : null;
}

function getAttachmentFieldForCategory({ entityType, category }) {
  if (entityType === 'expense') {
    return category === 'receipt' ? 'receiptFileId' : undefined;
  }

  if (entityType === 'time-entry') {
    if (category === 'clock-in-photo') return 'clockInPhotoFileId';
    if (category === 'clock-out-photo') return 'clockOutPhotoFileId';
    return 'photoAttachmentFileId';
  }

  if (entityType === 'feedback') {
    return category === 'screenshot' ? 'screenshotFileId' : undefined;
  }

  return undefined;
}

function parseJsonBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body ?? {};
}

function getSafeStatusCode(error) {
  const fromMetadata = Number(error?.$metadata?.httpStatusCode);
  if (Number.isFinite(fromMetadata) && fromMetadata >= 400 && fromMetadata < 600) {
    return fromMetadata;
  }

  const fromStatusCode = Number(error?.statusCode);
  if (Number.isFinite(fromStatusCode) && fromStatusCode >= 400 && fromStatusCode < 600) {
    return fromStatusCode;
  }

  return 503;
}

function logStorageFailure(action, error) {
  console.error('[storage:failure]', {
    action,
    errorName: error?.name,
    errorMessage: error?.message,
    fileId: error?.fileId ?? undefined,
    businessId: error?.businessId ?? undefined,
    operation: error?.operation ?? undefined,
    httpStatusCode: error?.$metadata?.httpStatusCode ?? error?.statusCode ?? null,
  });
}

function canManageDocuments(role) {
  return role === 'owner' || role === 'admin';
}

function mapAttachmentEntityToAuthorizationEntity(entityType) {
  if (entityType === 'job') return 'jobs';
  if (entityType === 'customer') return 'customers';
  if (entityType === 'estimate') return 'estimates';
  if (entityType === 'employee') return 'employees';
  if (entityType === 'expense') return 'expenses';
  if (entityType === 'time-entry') return 'time-entries';
  if (entityType === 'feedback') return 'feedback';
  return null;
}

function canAccessAttachmentRecord({ session, entityType, entity, accessMode }) {
  if (entityType === DOCUMENT_ENTITY_TYPE) {
    return canManageDocuments(session.role);
  }

  const authorizationEntity = mapAttachmentEntityToAuthorizationEntity(entityType);
  if (!authorizationEntity) {
    return false;
  }

  const hasEntityPermission = accessMode === 'write'
    ? canWriteEntity(authorizationEntity, session.role)
    : canReadEntity(authorizationEntity, session.role);
  if (!hasEntityPermission) {
    return false;
  }

  return authorizeRecordAccess(session, authorizationEntity, entity);
}

function ensureAllowedKeys(body, allowedKeys) {
  const unexpectedKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  return unexpectedKeys.length === 0;
}

function buildPendingFileRecord({ session, plan, entityType, entityId, category, fileName, mimeType, sizeBytes }) {
  const now = nowIso();
  return {
    id: plan.fileId,
    fileId: plan.fileId,
    businessId: session.businessId,
    entityType,
    entityId,
    category,
    originalFileName: fileName,
    sanitizedFileName: plan.fileName,
    fileName,
    objectKey: plan.objectKey ?? plan.key,
    key: plan.objectKey ?? plan.key,
    expectedContentType: mimeType,
    expectedFileSize: sizeBytes,
    mimeType,
    sizeBytes,
    uploadStatus: 'pending',
    uploadedByUserId: session.id,
    uploadedAt: undefined,
    createdAt: now,
    updatedAt: now,
    expiresAt: plan.expiresAt,
    ttl: Math.floor(new Date(plan.expiresAt).getTime() / 1000),
  };
}

const defaultDeps = {
  requireSession,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  createPendingUploadPlan,
  headStoredFile,
  removeStoredFile,
  validateUploadPayload,
  createAuditEventForBusiness,
  createPendingFileForBusiness,
  deleteFileForBusiness,
  getCustomerForBusiness,
  getExpenseForBusiness,
  getFileForBusiness,
  getEstimateForBusiness,
  getJobForBusiness,
  getEmployeeForBusiness,
  getFeedbackForBusiness,
  getTimeEntryForBusiness,
  listFilesForBusiness,
  updateFeedbackForBusiness,
  updateFileForBusiness,
  updateExpenseForBusiness,
  updateTimeEntryForBusiness,
};

export function createStorageHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };

  async function resolveAttachmentEntityWithDeps({ session, entityType, entityId, accessMode = 'read' }) {
    if (entityType === 'job') {
      const job = await deps.getJobForBusiness(session.businessId, entityId);
      if (!job) return null;
      return { entity: job, allowed: canAccessAttachmentRecord({ session, entityType, entity: job, accessMode }) };
    }

    if (entityType === 'customer') {
      const customer = await deps.getCustomerForBusiness(session.businessId, entityId);
      if (!customer) return null;
      return { entity: customer, allowed: canAccessAttachmentRecord({ session, entityType, entity: customer, accessMode }) };
    }

    if (entityType === 'estimate') {
      const estimate = await deps.getEstimateForBusiness(session.businessId, entityId);
      if (!estimate) return null;
      return { entity: estimate, allowed: canAccessAttachmentRecord({ session, entityType, entity: estimate, accessMode }) };
    }

    if (entityType === 'employee') {
      const employee = await deps.getEmployeeForBusiness(session.businessId, entityId);
      if (!employee) return null;
      return { entity: employee, allowed: canAccessAttachmentRecord({ session, entityType, entity: employee, accessMode }) };
    }

    if (entityType === 'expense') {
      const expense = await deps.getExpenseForBusiness(session.businessId, entityId);
      if (!expense) return null;
      return { entity: expense, allowed: canAccessAttachmentRecord({ session, entityType, entity: expense, accessMode }) };
    }

    if (entityType === 'time-entry') {
      const timeEntry = await deps.getTimeEntryForBusiness(session.businessId, entityId);
      if (!timeEntry) return null;
      return { entity: timeEntry, allowed: canAccessAttachmentRecord({ session, entityType, entity: timeEntry, accessMode }) };
    }

    if (entityType === 'feedback') {
      const feedback = await deps.getFeedbackForBusiness(session.businessId, entityId);
      if (!feedback) return null;
      return { entity: feedback, allowed: canAccessAttachmentRecord({ session, entityType, entity: feedback, accessMode }) };
    }

    if (entityType === DOCUMENT_ENTITY_TYPE) {
      const normalizedEntityId = typeof entityId === 'string' && entityId.trim() ? entityId.trim() : DOCUMENT_ENTITY_ID;
      return {
        entity: { id: normalizedEntityId },
        allowed: canManageDocuments(session.role),
      };
    }

    return null;
  }

  return async function handler(req, res) {
    const session = await deps.requireSession(req, res);
    if (!session) return;

    if (req.method === 'POST') {
      const body = parseJsonBody(req);
      if (!body) {
        return res.status(400).json({ ok: false, error: 'Invalid JSON request body.' });
      }

      const { action, fileName, mimeType, sizeBytes } = body;

      try {
        if (action === 'prepare-upload') {
          const { entityType, entityId, category } = body;
          if (typeof entityType !== 'string' || typeof entityId !== 'string' || typeof category !== 'string') {
            return res.status(400).json({ ok: false, error: 'Attachment context is required.' });
          }

          if (!isAttachmentEntityType(entityType)) {
            return res.status(400).json({ ok: false, error: 'Unsupported attachment entity type.' });
          }

          const normalizedCategory = normalizeAttachmentCategory(entityType, category);
          if (!normalizedCategory) {
            return res.status(400).json({ ok: false, error: 'Unsupported attachment category.' });
          }

          const validation = deps.validateUploadPayload({ fileName, mimeType, sizeBytes });
          if (!validation.ok) {
            return res.status(400).json({ ok: false, error: validation.error });
          }

          const resolvedEntity = await resolveAttachmentEntityWithDeps({
            session,
            entityType,
            entityId,
            accessMode: 'write',
          });
          if (!resolvedEntity?.entity || !resolvedEntity.allowed) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
          }

          const plan = deps.createPendingUploadPlan({
            businessId: session.businessId,
            fileName: validation.fileName,
            mimeType: validation.mimeType,
            sizeBytes: validation.sizeBytes,
          });

          const pendingRecord = buildPendingFileRecord({
            session,
            plan,
            entityType,
            entityId: typeof resolvedEntity.entity.id === 'string' ? resolvedEntity.entity.id : entityId,
            category: normalizedCategory,
            fileName: typeof fileName === 'string' && fileName.trim() ? fileName.trim() : validation.fileName,
            mimeType: validation.mimeType,
            sizeBytes: validation.sizeBytes,
          });

          await deps.createPendingFileForBusiness({ businessId: session.businessId, file: pendingRecord });

          const result = await deps.createPresignedUploadUrl({
            businessId: session.businessId,
            plan,
          });

          if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.error });
          }

          await deps.createAuditEventForBusiness({
            businessId: session.businessId,
            auditEvent: {
              id: `${Date.now()}-upload-plan`,
              entityType: 'FILE_UPLOAD',
              action: 'prepare-upload',
              userId: session.id,
              employeeId: session.employeeId,
              createdAt: nowIso(),
              details: {
                fileId: plan.fileId,
                entityType,
                entityId: pendingRecord.entityId,
                category: normalizedCategory,
              },
            },
          });

          return res.status(200).json({
            ok: true,
            fileId: plan.fileId,
            uploadUrl: result.uploadUrl,
            requiredHeaders: { 'Content-Type': validation.mimeType },
            expiresAt: plan.expiresAt,
          });
        }

        if (action === 'prepare-download') {
          if (!ensureAllowedKeys(body, DOWNLOAD_ALLOWED_KEYS) || typeof body.fileId !== 'string' || !body.fileId.trim()) {
            return res.status(400).json({ ok: false, error: 'Invalid file request.' });
          }

          const file = await deps.getFileForBusiness(session.businessId, body.fileId.trim());
          if (!file) {
            return res.status(404).json({ ok: false, error: 'File not found.' });
          }

          if (file.uploadStatus !== 'uploaded') {
            return res.status(409).json({ ok: false, error: 'File is not ready for download.' });
          }

          const entityResolution = await resolveAttachmentEntityWithDeps({
            session,
            entityType: file.entityType,
            entityId: file.entityId,
            accessMode: 'read',
          });
          if (!entityResolution?.allowed) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
          }

          const storageKey = businessScopedKey(file);
          const result = await deps.createPresignedDownloadUrl({ businessId: session.businessId, key: storageKey });
          if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.error });
          }

          return res.status(200).json({ ok: true, downloadUrl: result.downloadUrl, fileId: file.id });
        }

        if (action === 'delete') {
          if (!ensureAllowedKeys(body, DELETE_ALLOWED_KEYS) || typeof body.fileId !== 'string' || !body.fileId.trim()) {
            return res.status(400).json({ ok: false, error: 'Invalid file request.' });
          }

          const file = await deps.getFileForBusiness(session.businessId, body.fileId.trim());
          if (!file) {
            return res.status(404).json({ ok: false, error: 'File not found.' });
          }

          const entityResolution = await resolveAttachmentEntityWithDeps({
            session,
            entityType: file.entityType,
            entityId: file.entityId,
            accessMode: 'write',
          });
          if (!entityResolution?.allowed) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
          }

          const storageKey = businessScopedKey(file);
          if (storageKey) {
            const headResult = await deps.headStoredFile({ businessId: session.businessId, key: storageKey });
            if (!headResult.ok && headResult.status === 404) {
              console.warn('[storage:integrity]', { action: 'delete', businessId: session.businessId, fileId: file.id, message: 'Object missing before delete.' });
            }

            const result = await deps.removeStoredFile({ businessId: session.businessId, key: storageKey });
            if (!result.ok && result.status && result.status !== 404) {
              return res.status(result.status).json({ ok: false, error: result.error || STORAGE_FAILURE_MESSAGE });
            }
          }

          await deps.deleteFileForBusiness(session.businessId, file.id);
          return res.status(200).json({ ok: true });
        }

        if (action === 'validate') {
          const result = deps.validateUploadPayload({ fileName, mimeType, sizeBytes });
          return res.status(result.ok ? 200 : 400).json(result);
        }

        if (action === 'complete-upload') {
          if (!ensureAllowedKeys(body, COMPLETION_ALLOWED_KEYS) || typeof body.fileId !== 'string' || !body.fileId.trim()) {
            return res.status(400).json({ ok: false, error: 'Invalid upload completion payload.' });
          }

          const file = await deps.getFileForBusiness(session.businessId, body.fileId.trim());
          if (!file) {
            return res.status(404).json({ ok: false, error: 'File not found.' });
          }

          const resolvedEntity = await resolveAttachmentEntityWithDeps({
            session,
            entityType: file.entityType,
            entityId: file.entityId,
            accessMode: 'write',
          });
          if (!resolvedEntity?.entity || !resolvedEntity.allowed) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
          }

          const normalizedCategory = normalizeAttachmentCategory(file.entityType, file.category) ?? file.category;
          const attachmentField = file.entityType === DOCUMENT_ENTITY_TYPE
            ? undefined
            : getAttachmentFieldForCategory({ entityType: file.entityType, category: normalizedCategory });
          if (file.entityType !== DOCUMENT_ENTITY_TYPE && !attachmentField) {
            return res.status(400).json({ ok: false, error: 'Unsupported attachment category.' });
          }

          const objectKey = businessScopedKey(file);
          const headResult = await deps.headStoredFile({ businessId: session.businessId, key: objectKey });
          if (!headResult.ok) {
            return res.status(headResult.status === 404 ? 409 : 409).json({ ok: false, error: 'Uploaded file could not be verified.' });
          }

          const expectedContentType = typeof file.expectedContentType === 'string' ? file.expectedContentType : file.mimeType;
          const expectedFileSize = Number(file.expectedFileSize ?? file.sizeBytes ?? 0);
          if (headResult.contentLength !== expectedFileSize) {
            return res.status(409).json({ ok: false, error: 'Uploaded file could not be verified.' });
          }
          if (expectedContentType && headResult.contentType && headResult.contentType !== expectedContentType) {
            return res.status(409).json({ ok: false, error: 'Uploaded file could not be verified.' });
          }

          if (file.uploadStatus !== 'uploaded') {
            await deps.updateFileForBusiness({
              businessId: session.businessId,
              fileId: file.id,
              updates: {
                uploadStatus: 'uploaded',
                uploadedAt: nowIso(),
                etag: headResult.etag || undefined,
                checksumSha256: headResult.checksumSha256 || undefined,
                key: objectKey,
                objectKey,
                expectedContentType,
                expectedFileSize,
              },
            });
          }

          if (file.entityType === 'expense') {
            const expense = await deps.getExpenseForBusiness(session.businessId, file.entityId);
            if (expense) {
              await deps.updateExpenseForBusiness({
                businessId: session.businessId,
                expense: {
                  ...expense,
                  id: expense.id,
                  receiptFileId: file.id,
                  receiptUrl: undefined,
                },
              });
            }
          } else if (file.entityType === 'feedback') {
            const feedback = await deps.getFeedbackForBusiness(session.businessId, file.entityId);
            if (feedback) {
              await deps.updateFeedbackForBusiness({
                businessId: session.businessId,
                feedback: {
                  ...feedback,
                  id: feedback.id,
                  screenshotFileId: file.id,
                  updatedAt: nowIso(),
                },
              });
            }
          } else if (file.entityType === 'time-entry') {
            const timeEntry = await deps.getTimeEntryForBusiness(session.businessId, file.entityId);
            if (timeEntry) {
              await deps.updateTimeEntryForBusiness({
                businessId: session.businessId,
                timeEntry: {
                  ...timeEntry,
                  id: timeEntry.id,
                  [attachmentField]: file.id,
                },
              });
            }
          }

          await deps.createAuditEventForBusiness({
            businessId: session.businessId,
            auditEvent: {
              id: `${Date.now()}-upload-complete`,
              entityType: 'FILE_UPLOAD',
              action: 'complete-upload',
              userId: session.id,
              employeeId: session.employeeId,
              createdAt: nowIso(),
              details: { fileId: file.id, entityType: file.entityType, entityId: file.entityId },
            },
          });

          return res.status(200).json({ ok: true, fileId: file.id });
        }

        return res.status(400).json({ ok: false, error: 'Unsupported action.' });
      } catch (error) {
        logStorageFailure(action, error);
        return res.status(getSafeStatusCode(error)).json({ ok: false, error: STORAGE_FAILURE_MESSAGE });
      }
    }

    if (req.method === 'GET') {
      try {
        const view = req.query?.view;
        if (view === 'files') {
          const files = await deps.listFilesForBusiness(session.businessId);
          const entityTypeFilter = typeof req.query?.entityType === 'string' ? req.query.entityType.trim().toLowerCase() : '';
          const categoryFilter = typeof req.query?.category === 'string' ? req.query.category.trim().toLowerCase() : '';

          const matchingFiles = files.filter((file) => {
            if (entityTypeFilter && String(file.entityType || '').toLowerCase() !== entityTypeFilter) {
              return false;
            }
            if (categoryFilter && String(file.category || '').toLowerCase() !== categoryFilter) {
              return false;
            }
            return true;
          });

          const authorizationChecks = await Promise.all(matchingFiles.map(async (file) => {
            const resolution = await resolveAttachmentEntityWithDeps({
              session,
              entityType: file.entityType,
              entityId: file.entityId,
              accessMode: 'read',
            });
            return Boolean(resolution?.allowed);
          }));

          const scopedFiles = matchingFiles.filter((_, index) => authorizationChecks[index]);

          return res.status(200).json({
            ok: true,
            files: scopedFiles.map((file) => ({
              id: file.id,
              fileName: file.fileName,
              originalFileName: file.originalFileName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              uploadedAt: file.uploadedAt,
              uploadedByUserId: file.uploadedByUserId,
              entityType: file.entityType,
              entityId: file.entityId,
              category: file.category,
              uploadStatus: file.uploadStatus,
              expiresAt: file.expiresAt,
            })),
          });
        }

        return res.status(200).json({ ok: true, message: 'Storage API is ready.' });
      } catch (error) {
        logStorageFailure('list-files', error);
        return res.status(getSafeStatusCode(error)).json({ ok: false, error: STORAGE_FAILURE_MESSAGE });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  };
}

export default createStorageHandler();
