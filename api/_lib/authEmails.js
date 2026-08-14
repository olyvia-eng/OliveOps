import { Resend } from 'resend';

function getConfig(env) {
  const from = env.AUTH_FROM_EMAIL || env.FEEDBACK_FROM_EMAIL;
  const origin = env.APP_ORIGIN;
  if (!env.RESEND_API_KEY || !from || !origin) return null;

  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return { from, origin: url.origin, supportEmail: env.SUPPORT_EMAIL || from };
  } catch {
    return null;
  }
}

export function createResendAuthMailer({ resendClient, env = process.env } = {}) {
  async function send(payload) {
    const config = getConfig(env);
    if (!config) return { ok: false, reason: 'not_configured' };
    const resend = resendClient ?? new Resend(env.RESEND_API_KEY);
    try {
      const result = await resend.emails.send({ from: config.from, ...payload });
      return result?.error ? { ok: false, reason: 'send_failed' } : { ok: true };
    } catch {
      return { ok: false, reason: 'send_failed' };
    }
  }

  return {
    async sendPasswordReset({ email, token }) {
      const config = getConfig(env);
      if (!config) return { ok: false, reason: 'not_configured' };
      const resetUrl = new URL('/reset-password', config.origin);
      resetUrl.searchParams.set('token', token);
      const text = `Reset your OliveOps password: ${resetUrl.toString()}\n\nThis link expires in 60 minutes. If you did not request this, you can ignore this email. For help, contact ${config.supportEmail}.`;
      const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h1 style="color:#166534">OliveOps</h1><p>We received a request to reset your password.</p><p><a href="${resetUrl.toString()}" style="display:inline-block;background:#166534;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-weight:600">Reset Password</a></p><p>This link expires in 60 minutes. If you did not request this, you can ignore this email.</p><p>Need help? Contact ${config.supportEmail}.</p></div>`;
      return send({ to: email, subject: 'Reset your OliveOps password', text, html });
    },
    async sendPasswordChanged({ email }) {
      const config = getConfig(env);
      if (!config) return { ok: false, reason: 'not_configured' };
      const text = `Your OliveOps password was changed successfully. If you did not make this change, contact ${config.supportEmail} immediately.`;
      const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h1 style="color:#166534">OliveOps</h1><p>Your password was changed successfully.</p><p>If you did not make this change, contact ${config.supportEmail} immediately.</p></div>`;
      return send({ to: email, subject: 'Your OliveOps password was changed', text, html });
    },
  };
}

export const authMailer = createResendAuthMailer();