import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackHandler } from '../api/feedback.js';

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
      businessName: 'OliveOps Demo',
      email: 'admin@example.com',
      name: 'Admin User',
    }),
    createFeedbackForBusiness: async () => ({ ok: true }),
    getFeedbackForBusiness: async () => null,
    getFileForBusiness: async () => null,
    createPresignedDownloadUrl: async () => ({ ok: false }),
    generateId: () => 'feedback-1',
    nowIso: () => '2026-08-06T12:00:00.000Z',
    notifySupportFeedback: async () => ({ ok: false, reason: 'not_configured' }),
    ...overrides,
  };
}

test('POST /api/feedback stores trusted session-scoped fields', async () => {
  let createdPayload;
  const handler = createFeedbackHandler(baseDeps({
    createFeedbackForBusiness: async (payload) => {
      createdPayload = payload;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/TestAgent' },
    body: {
      type: 'general',
      message: 'Great workflow overall.',
      route: '/dashboard',
      appVersion: '1.2.3',
      viewport: { width: 1440, height: 900 },
      businessId: 'spoofed-biz',
      submittedByUserId: 'spoofed-user',
      status: 'closed',
      priority: 'high',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, feedbackId: 'feedback-1', notificationSent: false });
  assert.equal(createdPayload.businessId, 'biz-1');
  assert.equal(createdPayload.feedback.businessId, 'biz-1');
  assert.equal(createdPayload.feedback.submittedByUserId, 'user-1');
  assert.equal(createdPayload.feedback.type, 'general');
  assert.equal(createdPayload.feedback.status, 'new');
  assert.equal(createdPayload.feedback.priority, 'normal');
});

test('POST /api/feedback rejects invalid type', async () => {
  const handler = createFeedbackHandler(baseDeps());
  const req = {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/TestAgent' },
    body: {
      type: 'incident',
      message: 'Unexpected behavior',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Invalid feedback type.');
});

test('POST /api/feedback requires message', async () => {
  const handler = createFeedbackHandler(baseDeps());
  const req = {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/TestAgent' },
    body: {
      type: 'bug',
      message: '   ',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Feedback message is required.');
});

test('POST /api/feedback succeeds even when support notification fails', async () => {
  let savedFeedbackId;
  const handler = createFeedbackHandler(baseDeps({
    createFeedbackForBusiness: async ({ feedback }) => {
      savedFeedbackId = feedback.id;
      return { ok: true };
    },
    notifySupportFeedback: async () => {
      throw new Error('mail provider unavailable');
    },
  }));

  const req = {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/TestAgent' },
    body: {
      type: 'usability',
      message: 'This workflow is hard to discover.',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.feedbackId, 'feedback-1');
  assert.equal(res.body.notificationSent, false);
  assert.equal(savedFeedbackId, 'feedback-1');
});

test('POST /api/feedback sets notificationSent true when notification succeeds', async () => {
  const handler = createFeedbackHandler(baseDeps({
    notifySupportFeedback: async () => ({ ok: true }),
  }));

  const req = {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/TestAgent' },
    body: {
      type: 'bug',
      message: 'Everything breaks on save.',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.feedbackId, 'feedback-1');
  assert.equal(res.body.notificationSent, true);
});

test('POST /api/feedback persists before email notification attempt', async () => {
  const callOrder = [];
  const handler = createFeedbackHandler(baseDeps({
    createFeedbackForBusiness: async () => {
      callOrder.push('save');
      return { ok: true };
    },
    notifySupportFeedback: async () => {
      callOrder.push('notify');
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/TestAgent' },
    body: {
      type: 'feature_request',
      message: 'Please add keyboard shortcuts.',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(callOrder, ['save', 'notify']);
});

test('POST /api/feedback defers notification until a screenshot upload is complete', async () => {
  let notifyCount = 0;
  const handler = createFeedbackHandler(baseDeps({
    notifySupportFeedback: async () => { notifyCount += 1; return { ok: true }; },
  }));
  const res = createMockRes();

  await handler({ method: 'POST', headers: {}, body: { type: 'bug', message: 'See screenshot.', deferNotification: true } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notificationSent, false);
  assert.equal(notifyCount, 0);
});

test('POST /api/feedback notify reloads the owned screenshot and sends a signed attachment', async () => {
  let notifyArgs;
  const handler = createFeedbackHandler(baseDeps({
    getFeedbackForBusiness: async () => ({
      id: 'feedback-1', businessId: 'biz-1', submittedByUserId: 'user-1', type: 'bug', message: 'See screenshot.', screenshotFileId: 'file-1',
    }),
    getFileForBusiness: async () => ({
      id: 'file-1', entityType: 'feedback', entityId: 'feedback-1', category: 'screenshot', uploadStatus: 'uploaded', objectKey: 'biz-1/file-1/screenshot.png', originalFileName: 'screenshot.png', mimeType: 'image/png',
    }),
    createPresignedDownloadUrl: async ({ businessId, key }) => ({ ok: businessId === 'biz-1' && key.startsWith('biz-1/'), downloadUrl: 'https://signed.example/screenshot.png' }),
    notifySupportFeedback: async (args) => { notifyArgs = args; return { ok: true }; },
  }));
  const res = createMockRes();

  await handler({ method: 'POST', headers: {}, body: { action: 'notify', feedbackId: 'feedback-1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(notifyArgs.attachment, {
    filename: 'screenshot.png',
    path: 'https://signed.example/screenshot.png',
    contentType: 'image/png',
  });
});

test('POST /api/feedback notify rejects another user feedback record', async () => {
  let notified = false;
  const handler = createFeedbackHandler(baseDeps({
    getFeedbackForBusiness: async () => ({ id: 'feedback-2', businessId: 'biz-1', submittedByUserId: 'user-2' }),
    notifySupportFeedback: async () => { notified = true; return { ok: true }; },
  }));
  const res = createMockRes();

  await handler({ method: 'POST', headers: {}, body: { action: 'notify', feedbackId: 'feedback-2' } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(notified, false);
});

test('POST /api/feedback client cannot override notification sender or recipient', async () => {
  let notifyArgs;
  const handler = createFeedbackHandler(baseDeps({
    notifySupportFeedback: async (args) => {
      notifyArgs = args;
      return { ok: true };
    },
  }));

  const req = {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/TestAgent' },
    body: {
      type: 'general',
      message: 'Feedback body text.',
      from: 'attacker@evil.test',
      to: 'attacker-target@evil.test',
      replyTo: 'attacker-reply@evil.test',
      FEEDBACK_FROM_EMAIL: 'attacker-fake@evil.test',
      FEEDBACK_NOTIFICATION_EMAIL: 'attacker-fake-target@evil.test',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(notifyArgs.feedback.from, undefined);
  assert.equal(notifyArgs.feedback.to, undefined);
  assert.equal(notifyArgs.feedback.replyTo, undefined);
  assert.equal(notifyArgs.feedback.FEEDBACK_FROM_EMAIL, undefined);
  assert.equal(notifyArgs.feedback.FEEDBACK_NOTIFICATION_EMAIL, undefined);
});

test('GET /api/feedback returns business-scoped feedback record by id', async () => {
  const handler = createFeedbackHandler(baseDeps({
    getFeedbackForBusiness: async (businessId, feedbackId) => ({
      id: feedbackId,
      businessId,
      type: 'bug',
      message: 'A bug report',
      status: 'new',
      priority: 'normal',
      createdAt: '2026-08-06T12:00:00.000Z',
      updatedAt: '2026-08-06T12:00:00.000Z',
    }),
  }));

  const req = {
    method: 'GET',
    query: {
      id: 'feedback-1',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.feedback.id, 'feedback-1');
  assert.equal(res.body.feedback.businessId, 'biz-1');
});

test('GET /api/feedback blocks crew_member from reading another user feedback record', async () => {
  const handler = createFeedbackHandler(baseDeps({
    requireSession: () => ({
      id: 'user-crew-1',
      role: 'crew_member',
      businessId: 'biz-1',
      businessName: 'OliveOps Demo',
      email: 'crew1@example.com',
      name: 'Crew One',
    }),
    getFeedbackForBusiness: async (businessId, feedbackId) => ({
      id: feedbackId,
      businessId,
      submittedByUserId: 'user-crew-2',
      type: 'bug',
      message: 'A bug report',
      status: 'new',
      priority: 'normal',
      createdAt: '2026-08-06T12:00:00.000Z',
      updatedAt: '2026-08-06T12:00:00.000Z',
    }),
  }));

  const req = {
    method: 'GET',
    query: {
      id: 'feedback-2',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Forbidden');
});
