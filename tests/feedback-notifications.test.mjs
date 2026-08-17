import test from 'node:test';
import assert from 'node:assert/strict';
import { createResendFeedbackNotifier } from '../api/_lib/feedbackNotifications.js';

function buildSamplePayload(overrides = {}) {
  return {
    feedback: {
      id: 'feedback-1',
      businessId: 'biz-1',
      type: 'feature_request',
      message: 'Please add a quick-actions panel.',
      route: '/dashboard',
      createdAt: '2026-08-06T12:00:00.000Z',
      screenshotFileId: undefined,
      ...overrides.feedback,
    },
    session: {
      id: 'user-1',
      businessId: 'biz-1',
      businessName: 'OliveOps Demo',
      name: 'Admin User',
      email: 'admin@oliveops.ca',
      role: 'admin',
      ...overrides.session,
    },
  };
}

test('missing RESEND_API_KEY is handled without throwing', async () => {
  const mockResendClient = {
    emails: {
      send: async () => {
        throw new Error('should not be called');
      },
    },
  };

  const notify = createResendFeedbackNotifier({
    resendClient: mockResendClient,
    env: {
      FEEDBACK_NOTIFICATION_EMAIL: 'support@oliveops.ca',
      FEEDBACK_FROM_EMAIL: 'OliveOps Feedback <notifications@oliveops.ca>',
    },
  });

  const result = await notify(buildSamplePayload());

  assert.deepEqual(result, { ok: false, reason: 'not_configured' });
});

test('recipient and sender are sourced from environment variables only', async () => {
  let sentPayload;
  const mockResendClient = {
    emails: {
      send: async (payload) => {
        sentPayload = payload;
        return { id: 'mail-1' };
      },
    },
  };

  const notify = createResendFeedbackNotifier({
    resendClient: mockResendClient,
    env: {
      RESEND_API_KEY: 're_test_key',
      FEEDBACK_NOTIFICATION_EMAIL: 'support@oliveops.ca',
      FEEDBACK_FROM_EMAIL: 'OliveOps Feedback <notifications@oliveops.ca>',
    },
  });

  const payload = buildSamplePayload({
    feedback: {
      to: 'attacker-target@evil.test',
      from: 'attacker-from@evil.test',
      replyTo: 'attacker-reply@evil.test',
    },
  });

  const result = await notify(payload);

  assert.equal(result.ok, true);
  assert.equal(sentPayload.to, 'support@oliveops.ca');
  assert.equal(sentPayload.from, 'OliveOps Feedback <notifications@oliveops.ca>');
  assert.equal(sentPayload.replyTo, 'admin@oliveops.ca');
  assert.match(sentPayload.subject, /^\[OliveOps Feedback\] Feature Request — OliveOps Demo$/);
});

test('invalid trusted user email omits replyTo', async () => {
  let sentPayload;
  const mockResendClient = {
    emails: {
      send: async (payload) => {
        sentPayload = payload;
        return { id: 'mail-2' };
      },
    },
  };

  const notify = createResendFeedbackNotifier({
    resendClient: mockResendClient,
    env: {
      RESEND_API_KEY: 're_test_key',
      FEEDBACK_NOTIFICATION_EMAIL: 'support@oliveops.ca',
      FEEDBACK_FROM_EMAIL: 'OliveOps Feedback <notifications@oliveops.ca>',
    },
  });

  const result = await notify(buildSamplePayload({
    session: { email: 'not-an-email' },
  }));

  assert.equal(result.ok, true);
  assert.equal('replyTo' in sentPayload, false);
});

test('uploaded screenshot is attached to the support email', async () => {
  let sentPayload;
  const notify = createResendFeedbackNotifier({
    resendClient: { emails: { send: async (payload) => { sentPayload = payload; return { id: 'mail-3' }; } } },
    env: {
      RESEND_API_KEY: 're_test_key',
      FEEDBACK_NOTIFICATION_EMAIL: 'support@oliveops.ca',
      FEEDBACK_FROM_EMAIL: 'OliveOps Feedback <notifications@oliveops.ca>',
    },
  });

  const result = await notify({
    ...buildSamplePayload({ feedback: { screenshotFileId: 'file-1' } }),
    attachment: { filename: 'bug.png', path: 'https://signed.example/bug.png', contentType: 'image/png' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(sentPayload.attachments, [{ filename: 'bug.png', path: 'https://signed.example/bug.png', contentType: 'image/png' }]);
  assert.match(sentPayload.text, /Screenshot Attached: Yes/);
});
