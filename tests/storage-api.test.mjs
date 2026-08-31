import test from 'node:test';
import assert from 'node:assert/strict';

import { createStorageHandler } from '../api/storage.js';
import { validateUploadPayload as validateStorageUploadPayload } from '../api/_lib/storage.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function baseDeps(overrides = {}) {
  return {
    requireSession: () => ({
      id: 'user-1',
      role: 'admin',
      businessId: 'biz-1',
      employeeId: 'emp-1',
    }),
    createPendingUploadPlan: () => ({ fileId: 'file-1', key: 'biz-1/file-1/photo.jpg', objectKey: 'biz-1/file-1/photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 100, expiresAt: '2026-08-06T10:10:00.000Z' }),
    createPresignedUploadUrl: async ({ plan }) => ({ ok: true, uploadUrl: `https://signed.example/upload/${plan.fileId}`, plan }),
    createPresignedDownloadUrl: async () => ({ ok: true, downloadUrl: 'https://signed.example/download' }),
    headStoredFile: async () => ({ ok: true, contentLength: 1024, contentType: 'image/jpeg', etag: 'etag-1' }),
    removeStoredFile: async () => ({ ok: true }),
    validateUploadPayload: (payload) => {
      const result = validateStorageUploadPayload(payload);
      return result.ok ? result : { ok: false, error: result.error };
    },
    createAuditEventForBusiness: async () => ({ ok: true }),
    createPendingFileForBusiness: async () => ({ ok: true }),
    updateFileForBusiness: async () => ({ ok: true }),
    deleteFileForBusiness: async () => ({ ok: true }),
    getCustomerForBusiness: async () => null,
    getExpenseForBusiness: async () => ({ id: 'expense-1', vendor: 'Acme', description: 'd', category: 'other', expenseDate: '2026-01-01', amount: 10, status: 'pending', notes: '' }),
    getFileForBusiness: async () => null,
    getEstimateForBusiness: async () => null,
    getFormForBusiness: async () => null,
    getFormFieldForBusiness: async () => null,
    getFormSubmissionForBusiness: async () => null,
    getClockInWorkflowForBusiness: async () => null,
    findClockInWorkflowRequirement: () => null,
    getClockOutWorkflowForBusiness: async () => null,
    findWorkflowRequirement: () => null,
    getJobForBusiness: async () => null,
    getEmployeeForBusiness: async () => null,
    getFeedbackForBusiness: async () => null,
    getTimeEntryForBusiness: async () => ({ id: 'time-1', employeeId: 'emp-1', status: 'clocked_in' }),
    listEmployeesForBusiness: async () => [{ id: 'emp-1', userId: 'user-1', active: true }],
    listFilesForBusiness: async () => [],
    updateFeedbackForBusiness: async () => ({ ok: true }),
    updateExpenseForBusiness: async () => ({ ok: true }),
    updateTimeEntryForBusiness: async () => ({ ok: true }),
    ...overrides,
  };
}

test('missing AWS_S3_BUCKET_NAME failure returns JSON from prepare-upload', async () => {
  const handler = createStorageHandler(baseDeps({
    createPresignedUploadUrl: async () => {
      const error = new Error('Missing required environment variable AWS_S3_BUCKET_NAME');
      error.name = 'MissingEnvironmentVariableError';
      throw error;
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      entityType: 'time-entry',
      entityId: 'time-1',
      category: 'clock-out-photo',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'Storage service is temporarily unavailable.',
  });
});

test('prepare-upload unexpected failure returns JSON', async () => {
  const handler = createStorageHandler(baseDeps({
    createPresignedUploadUrl: async () => {
      const error = new Error('AWS SDK failed');
      error.name = 'ServiceError';
      error.$metadata = { httpStatusCode: 500 };
      throw error;
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      entityType: 'time-entry',
      entityId: 'time-1',
      category: 'clock-out-photo',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'Storage service is temporarily unavailable.',
  });
});

test('complete-upload unexpected failure returns JSON', async () => {
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'expense',
      entityId: 'expense-1',
      category: 'receipt',
      fileName: 'photo.jpg',
      originalFileName: 'photo.jpg',
      sanitizedFileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      expectedContentType: 'image/jpeg',
      expectedFileSize: 1024,
      objectKey: 'biz-1/file-1/photo.jpg',
      key: 'biz-1/file-1/photo.jpg',
      uploadStatus: 'pending',
    }),
    headStoredFile: async () => ({ ok: true, contentLength: 1024, contentType: 'image/jpeg', etag: 'etag-1' }),
    updateFileForBusiness: async () => {
      const error = new Error('DynamoDB write failure');
      error.name = 'ProvisionedThroughputExceededException';
      error.$metadata = { httpStatusCode: 503 };
      throw error;
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'complete-upload',
      fileId: 'file-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'Storage service is temporarily unavailable.',
  });
});

test('successful prepare-upload returns presigned URL payload', async () => {
  let pendingFile;
  const handler = createStorageHandler(baseDeps({
    createPendingFileForBusiness: async ({ file }) => {
      pendingFile = file;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      entityType: 'time-entry',
      entityId: 'time-1',
      category: 'clock-out-photo',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.fileId, 'file-1');
  assert.equal(res.body.uploadUrl, 'https://signed.example/upload/file-1');
  assert.deepEqual(res.body.requiredHeaders, { 'Content-Type': 'image/jpeg' });
  assert.equal(res.body.expiresAt, '2026-08-06T10:10:00.000Z');
  assert.equal(pendingFile.uploadStatus, 'pending');
  assert.equal(pendingFile.objectKey, 'biz-1/file-1/photo.jpg');
});

test('Form signature prepare-upload enforces PNG policy and stores trusted binding context', async () => {
  let pendingFile;
  let trustedPlan;
  const handler = createStorageHandler(baseDeps({
    getFormForBusiness: async () => ({ id: 'form-1' }),
    getFormFieldForBusiness: async () => ({ id: 'field-1', formId: 'form-1', type: 'signature' }),
    createPendingFileForBusiness: async ({ file }) => { pendingFile = file; return { ok: true }; },
    createPresignedUploadUrl: async ({ plan }) => { trustedPlan = plan; return { ok: true, uploadUrl: 'https://signed.example/signature', plan }; },
  }));
  const res = createMockRes();
  await handler({ method: 'POST', body: {
    action: 'prepare-upload', entityType: 'form-signature', entityId: 'signature-submission-001', category: 'signature',
    formId: 'form-1', fieldId: 'field-1', clientSubmissionId: 'signature-submission-001',
    workflowOccurrenceId: 'workflow-1', workflowRequirementId: 'requirement-1',
    fileName: 'signature.png', mimeType: 'image/png', sizeBytes: 20_000,
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.requiredHeaders, { 'Content-Type': 'image/png', 'If-None-Match': '*' });
  assert.equal(trustedPlan.writeOnce, true);
  assert.equal(pendingFile.formId, 'form-1');
  assert.equal(pendingFile.fieldId, 'field-1');
  assert.equal(pendingFile.signerEmployeeId, 'emp-1');
  assert.equal(pendingFile.signerUserId, 'user-1');
  assert.equal(pendingFile.workflowOccurrenceId, 'workflow-1');
});

test('Form signature prepare-upload rejects non-PNG and oversized payloads', async () => {
  const handler = createStorageHandler(baseDeps({
    getFormForBusiness: async () => ({ id: 'form-1' }),
    getFormFieldForBusiness: async () => ({ id: 'field-1', formId: 'form-1', type: 'signature' }),
  }));
  for (const [fileName, mimeType, sizeBytes] of [
    ['signature.jpg', 'image/jpeg', 1000],
    ['signature.png', 'image/png', 2 * 1024 * 1024 + 1],
  ]) {
    const res = createMockRes();
    await handler({ method: 'POST', body: {
      action: 'prepare-upload', entityType: 'form-signature', entityId: 'signature-submission-001', category: 'signature',
      formId: 'form-1', fieldId: 'field-1', clientSubmissionId: 'signature-submission-001', fileName, mimeType, sizeBytes,
    } }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('finalized Form signatures cannot be deleted through generic storage', async () => {
  let removed = false;
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1', entityType: 'form-signature', entityId: 'signature-submission-001', category: 'signature',
      claimedSubmissionId: 'submission-1', objectKey: 'biz-1/file-1/signature.png', uploadStatus: 'uploaded',
    }),
    removeStoredFile: async () => { removed = true; return { ok: true }; },
  }));
  const res = createMockRes();
  await handler({ method: 'POST', body: { action: 'delete', fileId: 'file-1' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(removed, false);
});

test('prepare-upload for expense stores trusted entityType, normalized category, and authoritative entityId', async () => {
  let pendingFile;
  const handler = createStorageHandler(baseDeps({
    getExpenseForBusiness: async () => ({ id: 'expense-1', vendor: 'Acme', description: 'd', category: 'other', expenseDate: '2026-01-01', amount: 10, status: 'pending', notes: '' }),
    createPendingFileForBusiness: async ({ file }) => {
      pendingFile = file;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      entityType: 'expense',
      entityId: 'client-sent-expense-id',
      category: 'RECEIPT',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(pendingFile.entityType, 'expense');
  assert.equal(pendingFile.category, 'receipt');
  assert.equal(pendingFile.entityId, 'expense-1');
});

test('prepare-upload rejects unsupported expense categories', async () => {
  const handler = createStorageHandler(baseDeps());

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      entityType: 'expense',
      entityId: 'expense-1',
      category: 'receipts',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Unsupported attachment category.');
});

test('prepare-upload rejects unsupported entity type', async () => {
  const handler = createStorageHandler(baseDeps());

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      entityType: 'unsupported',
      entityId: 'time-1',
      category: 'clock-out-photo',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('successful complete-upload returns file metadata', async () => {
  let updatedFile;
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'expense',
      entityId: 'expense-1',
      category: 'receipt',
      fileName: 'photo.jpg',
      originalFileName: 'photo.jpg',
      sanitizedFileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      expectedContentType: 'image/jpeg',
      expectedFileSize: 1024,
      objectKey: 'biz-1/file-1/photo.jpg',
      key: 'biz-1/file-1/photo.jpg',
      uploadStatus: 'pending',
    }),
    updateFileForBusiness: async ({ updates }) => {
      updatedFile = updates;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'complete-upload',
      fileId: 'file-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, fileId: 'file-1' });
  assert.equal(updatedFile.uploadStatus, 'uploaded');
  assert.equal(updatedFile.objectKey, 'biz-1/file-1/photo.jpg');
});

test('complete-upload maps expense receipt to receiptFileId and persists on expense', async () => {
  let updatedExpense;
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'expense',
      entityId: 'expense-1',
      category: 'receipt',
      fileName: 'receipt.pdf',
      originalFileName: 'receipt.pdf',
      sanitizedFileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expectedContentType: 'application/pdf',
      expectedFileSize: 1024,
      objectKey: 'biz-1/file-1/receipt.pdf',
      key: 'biz-1/file-1/receipt.pdf',
      uploadStatus: 'pending',
    }),
    headStoredFile: async () => ({ ok: true, contentLength: 1024, contentType: 'application/pdf', etag: 'etag-1' }),
    getExpenseForBusiness: async () => ({
      id: 'expense-1',
      vendor: 'Acme',
      description: 'Materials',
      category: 'materials',
      expenseDate: '2026-01-01',
      amount: 100,
      status: 'pending',
      notes: '',
      receiptUrl: 'https://legacy.example/receipt.pdf',
    }),
    updateExpenseForBusiness: async ({ expense }) => {
      updatedExpense = expense;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'complete-upload',
      fileId: 'file-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedExpense.id, 'expense-1');
  assert.equal(updatedExpense.receiptFileId, 'file-1');
  assert.equal(updatedExpense.receiptUrl, undefined);
});

test('complete-upload rejects browser-supplied objectKey fields', async () => {
  const handler = createStorageHandler(baseDeps());

  const req = {
    method: 'POST',
    body: {
      action: 'complete-upload',
      fileId: 'file-1',
      key: 'biz-1/file-1/photo.jpg',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('complete-upload rejects legacy browser metadata fields', async () => {
  const handler = createStorageHandler(baseDeps());

  const req = {
    method: 'POST',
    body: {
      action: 'complete-upload',
      fileId: 'file-1',
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      entityType: 'expense',
      entityId: 'expense-1',
      category: 'receipt',
      businessId: 'biz-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Invalid upload completion payload.');
});

test('prepare-upload for new expense without persisted entity is forbidden', async () => {
  const handler = createStorageHandler(baseDeps({
    getExpenseForBusiness: async () => null,
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      entityType: 'expense',
      entityId: '',
      category: 'receipt',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Forbidden');
});

test('prepare-upload accepts feedback screenshot attachments for existing feedback records', async () => {
  let pendingFile;
  const handler = createStorageHandler(baseDeps({
    getFeedbackForBusiness: async () => ({
      id: 'feedback-1',
      businessId: 'biz-1',
      type: 'bug',
      message: 'Issue details',
      status: 'new',
      priority: 'normal',
      createdAt: '2026-08-06T10:00:00.000Z',
      updatedAt: '2026-08-06T10:00:00.000Z',
    }),
    createPendingFileForBusiness: async ({ file }) => {
      pendingFile = file;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-upload',
      fileName: 'feedback.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      entityType: 'feedback',
      entityId: 'feedback-1',
      category: 'screenshot',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(pendingFile.entityType, 'feedback');
  assert.equal(pendingFile.entityId, 'feedback-1');
  assert.equal(pendingFile.category, 'screenshot');
});

test('complete-upload links feedback screenshot by fileId only', async () => {
  let updatedFeedback;
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'feedback',
      entityId: 'feedback-1',
      category: 'screenshot',
      fileName: 'feedback.png',
      originalFileName: 'feedback.png',
      sanitizedFileName: 'feedback.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      expectedContentType: 'image/png',
      expectedFileSize: 1024,
      objectKey: 'biz-1/file-1/feedback.png',
      key: 'biz-1/file-1/feedback.png',
      uploadStatus: 'pending',
    }),
    getFeedbackForBusiness: async () => ({
      id: 'feedback-1',
      businessId: 'biz-1',
      submittedByUserId: 'user-1',
      submittedByRole: 'admin',
      type: 'bug',
      message: 'Issue details',
      status: 'new',
      priority: 'normal',
      createdAt: '2026-08-06T10:00:00.000Z',
      updatedAt: '2026-08-06T10:00:00.000Z',
    }),
    headStoredFile: async () => ({ ok: true, contentLength: 1024, contentType: 'image/png', etag: 'etag-1' }),
    updateFeedbackForBusiness: async ({ feedback }) => {
      updatedFeedback = feedback;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'complete-upload',
      fileId: 'file-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(updatedFeedback.id, 'feedback-1');
  assert.equal(updatedFeedback.screenshotFileId, 'file-1');
});

test('prepare-download accepts fileId only', async () => {
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'document',
      entityId: 'library',
      uploadStatus: 'uploaded',
      key: 'biz-1/file-1/photo.jpg',
    }),
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-download',
      fileId: 'file-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.downloadUrl, 'https://signed.example/download');
  assert.equal(res.body.fileId, 'file-1');
});

test('delete accepts fileId only', async () => {
  let deletedFileId;
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'expense',
      entityId: 'expense-1',
      uploadStatus: 'uploaded',
      key: 'biz-1/file-1/photo.jpg',
    }),
    deleteFileForBusiness: async (_businessId, fileId) => {
      deletedFileId = fileId;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'delete',
      fileId: 'file-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(deletedFileId, 'file-1');
});

test('list files view supports entityType filter for restored documents page', async () => {
  const handler = createStorageHandler(baseDeps({
    listFilesForBusiness: async () => ([
      {
        id: 'doc-1',
        fileName: 'Master Contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1200,
        key: 'biz-1/doc-1/master-contract.pdf',
        uploadedAt: '2026-08-05T10:00:00.000Z',
        entityType: 'document',
        entityId: 'library',
        category: 'contracts',
      },
      {
        id: 'photo-1',
        fileName: 'Clock Out.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2000,
        key: 'biz-1/photo-1/clock-out.jpg',
        uploadedAt: '2026-08-05T11:00:00.000Z',
        entityType: 'time-entry',
        entityId: 'time-1',
        category: 'clock-out-photo',
      },
    ]),
  }));

  const req = {
    method: 'GET',
    query: {
      view: 'files',
      entityType: 'document',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.files.length, 1);
  assert.equal(res.body.files[0].entityType, 'document');
  assert.equal(res.body.files[0].fileName, 'Master Contract.pdf');
});

test('crew_member list files only returns authorized attachments', async () => {
  const handler = createStorageHandler(baseDeps({
    requireSession: () => ({
      id: 'user-crew-1',
      role: 'crew_member',
      businessId: 'biz-1',
      employeeId: 'emp-1',
    }),
    listFilesForBusiness: async () => ([
      {
        id: 'file-job-own',
        fileName: 'Own Job Photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1200,
        key: 'biz-1/file-job-own/photo.jpg',
        uploadedAt: '2026-08-05T10:00:00.000Z',
        entityType: 'job',
        entityId: 'job-own',
        category: 'photo',
        uploadStatus: 'uploaded',
      },
      {
        id: 'file-job-other',
        fileName: 'Other Job Photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1200,
        key: 'biz-1/file-job-other/photo.jpg',
        uploadedAt: '2026-08-05T10:00:00.000Z',
        entityType: 'job',
        entityId: 'job-other',
        category: 'photo',
        uploadStatus: 'uploaded',
      },
      {
        id: 'file-doc-library',
        fileName: 'Company Master Contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2200,
        key: 'biz-1/file-doc-library/master-contract.pdf',
        uploadedAt: '2026-08-05T10:00:00.000Z',
        entityType: 'document',
        entityId: 'library',
        category: 'contracts',
        uploadStatus: 'uploaded',
      },
    ]),
    getJobForBusiness: async (_businessId, id) => {
      if (id === 'job-own') {
        return { id: 'job-own', assignedEmployeeIds: ['emp-1'] };
      }
      if (id === 'job-other') {
        return { id: 'job-other', assignedEmployeeIds: ['emp-2'] };
      }
      return null;
    },
  }));

  const req = {
    method: 'GET',
    query: {
      view: 'files',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(Array.isArray(res.body.files), true);
  assert.equal(res.body.files.length, 1);
  assert.equal(res.body.files[0].id, 'file-job-own');
});

test('crew_member cannot prepare-download for unrelated job attachment', async () => {
  const handler = createStorageHandler(baseDeps({
    requireSession: () => ({
      id: 'user-crew-1',
      role: 'crew_member',
      businessId: 'biz-1',
      employeeId: 'emp-1',
    }),
    getFileForBusiness: async () => ({
      id: 'file-job-other',
      businessId: 'biz-1',
      entityType: 'job',
      entityId: 'job-other',
      uploadStatus: 'uploaded',
      key: 'biz-1/file-job-other/photo.jpg',
    }),
    getJobForBusiness: async (_businessId, id) => {
      if (id === 'job-other') {
        return { id: 'job-other', assignedEmployeeIds: ['emp-2'] };
      }
      return null;
    },
  }));

  const req = {
    method: 'POST',
    body: {
      action: 'prepare-download',
      fileId: 'file-job-other',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Forbidden');
});

test('crew_member can upload to own time entry but not another employee entry', async () => {
  const pendingParents = [];
  const handler = createStorageHandler(baseDeps({
    requireSession: () => ({ id: 'user-a', role: 'crew_member', businessId: 'biz-1', employeeId: 'emp-a' }),
    getTimeEntryForBusiness: async (_businessId, id) => (
      id === 'entry-a'
        ? { id, employeeId: 'emp-a', status: 'clocked_in' }
        : { id, employeeId: 'emp-b', status: 'clocked_in' }
    ),
    createPendingFileForBusiness: async ({ file }) => {
      pendingParents.push(file.entityId);
      return { ok: true };
    },
  }));
  const requestUpload = async (entityId) => {
    const res = createMockRes();
    await handler({ method: 'POST', body: { action: 'prepare-upload', fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 100, entityType: 'time-entry', entityId, category: 'clock-out-photo' } }, res);
    return res;
  };

  assert.equal((await requestUpload('entry-a')).statusCode, 200);
  assert.equal((await requestUpload('entry-b')).statusCode, 403);
  assert.deepEqual(pendingParents, ['entry-a']);
});

test('crew_member file actions reauthorize the stored file parent entry', async () => {
  const file = {
    id: 'file-b', businessId: 'biz-1', entityType: 'time-entry', entityId: 'entry-b', category: 'clock-out-photo',
    uploadStatus: 'uploaded', key: 'biz-1/file-b/photo.jpg', objectKey: 'biz-1/file-b/photo.jpg',
  };
  const handler = createStorageHandler(baseDeps({
    requireSession: () => ({ id: 'user-a', role: 'crew_member', businessId: 'biz-1', employeeId: 'emp-a' }),
    getFileForBusiness: async () => file,
    getTimeEntryForBusiness: async () => ({ id: 'entry-b', employeeId: 'emp-b', status: 'clocked_in' }),
  }));

  for (const action of ['prepare-download', 'complete-upload', 'delete']) {
    const res = createMockRes();
    await handler({ method: 'POST', body: { action, fileId: file.id } }, res);
    assert.equal(res.statusCode, 403, action);
  }
});
