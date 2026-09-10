import { Resend } from 'resend';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const emailAddress = (value) => String(value ?? '').trim();
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(emailAddress(value));
const validFromAddress = (value) => {
  const match = /<([^>]+)>$/.exec(value);
  return validEmail(match ? match[1] : value);
};
const fromMailbox = (value) => emailAddress(/<([^>]+)>$/.exec(value)?.[1] || value);
const senderName = (value) => String(value ?? '').replace(/[<>"\r\n]/g, '').trim() || 'Contractor';
const customerFirstName = (value) => String(value ?? '').trim().split(/\s+/)[0] || '';
const inlineLogo = (value) => {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const extension = match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  return {
    contentId: 'company-logo',
    filename: `company-logo.${extension}`,
    content: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
    contentType: extension === 'png' ? 'image/png' : 'image/jpeg',
  };
};

export function proposalEmailConfiguration(env = process.env) {
  const from = emailAddress(env.PROPOSAL_FROM_EMAIL || env.AUTH_FROM_EMAIL || env.FEEDBACK_FROM_EMAIL);
  if (!emailAddress(env.RESEND_API_KEY)) return { ok: false, reason: 'not_configured', message: 'Proposal email delivery is not configured: RESEND_API_KEY is missing.' };
  if (!from) return { ok: false, reason: 'not_configured', message: 'Proposal email delivery is not configured: PROPOSAL_FROM_EMAIL is missing.' };
  if (!validFromAddress(from)) return { ok: false, reason: 'not_configured', message: 'Proposal email delivery is not configured: PROPOSAL_FROM_EMAIL is invalid.' };
  return { ok: true, from };
}

const formatDate = (value) => {
  const date = new Date(`${String(value ?? '').slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
};

export function createProposalMailer({ resendClient, env = process.env } = {}) {
  return {
    configuration() {
      return proposalEmailConfiguration(env);
    },
    async sendProposal({ to, customerName, companyName, companyPhone, companyEmail, companyLogoDataUrl, proposalTitle, proposalNumber, proposalTotal, validUntil, viewUrl, idempotencyKey }) {
      const configuration = proposalEmailConfiguration(env);
      if (!configuration.ok) return configuration;
      if (!validEmail(to)) return { ok: false, reason: 'invalid_recipient', message: 'A valid customer email is required.' };
      const resend = resendClient ?? new Resend(env.RESEND_API_KEY);
      const amount = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(proposalTotal);
      const validUntilText = formatDate(validUntil);
      const contractorName = senderName(companyName);
      const from = `${contractorName} via OliveOps <${fromMailbox(configuration.from)}>`;
      const replyTo = validEmail(companyEmail) ? emailAddress(companyEmail) : '';
      const logo = inlineLogo(companyLogoDataUrl);
      const subject = `Proposal from ${contractorName} – ${proposalTitle}`;
      const firstName = customerFirstName(customerName);
      const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
      const contact = [companyPhone, replyTo].filter(Boolean).join('\n');
      const text = `${contractorName}\n\nYour proposal is ready\n\n${greeting}\n\nThank you for the opportunity to provide a proposal for your project.\n\n${proposalTitle}${proposalNumber ? `\nProposal # ${proposalNumber}` : ''}\nTotal: ${amount}${validUntilText ? `\nValid until: ${validUntilText}` : ''}\n\nView Proposal: ${viewUrl}\n\nYou can securely review the scope of work, payment schedule, terms and conditions, and accept it online.${contact ? `\n\nQuestions?\n${contact}` : ''}\n\nProposal powered by OliveOps`;
      const detailRows = `${proposalNumber ? `<tr><td style="padding:4px 16px 4px 0;color:#64748b">Proposal #</td><td style="padding:4px 0;font-weight:600">${escapeHtml(proposalNumber)}</td></tr>` : ''}<tr><td style="padding:4px 16px 4px 0;color:#64748b">Total</td><td style="padding:4px 0;font-weight:600">${escapeHtml(amount)}</td></tr>${validUntilText ? `<tr><td style="padding:4px 16px 4px 0;color:#64748b">Valid until</td><td style="padding:4px 0;font-weight:600">${escapeHtml(validUntilText)}</td></tr>` : ''}`;
      const logoCell = logo ? `<td style="width:96px;padding:0 16px 0 0;vertical-align:middle"><img src="cid:company-logo" alt="${escapeHtml(contractorName)} logo" width="80" style="display:block;width:auto;max-width:80px;height:auto;max-height:52px;border:0"></td>` : '';
      const html = `<div style="background:#f4f7f4;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;line-height:1.6"><div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dce5dd;border-radius:8px;overflow:hidden"><div style="background:#365b43;padding:22px 28px;color:#ffffff"><table role="presentation" width="100%" style="border-collapse:collapse"><tr>${logoCell}<td style="vertical-align:middle;font-size:20px;font-weight:700">${escapeHtml(contractorName)}</td></tr></table></div><div style="padding:30px 28px"><p style="margin:0 0 8px;color:#365b43;font-size:13px;font-weight:700;text-transform:uppercase">Your proposal is ready</p><p style="margin:0 0 20px">${escapeHtml(greeting)}</p><p style="margin:0 0 24px">Thank you for the opportunity to provide a proposal for your project.</p><h1 style="font-size:24px;line-height:1.25;margin:0 0 14px;color:#17261c">${escapeHtml(proposalTitle)}</h1><table role="presentation" style="border-collapse:collapse;margin:0 0 26px;font-size:14px">${detailRows}</table><p style="margin:0 0 26px"><a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#365b43;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px;font-weight:700">View Proposal</a></p><p style="margin:0 0 24px;color:#475569">You can securely review the scope of work, payment schedule, terms and conditions, and accept it online.</p>${contact ? `<div style="border-top:1px solid #e2e8f0;padding-top:18px;font-size:13px;color:#64748b"><strong style="color:#334155">Questions?</strong>${companyPhone ? `<br>${escapeHtml(companyPhone)}` : ''}${replyTo ? `<br><a href="mailto:${escapeHtml(replyTo)}" style="color:#365b43">${escapeHtml(replyTo)}</a>` : ''}</div>` : ''}</div></div><p style="max-width:620px;margin:12px auto 0;text-align:center;font-size:11px;color:#64748b">Proposal powered by OliveOps<br>This secure link is intended for the proposal recipient.</p></div>`;
      try {
        const result = await resend.emails.send({ from, to, subject, text, html, ...(replyTo ? { replyTo } : {}), ...(logo ? { attachments: [logo] } : {}) }, idempotencyKey ? { idempotencyKey } : undefined);
        if (result?.error) return { ok: false, reason: 'provider_rejected', message: String(result.error.message || 'Resend rejected the Proposal email.').slice(0, 500) };
        const providerMessageId = String(result?.data?.id || result?.id || '').trim();
        if (!providerMessageId) return { ok: false, reason: 'provider_rejected', message: 'Resend did not accept the Proposal email.' };
        return { ok: true, providerMessageId };
      } catch (error) {
        return { ok: false, reason: 'provider_error', message: error instanceof Error ? error.message.slice(0, 500) : 'Proposal email delivery failed.' };
      }
    },
  };
}

export const proposalMailer = createProposalMailer();