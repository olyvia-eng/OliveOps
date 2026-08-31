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
  getFormFieldForBusiness,
  getFormForBusiness,
  getFormSubmissionForBusiness,
  getJobForBusiness,
  getEmployeeForBusiness,
  getFeedbackForBusiness,
  getTimeEntryForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listFilesForBusiness,
  listJobsForBusiness,
  updateFeedbackForBusiness,
  updateFileForBusiness,
  updateExpenseForBusiness,
  updateTimeEntryForBusiness,
} from './_lib/authRepo.js';
import { authorizeRecordAccess, canReadEntity, canWriteEntity } from './_lib/authorization.js';
import { listCrewsForBusiness } from './_lib/schedulingConfig.js';
import { listDivisionsForBusiness } from './_lib/schedulingConfig.js';
import { isFormAssignedToEmployee } from './_lib/formsEngine.js';
import { findClockInWorkflowRequirement, getClockInWorkflowForBusiness } from './_lib/mandatoryClockIn.js';
import { findWorkflowRequirement, getClockOutWorkflowForBusiness } from './_lib/mandatoryClockOut.js';

const STORAGE_FAILURE_MESSAGE = 'Storage service is temporarily unavailable.';
const DOCUMENT_ENTITY_TYPE = 'document';
const DOCUMENT_ENTITY_ID = 'library';
const FORM_SIGNATURE_ENTITY_TYPE = 'form-signature';
const FORM_ATTACHMENT_ENTITY_TYPE = 'form-attachment';
const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
const FORM_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const FORM_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CLIENT_SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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
  [FORM_SIGNATURE_ENTITY_TYPE]: new Set(['signature']),
  [FORM_ATTACHMENT_ENTITY_TYPE]: new Set(['photo']),
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

function canAccessAttachmentRecord({ session, entityType, entity, accessMode, context = {} }) {
  if (entityType === DOCUMENT_ENTITY_TYPE) {
    return canManageDocuments(session.role);
  }

  const authorizationEntity = mapAttachmentEntityToAuthorizationEntity(entityType);
  if (!authorizationEntity) {
    return false;
  }

  if (entityType === 'time-entry' && authorizeRecordAccess(session, authorizationEntity, entity, context)) {
    return true;
  }

  const hasEntityPermission = accessMode === 'write'
    ? canWriteEntity(authorizationEntity, session.role)
    : canReadEntity(authorizationEntity, session.role);
  if (!hasEntityPermission) {
    return false;
  }

  return authorizeRecordAccess(session, authorizationEntity, entity, context);
}

function ensureAllowedKeys(body, allowedKeys) {
  const unexpectedKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  return unexpectedKeys.length === 0;
}

function buildPendingFileRecord({ session, plan, entityType, entityId, category, fileName, mimeType, sizeBytes, formContext }) {
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
    ...formContext,
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
  getFormFieldForBusiness,
  getFormForBusiness,
  getFormSubmissionForBusiness,
  getJobForBusiness,
  getEmployeeForBusiness,
  getFeedbackForBusiness,
  getTimeEntryForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listFilesForBusiness,
  listJobsForBusiness,
  updateFeedbackForBusiness,
  updateFileForBusiness,
  updateExpenseForBusiness,
  updateTimeEntryForBusiness,
  listCrewsForBusiness,
  listDivisionsForBusiness,
  getClockInWorkflowForBusiness,
  findClockInWorkflowRequirement,
  getClockOutWorkflowForBusiness,
  findWorkflowRequirement,
};

