import test from 'node:test';
import assert from 'node:assert/strict';

import { validateClockOutPhotoAttachment } from '../api/_lib/clocking.js';
import { buildClockOutPayload, applyUploadedPhotoAttachment, clearPhotoAttachmentState } from '../src/utils/clockingPhoto.js';
import { createStorageHandler } from '../api/storage.js';

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
    requireSession: () => ({ id: 'user-1', role: 'admin', businessId: 'biz-1', employeeId: 'emp-1' }),
    createPendingUploadPlan: () => ({ fileId: 'file-1', key: 'biz-1/file-1/photo.jpg', objectKey: 'biz-1/file-1/photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 100, expiresAt: '2026-08-06T10:10:00.000Z' }),
    createPresignedUploadUrl: async ({ plan }) => ({ ok: true, uploadUrl: `https://signed.example/upload/${plan.fileId}`, plan }),
    createPresignedDownloadUrl: async () => ({ ok: true, downloadUrl: 'https://signed.example/download' }),
    headStoredFile: async () => ({ ok: true, contentLength: 1024, contentType: 'image/jpeg', etag: 'etag-1' }),
    removeStoredFile: async () => ({ ok: true }),
    validateUploadPayload: () => ({ ok: true }),
    createAuditEventForBusiness: async () => ({ ok: true }),
    createPendingFileForBusiness: async () => ({ ok: true }),
    updateFileForBusiness: async () => ({ ok: true }),
    deleteFileForBusiness: async () => ({ ok: true }),
    getExpenseForBusiness: async () => ({ id: 'expense-1', vendor: 'Acme', description: 'd', category: 'other', expenseDate: '2026-01-01', amount: 10, status: 'pending', notes: '' }),
    getFileForBusiness: async () => null,
    getCustomerForBusiness: async () => null,
    getEstimateForBusiness: async () => null,
    getJobForBusiness: async () => null,
    getEmployeeForBusiness: async () => null,
    getTimeEntryForBusiness: async () => ({ id: 'time-1', employeeId: 'emp-1', status: 'clocked_in' }),
    listFilesForBusiness: async () => [],
    updateExpenseForBusiness: async () => ({ ok: true }),
    updateTimeEntryForBusiness: async () => ({ ok: true }),
    ...overrides,
  };
}

test('client clock-out payload carries the uploaded file ID', () => {
  const payload = buildClockOutPayload({ entryId: 'entry-1', notes: 'Done', photoAttachmentFileId: 'file-123' });

  assert.deepEqual(payload, {
    entryId: 'entry-1',
    breakMinutes: 0,
    notes: 'Done',
    photoAttachmentFileIds: ['file-123'],
    photoAttachmentFileId: 'file-123',
  });
});

test('client clock-out payload carries multiple uploaded file IDs', () => {
  const payload = buildClockOutPayload({
    entryId: 'entry-1',
    notes: 'Done',
    photoAttachmentFileIds: ['file-1', 'file-2', 'file-1'],
  });

  assert.deepEqual(payload, {
    entryId: 'entry-1',
    breakMinutes: 0,
    notes: 'Done',
    photoAttachmentFileIds: ['file-1', 'file-2'],
    photoAttachmentFileId: 'file-1',
  });
});

test('uploaded photo state keeps the file ID after the upload succeeds', () => {
  const state = applyUploadedPhotoAttachment(clearPhotoAttachmentState(), { fileId: 'file-123', fileName: 'job-photo.jpg' });

  assert.equal(state.fileId, 'file-123');
  assert.equal(state.fileName, 'job-photo.jpg');
});

test('storage complete-upload persists the uploaded file metadata for the attachment', async () => {
  const updatedFile = {};
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'time-entry',
      entityId: 'time-1',
      category: 'clock-out-photo',
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
      Object.assign(updatedFile, updates);
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
  assert.equal(updatedFile.uploadStatus, 'uploaded');
  assert.equal(updatedFile.objectKey, 'biz-1/file-1/photo.jpg');
  assert.equal(updatedFile.expectedContentType, 'image/jpeg');
  assert.equal(updatedFile.timeEntryId, 'time-1');
});

