import { Resend } from 'resend';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function createProposalMailer({ resendClient, env = process.env } = {}) {
  return {
    async sendProposal({ to, companyName, proposalTitle, proposalNumber, proposalTotal, viewUrl }) {
      const from = env.PROPOSAL_FROM_EMAIL || env.AUTH_FROM_EMAIL || env.FEEDBACK_FROM_EMAIL;
      if (!env.RESEND_API_KEY || !from) return { ok: false, reason: 'not_configured' };
      const resend = resendClient ?? new Resend(env.RESEND_API_KEY);
      const amount = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(proposalTotal);
      const subject = `${companyName} proposal${proposalNumber ? ` ${proposalNumber}` : ''}: ${proposalTitle}`;
      const text = `${companyName} has sent you a proposal for ${proposalTitle}.\n\nProposal total: ${amount}\n\nReview and accept securely: ${viewUrl}`;
      const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:600px"><p style="font-size:13px;color:#64748b;margin:0 0 8px">${escapeHtml(companyName)}</p><h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(proposalTitle)}</h1><p>Proposal total: <strong>${escapeHtml(amount)}</strong></p><p><a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#365b43;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-weight:600">View Proposal</a></p><p style="font-size:12px;color:#64748b">This secure link is intended for the proposal recipient.</p></div>`;
      try {
        const result = await resend.emails.send({ from, to, subject, text, html });
        return result?.error ? { ok: false, reason: 'send_failed' } : { ok: true };
      } catch {
        return { ok: false, reason: 'send_failed' };
      }
    },
  };
}

export const proposalMailer = createProposalMailer();
