import { jsPDF } from 'jspdf';

const PAGE_WIDTH = 612;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = 748;
const NAVY = [28, 43, 58];
const OLIVE = [91, 112, 72];
const MUTED = [92, 103, 112];
const DIVIDER = [220, 224, 226];

const clean = (value) => Array.from(String(value ?? '')).filter((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127);
}).join('').trim();
const currency = (value) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
const date = (value) => value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';

export function proposalPdfFileName(projection, accepted = false) {
  const safe = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [accepted ? 'accepted-proposal' : 'proposal', safe(projection.proposal.number), safe(projection.proposal.title)].filter(Boolean).join('-') + '.pdf';
}

export async function fetchEstimateProposal(estimateId) {
  const response = await fetch(`/api/estimate-proposal?estimateId=${encodeURIComponent(estimateId)}`, { credentials: 'include' });
  const payload = await response.json();
  if (!response.ok || !payload.ok || !payload.proposal) throw new Error(payload.error || 'Proposal could not be generated.');
  return payload.proposal;
}

export function createEstimateProposalDocument(projection, options = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: false });
  let cursorY = MARGIN;
  const setText = (size, color = NAVY, style = 'normal') => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const lines = (value, width) => doc.splitTextToSize(clean(value), width);
  const divider = (y) => { doc.setDrawColor(...DIVIDER); doc.setLineWidth(0.7); doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y); };
  const drawContinuationHeader = () => { setText(9, OLIVE, 'bold'); doc.text(clean(projection.company.name || 'Proposal'), MARGIN, 34); setText(9, MUTED); doc.text(clean(projection.proposal.number), PAGE_WIDTH - MARGIN, 34, { align: 'right' }); divider(43); cursorY = 62; };
  const addPage = () => { doc.addPage(); drawContinuationHeader(); };
  const ensureSpace = (height) => { if (cursorY + height > CONTENT_BOTTOM) addPage(); };
  const heading = (value) => { ensureSpace(35); setText(15, NAVY, 'bold'); doc.text(value, MARGIN, cursorY); cursorY += 23; };

  const companyName = clean(projection.company.name || 'Contractor');
  if (projection.company.logoDataUrl) {
    try {
      const format = projection.company.logoDataUrl.toLowerCase().startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(projection.company.logoDataUrl, format, MARGIN, 30, 58, 46, undefined, 'FAST');
    } catch { /* Invalid snapshot logos fall back to the company name. */ }
  }
  const companyX = projection.company.logoDataUrl ? MARGIN + 70 : MARGIN;
  setText(14, NAVY, 'bold'); doc.text(companyName, companyX, 42, { maxWidth: 280 });
  setText(8.5, MUTED);
  [projection.company.address, projection.company.phone, projection.company.email].map(clean).filter(Boolean).forEach((detail, index) => doc.text(detail, companyX, 56 + index * 11, { maxWidth: 290 }));
  setText(22, OLIVE, 'bold'); doc.text('PROPOSAL', PAGE_WIDTH - MARGIN, 42, { align: 'right' });
  setText(8.5, MUTED);
  [projection.proposal.number ? `Proposal # ${clean(projection.proposal.number)}` : '', projection.proposal.date ? `Proposal Date  ${date(projection.proposal.date)}` : '', projection.proposal.validUntil ? `Valid Until  ${date(projection.proposal.validUntil)}` : ''].filter(Boolean).forEach((item, index) => doc.text(item, PAGE_WIDTH - MARGIN, 59 + index * 11, { align: 'right' }));
  divider(103); cursorY = 127;

  const drawInfoColumn = (label, values, x) => {
    setText(8.5, OLIVE, 'bold'); doc.text(label, x, cursorY);
    let y = cursorY + 17;
    values.map(clean).filter(Boolean).forEach((value, index) => { const wrapped = lines(value, 238); setText(index === 0 ? 10.5 : 9.5, index === 0 ? NAVY : MUTED, index === 0 ? 'bold' : 'normal'); doc.text(wrapped, x, y); y += wrapped.length * 12 + 3; });
    return y;
  };
  const customerBottom = drawInfoColumn('PREPARED FOR', [projection.customer.displayName, projection.customer.contactName, projection.customer.billingAddress, projection.customer.email, projection.customer.phone], MARGIN);
  const projectBottom = drawInfoColumn('PROJECT', [projection.proposal.title, projection.proposal.projectAddress, projection.proposal.introduction], MARGIN + 274);
  cursorY = Math.max(customerBottom, projectBottom) + 14; divider(cursorY); cursorY += 27;

  heading('Scope of Work');
  const showWorkAreaTotals = projection.workAreas.length > 1;
  for (const area of projection.workAreas) {
    ensureSpace(38); setText(11.5, OLIVE, 'bold'); doc.text(clean(area.name), MARGIN, cursorY); cursorY += 18;
    for (const scopeLine of area.scopeLines.length ? area.scopeLines : ['Scope details to be confirmed.']) {
      const wrapped = lines(scopeLine, CONTENT_WIDTH - 28); ensureSpace(wrapped.length * 12 + 7); setText(9.5, MUTED); doc.setFillColor(...OLIVE); doc.circle(MARGIN + 3, cursorY - 3, 1.5, 'F'); doc.text(wrapped, MARGIN + 14, cursorY); cursorY += wrapped.length * 12 + 7;
    }
    if (showWorkAreaTotals) { ensureSpace(31); divider(cursorY); cursorY += 17; setText(9.5, NAVY, 'bold'); doc.text('Work Area Total', PAGE_WIDTH - MARGIN - 118, cursorY); doc.text(currency(area.subtotal), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' }); cursorY += 25; } else cursorY += 6;
  }

  ensureSpace(104);
  const totalsX = PAGE_WIDTH - MARGIN - 220;
  doc.setFillColor(247, 249, 246); doc.setDrawColor(...DIVIDER); doc.roundedRect(totalsX, cursorY, 220, 88, 3, 3, 'FD');
  [['Subtotal', projection.proposal.subtotal], [`${clean(projection.proposal.taxLabel || 'Tax')} (${projection.proposal.taxRate}%)`, projection.proposal.taxAmount], ['Proposal Total', projection.proposal.total]].forEach(([label, value], index) => { const rowY = cursorY + 21 + index * 27; setText(index === 2 ? 11 : 9.5, index === 2 ? OLIVE : NAVY, index === 2 ? 'bold' : 'normal'); doc.text(label, totalsX + 14, rowY); doc.text(currency(value), totalsX + 206, rowY, { align: 'right' }); if (index === 1) { doc.setDrawColor(...DIVIDER); doc.line(totalsX + 12, rowY + 8, totalsX + 208, rowY + 8); } });
  cursorY += 112;

  if (projection.paymentSchedule?.length) {
    heading('Payment Schedule');
    projection.paymentSchedule.forEach((payment) => {
      const dueLines = lines(payment.due, 250); ensureSpace(Math.max(31, dueLines.length * 11 + 13));
      setText(10, NAVY, 'bold'); doc.text(clean(payment.label), MARGIN, cursorY);
      setText(9, MUTED); doc.text(dueLines, MARGIN + 150, cursorY);
      setText(9.5, NAVY); if (payment.type === 'percentage') doc.text(`${payment.percentage}%`, PAGE_WIDTH - MARGIN - 104, cursorY, { align: 'right' });
      setText(9.5, NAVY, 'bold'); doc.text(currency(payment.amount), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
      cursorY += Math.max(31, dueLines.length * 11 + 13); divider(cursorY - 9);
    });
    setText(10, OLIVE, 'bold'); doc.text('TOTAL', PAGE_WIDTH - MARGIN - 104, cursorY + 5, { align: 'right' }); doc.text(currency(projection.proposal.total), PAGE_WIDTH - MARGIN, cursorY + 5, { align: 'right' }); cursorY += 30;
  }

  const drawTextSection = (label, value) => {
    if (!clean(value)) return;
    heading(label); setText(9.5, MUTED);
    for (const line of lines(value, CONTENT_WIDTH)) { ensureSpace(12); doc.text(line, MARGIN, cursorY); cursorY += 12; }
    cursorY += 14;
  };
  drawTextSection('Notes', projection.proposal.notes);
  drawTextSection('Exclusions', projection.proposal.exclusions);
  drawTextSection('Terms and Conditions', projection.proposal.terms);

  if (options.acceptance) {
    ensureSpace(145); heading('Accepted');
    setText(10, NAVY, 'bold'); doc.text(`Accepted by: ${clean(options.acceptance.customerName)}`, MARGIN, cursorY); cursorY += 17;
    setText(9.5, MUTED); doc.text(`Accepted on: ${date(options.acceptance.acceptedAt)}`, MARGIN, cursorY); cursorY += 18;
    if (options.acceptance.signatureDataUrl) {
      try { doc.addImage(options.acceptance.signatureDataUrl, 'PNG', MARGIN, cursorY, 170, 58, undefined, 'FAST'); cursorY += 68; } catch { /* Signature validation occurs before rendering. */ }
    }
    setText(8.5, MUTED); doc.text(`Electronic acceptance statement version ${options.acceptance.acceptanceStatementVersion}`, MARGIN, cursorY);
  } else {
    ensureSpace(118); heading('Acceptance of Proposal'); setText(9.5, MUTED);
    const acceptance = lines(clean(projection.proposal.terms) ? 'This proposal is accepted, and the contractor is authorized to perform the work described above, subject to the stated terms and conditions.' : 'This proposal is accepted, and the contractor is authorized to perform the work described above.', CONTENT_WIDTH);
    doc.text(acceptance, MARGIN, cursorY); cursorY += acceptance.length * 12 + 28;
    setText(8.5, MUTED); doc.text('Customer name', MARGIN, cursorY); doc.text('Signature', MARGIN + 190, cursorY); doc.text('Date', MARGIN + 390, cursorY); doc.setDrawColor(...MUTED); doc.line(MARGIN, cursorY + 19, MARGIN + 160, cursorY + 19); doc.line(MARGIN + 190, cursorY + 19, MARGIN + 360, cursorY + 19); doc.line(MARGIN + 390, cursorY + 19, PAGE_WIDTH - MARGIN, cursorY + 19);
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) { doc.setPage(page); divider(762); setText(8, MUTED); doc.text(companyName, MARGIN, 777); doc.text(clean(projection.proposal.number), PAGE_WIDTH / 2, 777, { align: 'center' }); doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, 777, { align: 'right' }); }
  return doc;
}