export function createStorageHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };

  async function resolveSessionEmployee(session) {
    const employees = await deps.listEmployeesForBusiness(session.businessId);
    return employees.find((employee) => employee.active && employee.userId === session.id)
      ?? employees.find((employee) => employee.active && employee.id === session.employeeId)
      ?? null;
  }

  async function resolveAttachmentEntityWithDeps({ session, entityType, entityId, accessMode = 'read' }) {
    if (entityType === FORM_SIGNATURE_ENTITY_TYPE || entityType === FORM_ATTACHMENT_ENTITY_TYPE) {
      const file = await deps.getFileForBusiness(session.businessId, entityId);
      if (!file) return null;
      if (file.claimedSubmissionId) {
        const submission = await deps.getFormSubmissionForBusiness(session.businessId, file.claimedSubmissionId);
        const employee = await resolveSessionEmployee(session);
        return {
          entity: submission,
          allowed: accessMode === 'read'
            && Boolean(submission)
            && (['owner', 'admin', 'foreman'].includes(session.role) || employee?.id === submission.employeeId),
        };
      }
      const employee = await resolveSessionEmployee(session);
      return {
        entity: file,
        allowed: file.uploadedByUserId === session.id
          && (file.submitterEmployeeId ?? file.signerEmployeeId) === employee?.id,
      };
    }

    if (entityType === 'job') {
      const job = await deps.getJobForBusiness(session.businessId, entityId);
      if (!job) return null;
      const directlyAllowed = canAccessAttachmentRecord({ session, entityType, entity: job, accessMode });
      if (directlyAllowed || !job.crewId) return { entity: job, allowed: directlyAllowed };
      const crews = await deps.listCrewsForBusiness(session.businessId);
      return { entity: job, allowed: canAccessAttachmentRecord({ session, entityType, entity: job, accessMode, context: { crews } }) };
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

          let formContext;
          if (entityType === FORM_SIGNATURE_ENTITY_TYPE || entityType === FORM_ATTACHMENT_ENTITY_TYPE) {
            const formId = typeof body.formId === 'string' ? body.formId.trim() : '';
            const fieldId = typeof body.fieldId === 'string' ? body.fieldId.trim() : '';
            const clientSubmissionId = typeof body.clientSubmissionId === 'string' ? body.clientSubmissionId.trim() : '';
            const workflowOccurrenceId = typeof body.workflowOccurrenceId === 'string' ? body.workflowOccurrenceId.trim() : '';
            const workflowRequirementId = typeof body.workflowRequirementId === 'string' ? body.workflowRequirementId.trim() : '';
            const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
            const equipmentId = typeof body.equipmentId === 'string' ? body.equipmentId.trim() : '';
            const divisionId = typeof body.divisionId === 'string' ? body.divisionId.trim() : '';
            if (entityType === FORM_SIGNATURE_ENTITY_TYPE && (validation.mimeType !== 'image/png' || validation.sizeBytes > SIGNATURE_MAX_BYTES)) {
              return res.status(400).json({ ok: false, error: 'Signatures must be PNG files no larger than 2 MB.' });
            }
            if (entityType === FORM_ATTACHMENT_ENTITY_TYPE && (!FORM_PHOTO_MIME_TYPES.has(validation.mimeType) || validation.sizeBytes > FORM_PHOTO_MAX_BYTES)) {
              return res.status(400).json({ ok: false, error: 'Form photos must be JPEG, PNG, or WebP files no larger than 8 MB.' });
            }
            if (!formId || !fieldId || !CLIENT_SUBMISSION_ID_PATTERN.test(clientSubmissionId) || entityId !== clientSubmissionId) {
              return res.status(400).json({ ok: false, error: 'Form attachment upload context is invalid.' });
            }
            const [liveForm, liveField, employee] = await Promise.all([
              deps.getFormForBusiness(session.businessId, formId),
              deps.getFormFieldForBusiness(session.businessId, fieldId),
              resolveSessionEmployee(session),
            ]);
            let form = liveForm;
            let field = liveField;
            let workflowAuthorized = false;
            if (workflowOccurrenceId && workflowRequirementId && employee) {
              const [clockInWorkflow, clockOutWorkflow] = await Promise.all([
                deps.getClockInWorkflowForBusiness(session.businessId, workflowOccurrenceId),
                deps.getClockOutWorkflowForBusiness(session.businessId, workflowOccurrenceId),
              ]);
              const workflow = clockInWorkflow ?? clockOutWorkflow;
              const requirement = clockInWorkflow
                ? deps.findClockInWorkflowRequirement(workflow, { formId, requirementId: workflowRequirementId })
                : deps.findWorkflowRequirement(workflow, { formId, requirementId: workflowRequirementId });
              if (workflow?.employeeId === employee.id && requirement?.form) {
                form = requirement.form;
                field = requirement.form.fields?.find((candidate) => candidate.id === fieldId);
                workflowAuthorized = true;
              }
            }
            const expectedFieldType = entityType === FORM_SIGNATURE_ENTITY_TYPE ? 'signature' : 'photo_upload';
            if (!form || !field || field.formId && field.formId !== form.id || field.type !== expectedFieldType || !employee) {
              return res.status(403).json({ ok: false, error: 'Forbidden' });
            }
            if (entityType === FORM_ATTACHMENT_ENTITY_TYPE && (workflowOccurrenceId || workflowRequirementId) && !workflowAuthorized) {
              return res.status(403).json({ ok: false, error: 'Forbidden' });
            }
            if (!workflowAuthorized) {
              const [jobs, equipment, crews, divisions] = await Promise.all([
                deps.listJobsForBusiness(session.businessId),
                deps.listEquipmentAssetsForBusiness(session.businessId),
                deps.listCrewsForBusiness(session.businessId),
                deps.listDivisionsForBusiness(session.businessId),
              ]);
              const job = jobs.find((candidate) => candidate.id === (jobId || (form.assignedTo === 'job' ? form.assignmentValue : '')));
              const equipmentAsset = equipment.find((candidate) => candidate.id === (equipmentId || (form.assignedTo === 'equipment' ? form.assignmentValue : '')));
              const division = divisions.find((candidate) => candidate.id === (divisionId || job?.divisionId));
              if (form.status !== 'active' || !isFormAssignedToEmployee({ form, employee, crews, divisions, job, equipment: equipmentAsset, division })) {
                return res.status(403).json({ ok: false, error: 'Forbidden' });
              }
            }
            formContext = {
              formId,
              fieldId,
              clientSubmissionId,
              workflowOccurrenceId: workflowOccurrenceId || undefined,
              workflowRequirementId: workflowRequirementId || undefined,
              jobId: jobId || undefined,
              equipmentId: equipmentId || undefined,
              divisionId: divisionId || undefined,
              submitterEmployeeId: employee.id,
              submitterUserId: session.id,
              ...(entityType === FORM_SIGNATURE_ENTITY_TYPE ? {
                signerEmployeeId: employee.id,
                signerUserId: session.id,
              } : {}),
            };
          }

          const resolvedEntity = entityType === FORM_SIGNATURE_ENTITY_TYPE || entityType === FORM_ATTACHMENT_ENTITY_TYPE
            ? { entity: { id: entityId }, allowed: true }
            : await resolveAttachmentEntityWithDeps({ session, entityType, entityId, accessMode: 'write' });
          if (!resolvedEntity?.entity || !resolvedEntity.allowed) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
          }

          const plan = deps.createPendingUploadPlan({
            businessId: session.businessId,
            fileName: validation.fileName,
            mimeType: validation.mimeType,
            sizeBytes: validation.sizeBytes,
          });
          if (entityType === FORM_SIGNATURE_ENTITY_TYPE || entityType === FORM_ATTACHMENT_ENTITY_TYPE) plan.writeOnce = true;

          const pendingRecord = buildPendingFileRecord({
            session,
            plan,
            entityType,
            entityId: typeof resolvedEntity.entity.id === 'string' ? resolvedEntity.entity.id : entityId,
            category: normalizedCategory,
            fileName: typeof fileName === 'string' && fileName.trim() ? fileName.trim() : validation.fileName,
            mimeType: validation.mimeType,
            sizeBytes: validation.sizeBytes,
            formContext,
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
            requiredHeaders: { 'Content-Type': validation.mimeType, ...(plan.writeOnce ? { 'If-None-Match': '*' } : {}) },
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
            entityId: file.entityType === FORM_SIGNATURE_ENTITY_TYPE || file.entityType === FORM_ATTACHMENT_ENTITY_TYPE ? file.id : file.entityId,
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
          if ((file.entityType === FORM_SIGNATURE_ENTITY_TYPE || file.entityType === FORM_ATTACHMENT_ENTITY_TYPE) && file.claimedSubmissionId) {
            return res.status(409).json({ ok: false, error: 'A finalized signature cannot be deleted.' });
          }

          const entityResolution = await resolveAttachmentEntityWithDeps({
            session,
            entityType: file.entityType,
            entityId: file.entityType === FORM_SIGNATURE_ENTITY_TYPE || file.entityType === FORM_ATTACHMENT_ENTITY_TYPE ? file.id : file.entityId,
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
            entityId: file.entityType === FORM_SIGNATURE_ENTITY_TYPE || file.entityType === FORM_ATTACHMENT_ENTITY_TYPE ? file.id : file.entityId,
            accessMode: 'write',
          });
          if (!resolvedEntity?.entity || !resolvedEntity.allowed) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
          }

          const normalizedCategory = normalizeAttachmentCategory(file.entityType, file.category) ?? file.category;
          const attachmentField = file.entityType === DOCUMENT_ENTITY_TYPE
            ? undefined
            : getAttachmentFieldForCategory({ entityType: file.entityType, category: normalizedCategory });
          if (file.entityType !== DOCUMENT_ENTITY_TYPE && file.entityType !== FORM_SIGNATURE_ENTITY_TYPE && file.entityType !== FORM_ATTACHMENT_ENTITY_TYPE && !attachmentField) {
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
              entityId: file.entityType === FORM_SIGNATURE_ENTITY_TYPE || file.entityType === FORM_ATTACHMENT_ENTITY_TYPE ? file.id : file.entityId,
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