test('storage complete-upload enriches the same photo record with contextual Job identity', async () => {
  const updates = [];
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1', businessId: 'biz-1', entityType: 'time-entry', entityId: 'time-1', category: 'clock-out-photo',
      fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, expectedContentType: 'image/jpeg', expectedFileSize: 1024,
      objectKey: 'biz-1/file-1/photo.jpg', uploadStatus: 'pending',
    }),
    getTimeEntryForBusiness: async () => ({ id: 'time-1', employeeId: 'emp-1', jobId: 'job-1', jobIds: ['job-1'], workType: 'drive_time', status: 'clocked_in' }),
    updateFileForBusiness: async (input) => { updates.push(input); return { ok: true }; },
  }));

  const res = createMockRes();
  await handler({ method: 'POST', body: { action: 'complete-upload', fileId: 'file-1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(new Set(updates.map((item) => item.fileId)).size, 1, 'one file record must be updated, not duplicated');
  assert.deepEqual(updates.at(-1).updates, { timeEntryId: 'time-1', jobId: 'job-1' });
});

test('storage complete-upload supports clock-in photo attachment with fileId-only payload', async () => {
  let updatedTimeEntry;
  const handler = createStorageHandler(baseDeps({
    getFileForBusiness: async () => ({
      id: 'file-1',
      businessId: 'biz-1',
      entityType: 'time-entry',
      entityId: 'time-1',
      category: 'clock-in-photo',
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
    updateTimeEntryForBusiness: async ({ timeEntry }) => {
      updatedTimeEntry = timeEntry;
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
  assert.equal(res.body.fileId, 'file-1');
  assert.equal(updatedTimeEntry.clockInPhotoFileId, 'file-1');
});

test('clock-out attachment validation rejects a file from another business', async () => {
  const result = await validateClockOutPhotoAttachment({
    session: { businessId: 'biz-1', role: 'admin' },
    timeEntryId: 'time-1',
    photoAttachmentFileId: 'file-1',
    getFileForBusiness: async () => ({ id: 'file-1', businessId: 'biz-2', entityType: 'time-entry', entityId: 'time-1', uploadStatus: 'uploaded' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'Forbidden');
});

test('clock-out attachment validation rejects a file for a different entity', async () => {
  const result = await validateClockOutPhotoAttachment({
    session: { businessId: 'biz-1', role: 'admin' },
    timeEntryId: 'time-1',
    photoAttachmentFileId: 'file-1',
    getFileForBusiness: async () => ({ id: 'file-1', businessId: 'biz-1', entityType: 'time-entry', entityId: 'time-2', uploadStatus: 'uploaded' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'Attachment does not match the current time entry.');
});

test('clock-out attachment validation rejects a file that is not marked uploaded', async () => {
  const result = await validateClockOutPhotoAttachment({
    session: { businessId: 'biz-1', role: 'admin' },
    timeEntryId: 'time-1',
    photoAttachmentFileId: 'file-1',
    getFileForBusiness: async () => ({ id: 'file-1', businessId: 'biz-1', entityType: 'time-entry', entityId: 'time-1', uploadStatus: 'processing' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'Attachment upload is not complete.');
});

test('clock-out attachment validation accepts a matching uploaded file', async () => {
  const result = await validateClockOutPhotoAttachment({
    session: { businessId: 'biz-1', role: 'admin' },
    timeEntryId: 'time-1',
    photoAttachmentFileId: 'file-1',
    getFileForBusiness: async () => ({ id: 'file-1', businessId: 'biz-1', entityType: 'time-entry', entityId: 'time-1', uploadStatus: 'uploaded' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.fileId, 'file-1');
  assert.deepEqual(result.fileIds, ['file-1']);
});

test('clock-out attachment validation accepts multiple matching uploaded files', async () => {
  const result = await validateClockOutPhotoAttachment({
    session: { businessId: 'biz-1', role: 'admin' },
    timeEntryId: 'time-1',
    photoAttachmentFileIds: ['file-1', 'file-2'],
    getFileForBusiness: async (_businessId, fileId) => ({
      id: fileId,
      businessId: 'biz-1',
      entityType: 'time-entry',
      entityId: 'time-1',
      uploadStatus: 'uploaded',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.fileId, 'file-1');
  assert.deepEqual(result.fileIds, ['file-1', 'file-2']);
});

test('clock-out attachment validation rejects more than five files', async () => {
  const result = await validateClockOutPhotoAttachment({
    session: { businessId: 'biz-1', role: 'admin' },
    timeEntryId: 'time-1',
    photoAttachmentFileIds: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
    getFileForBusiness: async () => ({
      id: 'f1',
      businessId: 'biz-1',
      entityType: 'time-entry',
      entityId: 'time-1',
      uploadStatus: 'uploaded',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /maximum of 5 photos/i);
});
