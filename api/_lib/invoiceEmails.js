import { Resend } from 'resend';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(String(value ?? '').trim());
const mailbox = (value) => String(/<([^>]+)>$/.exec(value)?.[1] || value).trim();
const senderName = (value) => String(value ?? '').replace(/[<>"\r\n]/g, '').trim() || 'Contractor';
const money = (value) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) || 0);
const date = (value) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`));
const inlineLogo = (value) => {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const extension = match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  return { contentId: 'company-logo', filename: `company-logo.${extension}`, content: Buffer.from(match[2].replace(/\s/g, ''), 'base64'), contentType: extension === 'png' ? 'image/png' : 'image/jpeg' };
};

export function invoiceEmailConfiguration(env = process.env) {
  const from = String(env.INVOICE_FROM_EMAIL || env.PROPOSAL_FROM_EMAIL || env.AUTH_FROM_EMAIL || '').trim();
  if (!env.RESEND_API_KEY || !validEmail(mailbox(from))) return { ok: false, reason: 'not_configured', message: 'Invoice email delivery is not configured.' };
  return { ok: true, from };
}

export function createInvoiceMailer({ resendClient, env = process.env } = {}) {
  return { async sendInvoice({ to, customerName, company, invoice, viewUrl, idempotencyKey }) {
    const configuration = invoiceEmailConfiguration(env);
    if (!configuration.ok) return configuration;
    if (!validEmail(to)) return { ok: false, reason: 'invalid_recipient', message: 'A valid customer email is required.' };
    const resend = resendClient ?? new Resend(env.RESEND_API_KEY);
    const contractor = senderName(company.name);
    const firstName = String(customerName ?? '').trim().split(/\s+/)[0];
    const logo = inlineLogo(company.logoDataUrl);
    const from = `${contractor} via OliveOps <${mailbox(configuration.from)}>`;
    const replyTo = validEmail(company.email) ? company.email : undefined;
    const subject = `Invoice from ${contractor} – ${invoice.number}`;
    const text = `${contractor}\n\nYour invoice is ready\n\n${firstName ? `Hi ${firstName},` : 'Hello,'}\n\n${invoice.jobTitle}\nInvoice #${invoice.number}\nAmount due: ${money(invoice.balanceDue)}\nDue: ${date(invoice.dueDate)}\n\nView Invoice: ${viewUrl}\n\nPayment is made directly to ${contractor}; OliveOps does not process payments.`;
    const logoCell = logo ? `<td style="width:96px;padding-right:16px"><img src="cid:company-logo" alt="${escapeHtml(contractor)} logo" style="max-width:80px;max-height:52px"></td>` : '';
    const html = `<div style="background:#f4f7f4;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937"><div style="max-width:620px;margin:auto;background:white;border:1px solid #dce5dd;border-radius:8px;overflow:hidden"><div style="background:#365b43;padding:22px 28px;color:white"><table role="presentation"><tr>${logoCell}<td style="font-size:20px;font-weight:700">${escapeHtml(contractor)}</td></tr></table></div><div style="padding:30px 28px"><p style="color:#365b43;font-size:13px;font-weight:700;text-transform:uppercase">Your invoice is ready</p><p>${escapeHtml(firstName ? `Hi ${firstName},` : 'Hello,')}</p><h1 style="font-size:24px;color:#17261c">${escapeHtml(invoice.jobTitle)}</h1><p>Invoice #${escapeHtml(invoice.number)}</p><p>Amount due: <strong>${escapeHtml(money(invoice.balanceDue))}</strong><br>Due: <strong>${escapeHtml(date(invoice.dueDate))}</strong></p><p style="margin:26px 0"><a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#365b43;color:white;padding:12px 20px;text-decoration:none;border-radius:6px;font-weight:700">View Invoice</a></p><p style="font-size:13px;color:#64748b">Payment is made directly to ${escapeHtml(contractor)}. OliveOps does not process payments.</p></div></div></div>`;
    try {
      const result = await resend.emails.send({ from, to, subject, text, html, ...(replyTo ? { replyTo } : {}), ...(logo ? { attachments: [logo] } : {}) }, idempotencyKey ? { idempotencyKey } : undefined);
      const providerMessageId = String(result?.data?.id || result?.id || '').trim();
      if (result?.error || !providerMessageId) return { ok: false, reason: 'provider_rejected', message: String(result?.error?.message || 'Resend did not accept the Invoice email.').slice(0, 500) };
      return { ok: true, providerMessageId };
    } catch (error) { return { ok: false, reason: 'provider_error', message: error instanceof Error ? error.message.slice(0, 500) : 'Invoice email delivery failed.' }; }
  } };
}

export const invoiceMailer = createInvoiceMailer();