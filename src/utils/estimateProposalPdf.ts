import { jsPDF } from 'jspdf';
import type { EstimateProposalProjection } from './estimateProposalModel.js';

const PAGE_WIDTH = 612;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = 748;
const NAVY: [number, number, number] = [28, 43, 58];
const OLIVE: [number, number, number] = [91, 112, 72];
const MUTED: [number, number, number] = [92, 103, 112];
const DIVIDER: [number, number, number] = [220, 224, 226];

const clean = (value: string) => Array.from(value)
  .filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127);
  })
  .join('')
  .trim();
const currency = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
const date = (value: string) => value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

export function proposalPdfFileName(projection: EstimateProposalProjection): string {
  const safe = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ['proposal', safe(projection.proposal.number), safe(projection.proposal.title)].filter(Boolean).join('-') + '.pdf';
}

export function createEstimateProposalDocument(projection: EstimateProposalProjection): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: false });
  let cursorY = MARGIN;

  const setText = (size: number, color = NAVY, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const lines = (value: string, width: number): string[] => doc.splitTextToSize(clean(value), width) as string[];
  const divider = (y: number) => { doc.setDrawColor(...DIVIDER); doc.setLineWidth(0.7); doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y); };

  const drawContinuationHeader = () => {
    setText(9, OLIVE, 'bold');
    doc.text(clean(projection.company.name || 'Proposal'), MARGIN, 34);
    setText(9, MUTED);
    doc.text(clean(projection.proposal.number), PAGE_WIDTH - MARGIN, 34, { align: 'right' });
    divider(43);
    cursorY = 62;
  };

  const addPage = () => { doc.addPage(); drawContinuationHeader(); };
  const ensureSpace = (height: number) => { if (cursorY + height > CONTENT_BOTTOM) addPage(); };

  const companyName = clean(projection.company.name || 'Contractor');
  if (projection.company.logoDataUrl) {
    try {
      const format = projection.company.logoDataUrl.toLowerCase().startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(projection.company.logoDataUrl, format, MARGIN, 32, 52, 42, undefined, 'FAST');
    } catch {
      // Invalid embedded logos are omitted without affecting the proposal.
    }
  }
  const companyX = projection.company.logoDataUrl ? MARGIN + 64 : MARGIN;
  setText(14, NAVY, 'bold');
  doc.text(companyName, companyX, 43, { maxWidth: 300 });
  setText(8.5, MUTED);
  const companyDetails = [projection.company.phone, projection.company.email, projection.company.website, projection.company.address].map(clean).filter(Boolean);
  companyDetails.forEach((detail, index) => doc.text(detail, companyX, 57 + index * 11, { maxWidth: 310 }));

  setText(20, OLIVE, 'bold');
  doc.text('PROPOSAL', PAGE_WIDTH - MARGIN, 43, { align: 'right' });
  setText(8.5, MUTED);
  const meta = [
    projection.proposal.number ? `Proposal ${clean(projection.proposal.number)}` : '',
    projection.proposal.date ? `Proposal date  ${date(projection.proposal.date)}` : '',
    projection.proposal.validUntil ? `Valid until  ${date(projection.proposal.validUntil)}` : '',
  ].filter(Boolean);
  meta.forEach((item, index) => doc.text(item, PAGE_WIDTH - MARGIN, 59 + index * 11, { align: 'right' }));
  divider(102);
  cursorY = 126;

  const drawInfoColumn = (heading: string, values: string[], x: number) => {
    setText(8.5, OLIVE, 'bold');
    doc.text(heading.toUpperCase(), x, cursorY);
    let y = cursorY + 17;
    values.map(clean).filter(Boolean).forEach((value, index) => {
      const wrapped = lines(value, 238);
      setText(index === 0 ? 10.5 : 9.5, index === 0 ? NAVY : MUTED, index === 0 ? 'bold' : 'normal');
      doc.text(wrapped, x, y);
      y += wrapped.length * 12 + 3;
    });
    return y;
  };

  const customerBottom = drawInfoColumn('Prepared for', [projection.customer.displayName, projection.customer.contactName, projection.customer.billingAddress, projection.customer.email, projection.customer.phone], MARGIN);
  const projectBottom = drawInfoColumn('Project', [projection.proposal.title, projection.proposal.projectAddress, projection.proposal.introduction], MARGIN + 274);
  cursorY = Math.max(customerBottom, projectBottom) + 14;
  divider(cursorY);
  cursorY += 27;

  setText(15, NAVY, 'bold');
  doc.text('Scope of Work', MARGIN, cursorY);
  cursorY += 22;

  for (const area of projection.workAreas) {
    const descriptions = area.descriptions.length ? area.descriptions : ['Included work'];
    const firstLines = lines(descriptions[0], CONTENT_WIDTH - 28);
    ensureSpace(32 + firstLines.length * 12);
    setText(11.5, OLIVE, 'bold');
    doc.text(clean(area.name), MARGIN, cursorY);
    cursorY += 18;

    for (const description of descriptions) {
      const wrapped = lines(description, CONTENT_WIDTH - 28);
      ensureSpace(wrapped.length * 12 + 7);
      setText(9.5, MUTED);
      doc.setFillColor(...OLIVE);
      doc.circle(MARGIN + 3, cursorY - 3, 1.5, 'F');
      doc.text(wrapped, MARGIN + 14, cursorY);
      cursorY += wrapped.length * 12 + 7;
    }

    ensureSpace(31);
    divider(cursorY);
    cursorY += 17;
    setText(9.5, NAVY, 'bold');
    doc.text('Work Area Total', PAGE_WIDTH - MARGIN - 118, cursorY);
    doc.text(currency(area.subtotal), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
    cursorY += 25;
  }

  ensureSpace(104);
  const totalsX = PAGE_WIDTH - MARGIN - 220;
  doc.setFillColor(247, 249, 246);
  doc.setDrawColor(...DIVIDER);
  doc.roundedRect(totalsX, cursorY, 220, 88, 3, 3, 'FD');
  const totalRows = [
    ['Subtotal', projection.proposal.subtotal],
    [`${clean(projection.proposal.taxLabel || 'Tax')} (${projection.proposal.taxRate}%)`, projection.proposal.taxAmount],
    ['Proposal Total', projection.proposal.total],
  ] as const;
  totalRows.forEach(([label, value], index) => {
    const rowY = cursorY + 21 + index * 27;
    setText(index === 2 ? 11 : 9.5, index === 2 ? OLIVE : NAVY, index === 2 ? 'bold' : 'normal');
    doc.text(label, totalsX + 14, rowY);
    doc.text(currency(value), totalsX + 206, rowY, { align: 'right' });
    if (index === 1) { doc.setDrawColor(...DIVIDER); doc.line(totalsX + 12, rowY + 8, totalsX + 208, rowY + 8); }
  });
  cursorY += 112;

  const drawTextSection = (heading: string, value: string) => {
    if (!clean(value)) return;
    const wrapped = lines(value, CONTENT_WIDTH);
    ensureSpace(28 + Math.min(wrapped.length, 2) * 12);
    setText(11, NAVY, 'bold');
    doc.text(heading, MARGIN, cursorY);
    cursorY += 17;
    setText(9.5, MUTED);
    for (const line of wrapped) {
      ensureSpace(12);
      doc.text(line, MARGIN, cursorY);
      cursorY += 12;
    }
    cursorY += 14;
  };

  drawTextSection('Notes', projection.proposal.notes);
  drawTextSection('Exclusions', projection.proposal.exclusions);
  drawTextSection('Terms and Conditions', projection.proposal.terms);

  ensureSpace(118);
  setText(12, NAVY, 'bold');
  doc.text('Acceptance of Proposal', MARGIN, cursorY);
  cursorY += 19;
  setText(9.5, MUTED);
  const acceptance = lines('This proposal is accepted, and the contractor is authorized to perform the work described above, subject to the stated terms and conditions.', CONTENT_WIDTH);
  doc.text(acceptance, MARGIN, cursorY);
  cursorY += acceptance.length * 12 + 28;
  setText(8.5, MUTED);
  doc.text('Customer name', MARGIN, cursorY);
  doc.text('Signature', MARGIN + 190, cursorY);
  doc.text('Date', MARGIN + 390, cursorY);
  doc.setDrawColor(...MUTED);
  doc.line(MARGIN, cursorY + 19, MARGIN + 160, cursorY + 19);
  doc.line(MARGIN + 190, cursorY + 19, MARGIN + 360, cursorY + 19);
  doc.line(MARGIN + 390, cursorY + 19, PAGE_WIDTH - MARGIN, cursorY + 19);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    divider(762);
    setText(8, MUTED);
    doc.text(companyName, MARGIN, 777);
    doc.text(clean(projection.proposal.number), PAGE_WIDTH / 2, 777, { align: 'center' });
    doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, 777, { align: 'right' });
  }

  return doc;
}

export async function fetchEstimateProposal(estimateId: string): Promise<EstimateProposalProjection> {
  const response = await fetch(`/api/estimate-proposal?estimateId=${encodeURIComponent(estimateId)}`, { credentials: 'include' });
  const payload = await response.json() as { ok?: boolean; proposal?: EstimateProposalProjection; error?: string };
  if (!response.ok || !payload.ok || !payload.proposal) throw new Error(payload.error || 'Proposal could not be generated.');
  return payload.proposal;
}
