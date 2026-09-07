import { jsPDF } from 'jspdf';

const PAGE_WIDTH = 612;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = 735;
const CHARCOAL = [38, 45, 51];
const INK = [31, 41, 48];
const MUTED = [92, 103, 112];
const LIGHT = [242, 243, 243];
const DIVIDER = [196, 201, 204];
const WHITE = [255, 255, 255];

const clean = (value) => Array.from(String(value ?? '')).filter((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127);
}).join('').trim();
const currency = (value) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
const shortDate = (value) => value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
const longDate = (value) => value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';

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
  const companyName = clean(projection.company.name || 'Contractor');
  const status = options.acceptance ? 'ACCEPTED' : ['sent', 'viewed'].includes(projection.proposal.status) ? 'PROPOSAL' : 'DRAFT';
  let cursorY = 0;

  const setText = (size, color = INK, style = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const lines = (value, width) => doc.splitTextToSize(clean(value), width);
  const divider = (y, left = MARGIN, right = PAGE_WIDTH - MARGIN, width = 0.6) => {
    doc.setDrawColor(...DIVIDER);
    doc.setLineWidth(width);
    doc.line(left, y, right, y);
  };
  const continuationHeader = () => {
    doc.setFillColor(...CHARCOAL);
    doc.rect(0, 0, PAGE_WIDTH, 50, 'F');
    setText(10, WHITE, 'bold');
    doc.text(companyName, MARGIN, 30, { maxWidth: 300 });
    setText(9, WHITE);
    doc.text(clean(projection.proposal.number), PAGE_WIDTH - MARGIN, 30, { align: 'right' });
    cursorY = 68;
  };
  const addPage = () => {
    doc.addPage();
    continuationHeader();
  };
  const ensureSpace = (height) => {
    if (cursorY + height > CONTENT_BOTTOM) addPage();
  };
  const heading = (value, followingHeight = 0) => {
    ensureSpace(32 + followingHeight);
    setText(10, INK, 'bold');
    doc.text(clean(value).toUpperCase(), MARGIN, cursorY);
    divider(cursorY + 8);
    cursorY += 25;
  };
  const formattedText = (value) => {
    for (const rawLine of clean(value).split(/\r\n?|\n/)) {
      const line = rawLine.trim();
      if (!line) {
        cursorY += 6;
        continue;
      }
      const bullet = /^[-*•]\s+/.test(line);
      const numbered = /^(\d+[.)])\s+/.exec(line);
      const marker = numbered?.[1] ?? (bullet ? '•' : '');
      const content = line.replace(/^[-*•]\s+|^\d+[.)]\s+/, '');
      const wrapped = lines(content, CONTENT_WIDTH - (marker ? 16 : 0));
      ensureSpace(wrapped.length * 12 + 5);
      setText(9.5, INK);
      if (marker) doc.text(marker, MARGIN, cursorY);
      doc.text(wrapped, MARGIN + (marker ? 16 : 0), cursorY);
      cursorY += wrapped.length * 12 + 5;
    }
  };

  doc.setFillColor(...CHARCOAL);
  doc.rect(0, 0, PAGE_WIDTH, 104, 'F');
  let logoRendered = false;
  if (projection.company.logoDataUrl) {
    try {
      const format = projection.company.logoDataUrl.toLowerCase().startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const properties = doc.getImageProperties(projection.company.logoDataUrl);
      const scale = Math.min(66 / properties.width, 56 / properties.height);
      const logoWidth = properties.width * scale;
      const logoHeight = properties.height * scale;
      doc.addImage(projection.company.logoDataUrl, format, MARGIN, 24 + (56 - logoHeight) / 2, logoWidth, logoHeight, undefined, 'FAST');
      logoRendered = true;
    } catch { /* Invalid snapshot logos fall back to the company name. */ }
  }
  const companyX = logoRendered ? MARGIN + 80 : MARGIN;
  setText(15, WHITE, 'bold');
  doc.text(companyName, companyX, 38, { maxWidth: 280 });
  setText(8.5, WHITE);
  const companyDetails = [projection.company.address, [projection.company.phone, projection.company.email].map(clean).filter(Boolean).join('  |  '), projection.company.website].map(clean).filter(Boolean);
  companyDetails.slice(0, 3).forEach((detail, index) => doc.text(detail, companyX, 54 + index * 12, { maxWidth: 290 }));
  setText(25, WHITE, 'bold');
  doc.text('PROPOSAL', PAGE_WIDTH - MARGIN, 43, { align: 'right' });
  setText(10, WHITE, 'bold');
  doc.text(clean(projection.proposal.number), PAGE_WIDTH - MARGIN, 63, { align: 'right' });

  doc.setFillColor(...LIGHT);
  doc.rect(0, 104, PAGE_WIDTH, 72, 'F');
  const information = [
    ['PREPARED FOR', [projection.customer.displayName, projection.customer.contactName].map(clean).filter(Boolean).join('\n')],
    ['PROPERTY', projection.proposal.projectAddress || projection.proposal.title],
    ['ISSUE DATE', shortDate(projection.proposal.date)],
    ['VALID UNTIL', shortDate(projection.proposal.validUntil)],
  ];
  const columnWidths = [138, 206, 92, 92];
  let columnX = MARGIN;
  information.forEach(([label, value], index) => {
    setText(7.5, MUTED, 'bold');
    doc.text(label, columnX, 125);
    setText(9, INK, 'bold');
    doc.text(lines(value || '-', columnWidths[index] - 10).slice(0, 3), columnX, 142);
    columnX += columnWidths[index];
  });
  cursorY = 202;

  if (clean(projection.proposal.introduction)) {
    heading('Introduction', 17);
    formattedText(projection.proposal.introduction);
    cursorY += 8;
  }

  heading('Work Areas', 57);
  for (const area of projection.workAreas) {
    const scopeLines = area.scopeLines?.length ? area.scopeLines : ['Scope details to be confirmed.'];
    const firstScopeHeight = lines(clean(scopeLines[0]).replace(/^[-*•]\s+|^\d+[.)]\s+/, ''), CONTENT_WIDTH - 18).length * 12 + 6;
    ensureSpace(57 + firstScopeHeight);
    const areaName = lines(area.name, CONTENT_WIDTH - 125);
    setText(12, INK, 'bold');
    doc.text(areaName, MARGIN, cursorY);
    doc.text(currency(area.subtotal), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
    cursorY += areaName.length * 14 + 7;
    divider(cursorY);
    cursorY += 18;
    setText(9, INK, 'bold');
    doc.text('Scope of Work', MARGIN, cursorY);
    cursorY += 17;
    for (const scopeLine of scopeLines) {
      const line = clean(scopeLine);
      const numbered = /^(\d+[.)])\s+/.exec(line);
      const marker = numbered?.[1] ?? '•';
      const content = line.replace(/^[-*•]\s+|^\d+[.)]\s+/, '');
      const wrapped = lines(content, CONTENT_WIDTH - 18);
      ensureSpace(wrapped.length * 12 + 6);
      setText(9.5, MUTED);
      doc.text(marker, MARGIN, cursorY);
      doc.text(wrapped, MARGIN + 16, cursorY);
      cursorY += wrapped.length * 12 + 6;
    }
    cursorY += 11;
  }

  if (projection.paymentSchedule?.length) {
    const firstDueLines = lines(projection.paymentSchedule[0].due, CONTENT_WIDTH - 135);
    heading('Payment Schedule', Math.max(43, firstDueLines.length * 11 + 27));
    for (const payment of projection.paymentSchedule) {
      const dueLines = lines(payment.due, CONTENT_WIDTH - 135);
      const rowHeight = Math.max(43, dueLines.length * 11 + 27);
      ensureSpace(rowHeight);
      setText(10, INK, 'bold');
      doc.text(clean(payment.label), MARGIN, cursorY);
      doc.text(currency(payment.amount), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
      setText(8.5, MUTED, 'italic');
      doc.text(dueLines, MARGIN, cursorY + 15);
      if (payment.type === 'percentage') doc.text(`${payment.percentage}%`, PAGE_WIDTH - MARGIN, cursorY + 15, { align: 'right' });
      cursorY += rowHeight - 8;
      divider(cursorY);
      cursorY += 8;
    }
    cursorY += 3;
  }

  ensureSpace(64);
  const totalsX = PAGE_WIDTH - MARGIN - 260;
  setText(9.5, INK);
  doc.text(`${clean(projection.proposal.taxLabel || 'Tax')} (${projection.proposal.taxRate}%)`, totalsX, cursorY);
  doc.text(currency(projection.proposal.taxAmount), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
  cursorY += 13;
  divider(cursorY, totalsX);
  cursorY += 22;
  setText(13, INK, 'bold');
  doc.text('TOTAL', totalsX, cursorY);
  doc.text(currency(projection.proposal.total), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
  cursorY += 33;

  const textSection = (label, value) => {
    if (!clean(value)) return;
    heading(label, 17);
    formattedText(value);
    cursorY += 8;
  };
  textSection('Notes', projection.proposal.notes);
  textSection('Exclusions', projection.proposal.exclusions);
  const validityTerm = projection.proposal.validUntil ? `- This proposal is valid until ${longDate(projection.proposal.validUntil)}.` : '';
  textSection('Terms', [validityTerm, clean(projection.proposal.terms)].filter(Boolean).join('\n'));

  ensureSpace(options.acceptance ? 150 : 142);
  heading('Acceptance');
  if (options.acceptance) {
    setText(8.5, MUTED);
    doc.text('CLIENT SIGNATURE', MARGIN, cursorY);
    if (options.acceptance.signatureDataUrl) {
      try { doc.addImage(options.acceptance.signatureDataUrl, 'PNG', MARGIN, cursorY + 7, 165, 48, undefined, 'FAST'); } catch { /* Signature validation occurs before rendering. */ }
    }
    divider(cursorY + 61, MARGIN, MARGIN + 210);
    setText(9, INK, 'bold');
    doc.text(clean(options.acceptance.customerName), MARGIN, cursorY + 75);
    setText(8.5, MUTED);
    doc.text(longDate(options.acceptance.acceptedAt), MARGIN + 210, cursorY + 75, { align: 'right' });
    doc.text(`Electronic acceptance statement version ${options.acceptance.acceptanceStatementVersion}`, MARGIN, cursorY + 91);
  } else {
    setText(8.5, MUTED);
    doc.text('CLIENT SIGNATURE', MARGIN, cursorY);
    doc.text('DATE', MARGIN + 220, cursorY);
    divider(cursorY + 38, MARGIN, MARGIN + 200);
    divider(cursorY + 38, MARGIN + 220, MARGIN + 310);
  }
  const contractorX = MARGIN + 335;
  setText(8.5, MUTED);
  doc.text('CONTRACTOR', contractorX, cursorY);
  doc.text('DATE', contractorX + 130, cursorY);
  divider(cursorY + 38, contractorX, contractorX + 115);
  divider(cursorY + 38, contractorX + 130, PAGE_WIDTH - MARGIN);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFillColor(...CHARCOAL);
    doc.rect(0, 752, PAGE_WIDTH, 40, 'F');
    setText(8.5, WHITE, 'bold');
    doc.text([companyName, clean(projection.company.email)].filter(Boolean).join('  |  '), MARGIN, 776, { maxWidth: 325 });
    setText(8, WHITE);
    doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH / 2, 776, { align: 'center' });
    setText(9, WHITE, 'bold');
    doc.text(status, PAGE_WIDTH - MARGIN, 776, { align: 'right' });
  }
  return doc;
}