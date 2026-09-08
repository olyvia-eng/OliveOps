import { jsPDF } from 'jspdf';

const PAGE_WIDTH = 612;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = 735;
const OLIVE_DEEP = [74, 100, 24];
const OLIVE = [107, 142, 35];
const OLIVE_TINT = [238, 244, 227];
const OLIVE_BORDER = [202, 223, 162];
const INK = [15, 23, 42];
const MUTED = [71, 85, 105];
const DIVIDER = [226, 232, 240];
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
    doc.setFillColor(...OLIVE_DEEP);
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
    setText(10, OLIVE_DEEP, 'bold');
    doc.text(clean(value).toUpperCase(), MARGIN, cursorY);
    doc.setDrawColor(...OLIVE);
    doc.setLineWidth(1.4);
    doc.line(MARGIN, cursorY + 8, PAGE_WIDTH - MARGIN, cursorY + 8);
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

  doc.setFillColor(...OLIVE_DEEP);
  doc.roundedRect(24, 18, PAGE_WIDTH - 48, 92, 12, 12, 'F');
  let logoRendered = false;
  if (projection.company.logoDataUrl) {
    try {
      const format = projection.company.logoDataUrl.toLowerCase().startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const properties = doc.getImageProperties(projection.company.logoDataUrl);
      const scale = Math.min(66 / properties.width, 56 / properties.height);
      const logoWidth = properties.width * scale;
      const logoHeight = properties.height * scale;
      doc.setFillColor(...WHITE);
      doc.roundedRect(MARGIN, 30, 70, 56, 6, 6, 'F');
      doc.addImage(projection.company.logoDataUrl, format, MARGIN + (70 - logoWidth) / 2, 30 + (56 - logoHeight) / 2, logoWidth, logoHeight, undefined, 'FAST');
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

  doc.setFillColor(...OLIVE_TINT);
  doc.setDrawColor(...OLIVE_BORDER);
  doc.setLineWidth(0.8);
  doc.roundedRect(MARGIN, 122, CONTENT_WIDTH, 66, 8, 8, 'FD');
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
    doc.text(label, columnX, 141);
    setText(9, INK, 'bold');
    doc.text(lines(value || '-', columnWidths[index] - 10).slice(0, 3), columnX, 158);
    columnX += columnWidths[index];
  });
  cursorY = 214;

  if (clean(projection.proposal.introduction)) {
    heading('Introduction', 17);
    formattedText(projection.proposal.introduction);
    cursorY += 8;
  }

  if (projection.workType === 'service') {
    heading('Services', 57);
    for (const service of projection.services ?? []) {
      ensureSpace(88);
      setText(12, OLIVE_DEEP, 'bold');
      doc.text(lines(service.name, CONTENT_WIDTH - 170), MARGIN, cursorY);
      const price = service.billingType === 'contract'
        ? currency(service.contractPrice)
        : service.billingType === 'per_visit'
          ? `${currency(service.effectivePricePerVisit)} / visit`
          : 'Time & Material';
      doc.text(price, PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
      cursorY += 18;
      setText(8.5, MUTED, 'italic');
      doc.text(`${service.scheduleLabel}  |  ${service.estimatedVisits} estimated visit${service.estimatedVisits === 1 ? '' : 's'}`, MARGIN, cursorY);
      cursorY += 18;
      if (clean(service.description)) formattedText(service.description);
      if (service.billingType === 'per_visit' && service.oneTimeCharge > 0) {
        setText(9, MUTED);
        doc.text(`One-time charge: ${currency(service.oneTimeCharge)}`, MARGIN, cursorY);
        cursorY += 16;
      }
      if (service.billingType === 'time_and_material') {
        for (const rate of service.customerRates) {
          ensureSpace(15);
          setText(9, MUTED);
          doc.text(`${clean(rate.name) || 'Service rate'}: ${currency(rate.sellRate)} / ${clean(rate.unit)}`, MARGIN, cursorY);
          cursorY += 14;
        }
        if (clean(service.timeAndMaterialNotes)) formattedText(service.timeAndMaterialNotes);
      }
      divider(cursorY);
      cursorY += 18;
    }
  } else {
    heading('Work Areas', 57);
    for (const area of projection.workAreas) {
      const scopeLines = area.scopeLines?.length ? area.scopeLines : ['Scope details to be confirmed.'];
      const areaName = lines(area.name, CONTENT_WIDTH - 157);
      const scopeEntries = scopeLines.map((scopeLine) => {
        const line = clean(scopeLine);
        const numbered = /^(\d+[.)])\s+/.exec(line);
        return {
          marker: numbered?.[1] ?? '•',
          wrapped: lines(line.replace(/^[-*•]\s+|^\d+[.)]\s+/, ''), CONTENT_WIDTH - 50),
        };
      });
      const scopeHeight = scopeEntries.reduce((height, entry) => height + entry.wrapped.length * 12 + 6, 0);
      const cardHeight = areaName.length * 14 + scopeHeight + 73;
      ensureSpace(cardHeight + 16);

      doc.setFillColor(...WHITE);
      doc.setDrawColor(...OLIVE_BORDER);
      doc.setLineWidth(0.8);
      doc.roundedRect(MARGIN, cursorY - 16, CONTENT_WIDTH, cardHeight, 8, 8, 'FD');
      setText(12, OLIVE_DEEP, 'bold');
      doc.text(areaName, MARGIN + 16, cursorY);
      doc.text(currency(area.subtotal), PAGE_WIDTH - MARGIN - 16, cursorY, { align: 'right' });
      cursorY += areaName.length * 14 + 10;
      divider(cursorY, MARGIN + 16, PAGE_WIDTH - MARGIN - 16);
      cursorY += 18;
      setText(9, INK, 'bold');
      doc.text('Scope of Work', MARGIN + 16, cursorY);
      cursorY += 17;
      for (const entry of scopeEntries) {
        setText(9.5, MUTED);
        doc.text(entry.marker, MARGIN + 16, cursorY);
        doc.text(entry.wrapped, MARGIN + 32, cursorY);
        cursorY += entry.wrapped.length * 12 + 6;
      }
      cursorY += 28;
    }
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

  ensureSpace(projection.workType === 'service' ? 120 : 64);
  const totalsX = PAGE_WIDTH - MARGIN - 260;
  const totalsPanelHeight = projection.workType === 'service' ? 108 : 67;
  doc.setFillColor(...OLIVE_TINT);
  doc.setDrawColor(...OLIVE_BORDER);
  doc.setLineWidth(0.8);
  doc.roundedRect(totalsX - 14, cursorY - 17, 274, totalsPanelHeight, 8, 8, 'FD');
  if (projection.workType === 'service' && projection.servicePricingSummary) {
    setText(9.5, INK);
    doc.text('Contracted services', totalsX, cursorY);
    doc.text(currency(projection.servicePricingSummary.contractedRevenue), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
    cursorY += 13;
    doc.text('Projected per-visit services', totalsX, cursorY);
    doc.text(currency(projection.servicePricingSummary.projectedPerVisitRevenue), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
    cursorY += 13;
    doc.text('Projected time & material', totalsX, cursorY);
    doc.text(currency(projection.servicePricingSummary.projectedTimeAndMaterialRevenue), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
    cursorY += 18;
  }
  setText(9.5, INK);
  doc.text(`${projection.workType === 'service' ? 'Estimated ' : ''}${clean(projection.proposal.taxLabel || 'Tax')} (${projection.proposal.taxRate}%)`, totalsX, cursorY);
  doc.text(currency(projection.proposal.taxAmount), PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
  cursorY += 13;
  doc.setDrawColor(...OLIVE);
  doc.setLineWidth(1.2);
  doc.line(totalsX, cursorY, PAGE_WIDTH - MARGIN, cursorY);
  cursorY += 22;
  setText(13, OLIVE_DEEP, 'bold');
  doc.text(projection.workType === 'service' ? 'ESTIMATED TOTAL' : 'TOTAL', totalsX, cursorY);
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
    doc.setFillColor(...OLIVE_DEEP);
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