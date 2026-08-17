import {
  createFeedbackForBusiness,
  generateId,
  getFileForBusiness,
  getFeedbackForBusiness,
} from './_lib/authRepo.js';
import { notifySupportFeedbackWithResend } from './_lib/feedbackNotifications.js';
import { requireSession } from './_lib/session.js';
import { createPresignedDownloadUrl } from './_lib/storage.js';

const ALLOWED_FEEDBACK_TYPES = new Set(['bug', 'feature_request', 'usability', 'general']);
const ALLOWED_DEVICE_CATEGORIES = new Set(['mobile', 'tablet', 'desktop', 'unknown']);

function nowIso() {
  return new Date().toISOString();
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

function sanitizeOptionalString(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function sanitizeRoute(value) {
  const route = sanitizeOptionalString(value, 300);
  if (!route) return undefined;
  return route.startsWith('/') ? route : undefined;
}

function sanitizeViewport(value) {
  if (!value || typeof value !== 'object') return undefined;

  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;

  const safeWidth = Math.max(0, Math.min(10000, Math.round(width)));
  const safeHeight = Math.max(0, Math.min(10000, Math.round(height)));
  if (safeWidth === 0 || safeHeight === 0) return undefined;

  return { width: safeWidth, height: safeHeight };
}

function deriveDeviceCategory(viewportWidth) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 'unknown';
  if (viewportWidth < 768) return 'mobile';
  if (viewportWidth < 1024) return 'tablet';
  return 'desktop';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const defaultDeps = {
  requireSession,
  createFeedbackForBusiness,
  getFeedbackForBusiness,
  getFileForBusiness,
  createPresignedDownloadUrl,
  generateId,
  nowIso,
  notifySupportFeedback: notifySupportFeedbackWithResend,
};

export function createFeedbackHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };

  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const session = await deps.requireSession(req, res, ['owner', 'admin', 'foreman', 'crew_member']);
    if (!session) return;

    if (req.method === 'GET') {
      const feedbackId = typeof req.query?.id === 'string' ? req.query.id.trim() : '';
      if (!feedbackId) {
        return res.status(400).json({ ok: false, error: 'Feedback ID is required.' });
      }

      try {
        const feedback = await deps.getFeedbackForBusiness(session.businessId, feedbackId);
        if (!feedback) {
          return res.status(404).json({ ok: false, error: 'Feedback not found.' });
        }

        const role = session.role === 'employee' ? 'crew_member' : session.role;
        if (role === 'crew_member' && feedback.submittedByUserId !== session.id) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }

        return res.status(200).json({ ok: true, feedback });
      } catch {
        return res.status(500).json({ ok: false, error: 'Could not load feedback.' });
      }
    }

    const body = parseJsonBody(req);
    if (!body) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON request body.' });
    }

    if (body.action === 'notify') {
      const feedbackId = sanitizeOptionalString(body.feedbackId, 100);
      if (!feedbackId) return res.status(400).json({ ok: false, error: 'Feedback ID is required.' });

      try {
        const feedback = await deps.getFeedbackForBusiness(session.businessId, feedbackId);
        if (!feedback) return res.status(404).json({ ok: false, error: 'Feedback not found.' });
        if (feedback.submittedByUserId !== session.id) return res.status(403).json({ ok: false, error: 'Forbidden' });

        let attachment;
        if (feedback.screenshotFileId) {
          const file = await deps.getFileForBusiness(session.businessId, feedback.screenshotFileId);
          if (file?.uploadStatus === 'uploaded'
            && file.entityType === 'feedback'
            && file.entityId === feedback.id
            && file.category === 'screenshot') {
            const download = await deps.createPresignedDownloadUrl({
              businessId: session.businessId,
              key: file.objectKey ?? file.key,
            });
            if (download.ok && download.downloadUrl) {
              attachment = {
                filename: file.originalFileName ?? file.fileName ?? 'feedback-screenshot',
                path: download.downloadUrl,
                contentType: file.mimeType,
              };
            }
          }
        }

        const result = await deps.notifySupportFeedback({ feedback, session, attachment });
        return res.status(result?.ok ? 200 : 502).json({
          ok: Boolean(result?.ok),
          notificationSent: Boolean(result?.ok),
          error: result?.ok ? undefined : 'Feedback was saved, but the support email could not be sent.',
        });
      } catch {
        return res.status(500).json({ ok: false, error: 'Feedback was saved, but the support email could not be sent.' });
      }
    }

    const type = sanitizeOptionalString(body.type, 40);
    const message = sanitizeOptionalString(body.message, 5000);
    if (!type || !ALLOWED_FEEDBACK_TYPES.has(type)) {
      return res.status(400).json({ ok: false, error: 'Invalid feedback type.' });
    }

    if (!message) {
      return res.status(400).json({ ok: false, error: 'Feedback message is required.' });
    }

    const contactPreference = Boolean(body.contactPreference);
    const contactEmail = sanitizeOptionalString(body.contactEmail, 320)?.toLowerCase();
    if (contactEmail && !isValidEmail(contactEmail)) {
      return res.status(400).json({ ok: false, error: 'Invalid contact email.' });
    }

    const viewport = sanitizeViewport(body.viewport);
    const providedDeviceCategory = sanitizeOptionalString(body.deviceCategory, 20);
    const normalizedDeviceCategory = providedDeviceCategory && ALLOWED_DEVICE_CATEGORIES.has(providedDeviceCategory)
      ? providedDeviceCategory
      : deriveDeviceCategory(viewport?.width ?? 0);

    const userAgentHeader = Array.isArray(req.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers?.['user-agent'];

    const createdAt = deps.nowIso();
    const feedbackId = deps.generateId();
    const feedback = {
      id: feedbackId,
      businessId: session.businessId,
      submittedByUserId: session.id,
      submittedByRole: session.role,
      type,
      message,
      route: sanitizeRoute(body.route),
      userAgent: sanitizeOptionalString(userAgentHeader, 800) ?? 'unknown',
      viewport,
      deviceCategory: normalizedDeviceCategory,
      appVersion: sanitizeOptionalString(body.appVersion, 100) ?? 'unknown',
      status: 'new',
      priority: 'normal',
      screenshotFileId: undefined,
      contactPreference,
      contactEmail,
      createdAt,
      updatedAt: createdAt,
    };

    try {
      await deps.createFeedbackForBusiness({
        businessId: session.businessId,
        feedback,
      });

      let notificationSent = false;

      try {
        const notifyResult = body.deferNotification === true
          ? { ok: false, reason: 'deferred' }
          : await deps.notifySupportFeedback({ feedback, session });
        notificationSent = Boolean(notifyResult?.ok);
        if (!notifyResult?.ok && notifyResult?.reason !== 'deferred') {
          console.warn('[feedback:notify]', {
            feedbackId,
            reason: notifyResult?.reason ?? notifyResult?.error ?? 'notification_failed',
          });
        }
      } catch (error) {
        console.warn('[feedback:notify]', {
          feedbackId,
          reason: error?.message ?? 'notification_failed',
        });
      }

      return res.status(200).json({ ok: true, feedbackId, notificationSent });
    } catch {
      return res.status(500).json({ ok: false, error: 'Could not submit feedback.' });
    }
  };
}

export default createFeedbackHandler();
