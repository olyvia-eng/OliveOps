import { Resend } from 'resend';

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatFeedbackType(type) {
  if (typeof type !== 'string' || !type.trim()) return 'General';
  return type
    .trim()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function stringifyOptional(value) {
  if (value === undefined || value === null || value === '') return 'N/A';
  return String(value);
}

function buildFeedbackEmailText({ feedback, session }) {
  const screenshotAttached = feedback?.screenshotFileId ? 'Yes' : 'No';
  return [
    `Feedback ID: ${stringifyOptional(feedback?.id)}`,
    `Type: ${formatFeedbackType(feedback?.type)}`,
    `Message: ${stringifyOptional(feedback?.message)}`,
    `Business Name: ${stringifyOptional(session?.businessName)}`,
    `Business ID: ${stringifyOptional(feedback?.businessId ?? session?.businessId)}`,
    `Submitting User: ${stringifyOptional(session?.name)} (${stringifyOptional(session?.email)}) [${stringifyOptional(session?.id)}]`,
    `Role: ${stringifyOptional(session?.role)}`,
    `Route: ${stringifyOptional(feedback?.route)}`,
    `Timestamp: ${stringifyOptional(feedback?.createdAt)}`,
    `Screenshot Attached: ${screenshotAttached}`,
  ].join('\n');
}

export function createResendFeedbackNotifier(options = {}) {
  const {
    resendClient,
    env = process.env,
  } = options;

  return async function notifySupportFeedback({ feedback, session, attachment }) {
    const apiKey = env.RESEND_API_KEY;
    const notificationEmail = env.FEEDBACK_NOTIFICATION_EMAIL;
    const fromEmail = env.FEEDBACK_FROM_EMAIL;

    if (!apiKey || !notificationEmail || !fromEmail) {
      return { ok: false, reason: 'not_configured' };
    }

    const resend = resendClient ?? new Resend(apiKey);
    const subject = `[OliveOps Feedback] ${formatFeedbackType(feedback?.type)} — ${session?.businessName || session?.businessId || 'Unknown Business'}`;
    const text = buildFeedbackEmailText({ feedback, session });

    try {
      const payload = {
        from: fromEmail,
        to: notificationEmail,
        subject,
        text,
      };

      if (isValidEmail(session?.email)) {
        payload.replyTo = session.email;
      }
      if (attachment?.filename && attachment?.path) {
        payload.attachments = [attachment];
      }

      const result = await resend.emails.send(payload);
      if (result?.error) {
        return { ok: false, reason: 'send_failed' };
      }

      return { ok: true };
    } catch {
      return { ok: false, reason: 'send_failed' };
    }
  };
}

export const notifySupportFeedbackWithResend = createResendFeedbackNotifier();
