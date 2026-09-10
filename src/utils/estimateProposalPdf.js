import { jsPDF } from 'jspdf';
import { PROPOSAL_BRAND } from './proposalBrand.js';
import { buildProposalPresentation, proposalDisplayDate } from './proposalPresentationModel.js';

const PAGE_WIDTH = 612;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = 735;
const { accent: OLIVE, accentStrong: OLIVE_DEEP, neutral: OLIVE_TINT, border: OLIVE_BORDER, ink: INK, muted: MUTED, divider: DIVIDER, white: WHITE } = PROPOSAL_BRAND;

const clean = (value) => Array.from(String(value ?? '')).filter((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127);
}).join('').trim();
const cleanInline = (value) => Array.from(String(value ?? '')).filter((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127);
}).join('');

export function proposalPdfFileName(projection, accepted = false) {
  const safe = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [accepted ? 'accepted-proposal' : 'proposal', safe(projection.proposal.number), safe(projection.proposal.title)].filter(Boolean).join('-') + '.pdf';
}

export async function fetchEstimateProposal(estimateId, versionNumber) {
  const versionQuery = Number.isInteger(versionNumber) && versionNumber > 0 ? `&versionNumber=${versionNumber}` : '';
  const response = await fetch(`/api/estimate-proposal?estimateId=${encodeURIComponent(estimateId)}${versionQuery}`, { credentials: 'include' });
  const payload = await response.json();
  if (!response.ok || !payload.ok || !payload.proposal) throw new Error(payload.error || 'Proposal could not be generated.');
  return payload.proposal;
}

export function createEstimateProposalDocument(projection, options = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: false });
  const presentation = buildProposalPresentation(projection);
  const companyName = clean(presentation.company.name);
  const customerDocumentLabel = options.acceptance ? 'ACCEPTED' : 'PROPOSAL';
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
    doc.rect(0, 0, PAGE_WIDTH, 54, 'F');
    setText(10, WHITE, 'bold');
    doc.text(companyName, MARGIN, 30, { maxWidth: 300 });
    setText(9, WHITE, 'bold');
    doc.text(clean(presentation.document.number), PAGE_WIDTH - MARGIN, 30, { align: 'right' });
    cursorY = 72;
  };
  const addPage = () => {
    doc.addPage();
    continuationHeader();
  };
  const ensureSpace = (height) => {
    if (cursorY + height > CONTENT_BOTTOM) addPage();
  };
  const heading = (value, followingHeight = 0) => {
    ensureSpace(38 + followingHeight);
    setText(15, OLIVE_DEEP, 'bold');
    doc.text(clean(value), MARGIN, cursorY);
    doc.setDrawColor(...OLIVE);
    doc.setLineWidth(1.6);
    doc.line(MARGIN, cursorY + 9, PAGE_WIDTH - MARGIN, cursorY + 9);
    cursorY += 29;
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

  const richText = (document, left = MARGIN, width = CONTENT_WIDTH, color = MUTED) => {
    const lineHeight = 13;
    const renderInline = (nodes, marker = '') => {
      let x = left + (marker ? 18 : 0);
      let lineStarted = false;
      const lineLeft = x;
      const nextLine = () => {
        cursorY += lineHeight;
        ensureSpace(lineHeight + 2);
        x = lineLeft;
        lineStarted = false;
      };
      ensureSpace(lineHeight + 2);
      if (marker) {
        setText(9.5, color);
        doc.text(marker, left, cursorY);
      }
      for (const node of nodes ?? []) {
        if (node.type === 'hardBreak') {
          nextLine();
          continue;
        }
        if (node.type !== 'text') continue;
        const marks = Array.isArray(node.marks) ? node.marks : [];
        const bold = marks.some((mark) => mark.type === 'bold');
        const italic = marks.some((mark) => mark.type === 'italic');
        const underline = marks.some((mark) => mark.type === 'underline');
        const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
        for (const token of cleanInline(node.text).split(/(\s+)/).filter(Boolean)) {
          setText(9.5, color, style);
          const tokenWidth = doc.getTextWidth(token);
          if (lineStarted && x + tokenWidth > left + width) nextLine();
          if (!lineStarted && !token.trim()) continue;
          doc.text(token, x, cursorY);
          if (underline && token.trim()) {
            doc.setDrawColor(...color);
            doc.setLineWidth(0.45);
            doc.line(x, cursorY + 1.5, x + tokenWidth, cursorY + 1.5);
          }
          x += tokenWidth;
          lineStarted = true;
        }
      }
      cursorY += lineHeight + 4;
    };
    const renderBlock = (node, listMarker = '') => {
      if (node.type === 'paragraph') {
        if (!node.content?.length) {
          ensureSpace(8);
          cursorY += 8;
        } else renderInline(node.content, listMarker);
        return;
      }
      if (node.type === 'bulletList' || node.type === 'orderedList') {
        const start = node.attrs?.start ?? 1;
        (node.content ?? []).forEach((item, index) => {
          const marker = node.type === 'bulletList' ? '•' : `${start + index}.`;
          const [first, ...nested] = item.content ?? [];
          if (first) renderBlock(first, marker);
          nested.forEach((child) => renderBlock(child));
        });
      }
    };
    (document?.content ?? []).forEach((node) => renderBlock(node));
  };
  const richTextHeight = (document, width) => {
    let height = 0;
    const measure = (node) => {
      if (node.type === 'paragraph') {
        const value = (node.content ?? []).map((item) => item.type === 'hardBreak' ? '\n' : item.text ?? '').join('');
        height += value ? value.split('\n').reduce((sum, line) => sum + Math.max(1, lines(line, width).length) * 13, 0) + 4 : 8;
      } else if (node.type === 'bulletList' || node.type === 'orderedList') {
        (node.content ?? []).forEach((item) => (item.content ?? []).forEach(measure));
      }
    };
    (document?.content ?? []).forEach(measure);
    return height;
  };

  doc.setFillColor(...OLIVE_DEEP);
  doc.roundedRect(24, 18, PAGE_WIDTH - 48, 94, 8, 8, 'F');
  let logoRendered = false;
  if (presentation.company.logoDataUrl) {
    try {
      const format = presentation.company.logoDataUrl.toLowerCase().startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const properties = doc.getImageProperties(presentation.company.logoDataUrl);
      const scale = Math.min(66 / properties.width, 56 / properties.height);
      const logoWidth = properties.width * scale;
      const logoHeight = properties.height * scale;
      doc.setFillColor(...WHITE);
      doc.roundedRect(MARGIN, 37, 70, 56, 6, 6, 'F');
      doc.addImage(presentation.company.logoDataUrl, format, MARGIN + (70 - logoWidth) / 2, 37 + (56 - logoHeight) / 2, logoWidth, logoHeight, undefined, 'FAST');
      logoRendered = true;
    } catch { /* Invalid snapshot logos fall back to the company name. */ }
  }
  const companyX = logoRendered ? MARGIN + 80 : MARGIN;
  setText(15, WHITE, 'bold');
  doc.text(companyName, companyX, 45, { maxWidth: 280 });
  setText(8.5, WHITE);
  presentation.company.details.slice(0, 3).forEach((detail, index) => doc.text(clean(detail), companyX, 61 + index * 12, { maxWidth: 290 }));
  setText(25, WHITE, 'bold');
  doc.text(presentation.document.label.toUpperCase(), PAGE_WIDTH - MARGIN, 50, { align: 'right' });
  setText(10, WHITE, 'bold');
  doc.text(clean(presentation.document.number), PAGE_WIDTH - MARGIN, 70, { align: 'right' });

  const information = presentation.information.map((item) => [item.label.toUpperCase(), [item.value, ...(item.details ?? [])].filter(Boolean).join('\n')]);
  const columnWidths = [138, 206, 92, 92];
  const informationLines = information.map(([, value], index) => lines(value || '-', columnWidths[index] - 10));
  const informationPanelHeight = Math.max(66, 44 + Math.max(...informationLines.map((value) => value.length)) * 11);
  doc.setFillColor(...OLIVE_TINT);
  doc.setDrawColor(...OLIVE_BORDER);
  doc.setLineWidth(0.8);
  doc.roundedRect(MARGIN, 122, CONTENT_WIDTH, informationPanelHeight, 8, 8, 'FD');
  let columnX = MARGIN;
  information.forEach(([label], index) => {
    setText(7.5, MUTED, 'bold');
    doc.text(label, columnX, 141);
    setText(9, INK, 'bold');
    doc.text(informationLines[index], columnX, 158);
    columnX += columnWidths[index];
  });
  cursorY = 122 + informationPanelHeight + 26;

  if (clean(presentation.introduction)) {
    heading('Introduction', 17);
    formattedText(presentation.introduction);
    cursorY += 8;
  }

  if (presentation.workType === 'service') {
    heading('Services', 57);
    for (const service of presentation.services) {
      ensureSpace(88);
      setText(12, OLIVE_DEEP, 'bold');
      doc.text(lines(service.name, CONTENT_WIDTH - 170), MARGIN, cursorY);
      doc.text(service.displayPrice, PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
      cursorY += 18;
      setText(8.5, MUTED, 'italic');
      doc.text(service.scheduleSummary.replace(' · ', '  |  '), MARGIN, cursorY);
      cursorY += 18;
      if (clean(service.description)) formattedText(service.description);
      if (service.billingType === 'per_visit' && service.oneTimeCharge > 0) {
        setText(9, MUTED);
        doc.text(`One-time charge: ${service.displayOneTimeCharge}`, MARGIN, cursorY);
        cursorY += 16;
      }
      if (service.billingType === 'time_and_material') {
        for (const rate of service.customerRates) {
          ensureSpace(15);
          setText(9, MUTED);
          doc.text(`${clean(rate.name) || 'Service rate'}: ${rate.displayRate} / ${clean(rate.unit)}`, MARGIN, cursorY);
          cursorY += 14;
        }
        if (clean(service.timeAndMaterialNotes)) formattedText(service.timeAndMaterialNotes);
      }
      divider(cursorY);
      cursorY += 18;
    }
  } else {
    heading('Work Areas', 57);
    for (const area of presentation.workAreas) {
      const cardLeft = MARGIN;
      const cardWidth = CONTENT_WIDTH;
      const innerLeft = cardLeft + 16;
      const innerWidth = cardWidth - 32;
      const areaName = lines(area.name, innerWidth - 130);
      const scopeDocument = area.scopeRichText ?? {
        type: 'doc',
        content: area.scopeLines.map((scopeLine) => ({ type: 'paragraph', content: [{ type: 'text', text: scopeLine }] })),
      };
      const estimatedCardHeight = areaName.length * 14 + richTextHeight(scopeDocument, innerWidth) + 65;
      ensureSpace(Math.min(estimatedCardHeight, CONTENT_BOTTOM - 72));
      const cardTop = cursorY - 10;
      doc.setDrawColor(...OLIVE_BORDER);
      doc.setLineWidth(0.8);
      if (estimatedCardHeight < CONTENT_BOTTOM - 72) doc.roundedRect(cardLeft, cardTop, cardWidth, estimatedCardHeight, 8, 8, 'S');
      setText(12, OLIVE_DEEP, 'bold');
      doc.text(areaName, innerLeft, cursorY + 8);
      doc.text(area.displayPrice, PAGE_WIDTH - MARGIN - 16, cursorY + 8, { align: 'right' });
      cursorY += areaName.length * 14 + 14;
      setText(8.5, OLIVE_DEEP, 'bold');
      doc.text('SCOPE OF WORK', innerLeft, cursorY);
      cursorY += 17;
      richText(scopeDocument, innerLeft, innerWidth, MUTED);
      cursorY = Math.max(cursorY + 16, cardTop + estimatedCardHeight + 14);
    }
  }

  ensureSpace(presentation.totals.rows.length * 16 + 70);
  const totalsX = PAGE_WIDTH - MARGIN - 260;
  const totalsPanelHeight = presentation.totals.rows.length * 16 + 52;
  doc.setFillColor(...OLIVE_TINT);
  doc.setDrawColor(...OLIVE_BORDER);
  doc.setLineWidth(0.8);
  doc.roundedRect(totalsX - 14, cursorY - 17, 274, totalsPanelHeight, 8, 8, 'FD');
  for (const row of presentation.totals.rows) {
    setText(9.5, INK);
    doc.text(row.label, totalsX, cursorY);
    doc.text(row.displayValue, PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
    cursorY += 16;
  }
  doc.setDrawColor(...OLIVE);
  doc.setLineWidth(1.2);
  doc.line(totalsX, cursorY, PAGE_WIDTH - MARGIN, cursorY);
  cursorY += 22;
  setText(13, OLIVE_DEEP, 'bold');
  doc.text(presentation.totals.label.toUpperCase(), totalsX, cursorY);
  doc.text(presentation.totals.displayValue, PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
  cursorY += 40;

  if (presentation.paymentSchedule.length) {
    const firstDueLines = lines(presentation.paymentSchedule[0].due, CONTENT_WIDTH - 170);
    heading('Payment Schedule', Math.max(43, firstDueLines.length * 11 + 27));
    for (const payment of presentation.paymentSchedule) {
      const dueLines = lines(payment.due, CONTENT_WIDTH - 170);
      const rowHeight = Math.max(43, dueLines.length * 11 + 27);
      ensureSpace(rowHeight);
      setText(9, OLIVE, 'bold');
      doc.text(`${payment.index}.`, MARGIN, cursorY);
      setText(10, INK, 'bold');
      doc.text(clean(payment.label), MARGIN + 24, cursorY);
      doc.text(payment.displayAmount, PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
      setText(8.5, MUTED);
      doc.text(dueLines, MARGIN + 24, cursorY + 15);
      if (payment.percentageLabel) doc.text(payment.percentageLabel, PAGE_WIDTH - MARGIN - 100, cursorY + 15, { align: 'right' });
      cursorY += rowHeight - 8;
      divider(cursorY);
      cursorY += 8;
    }
    cursorY += 3;
  }

  const textSection = (section) => {
    const firstBlock = section.blocks[0];
    const firstHeight = firstBlock ? Math.max(17, lines(firstBlock.text, CONTENT_WIDTH - 18).length * 13) : 17;
    heading(section.label, firstHeight);
    for (const block of section.blocks) {
      const marker = block.kind === 'list-item' ? block.marker : '';
      const blockLines = lines(block.text, CONTENT_WIDTH - (marker ? 18 : 0));
      ensureSpace(blockLines.length * 13 + 6);
      setText(9.5, INK);
      if (marker) doc.text(marker, MARGIN, cursorY);
      doc.text(blockLines, MARGIN + (marker ? 18 : 0), cursorY);
      cursorY += blockLines.length * 13 + 6;
    }
    cursorY += 8;
  };
  presentation.sections.forEach(textSection);

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
    doc.text(proposalDisplayDate(options.acceptance.acceptedAt), MARGIN + 210, cursorY + 75, { align: 'right' });
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
    doc.setFillColor(...WHITE);
    doc.rect(0, 752, PAGE_WIDTH, 40, 'F');
    doc.setDrawColor(...OLIVE);
    doc.setLineWidth(1.2);
    doc.line(MARGIN, 752, PAGE_WIDTH - MARGIN, 752);
    setText(8.5, INK, 'bold');
    doc.text([companyName, clean(projection.company.email)].filter(Boolean).join('  |  '), MARGIN, 776, { maxWidth: 325 });
    setText(8, MUTED);
    doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH / 2, 776, { align: 'center' });
    setText(9, OLIVE_DEEP, 'bold');
    doc.text(customerDocumentLabel, PAGE_WIDTH - MARGIN, 776, { align: 'right' });
  }
  return doc;
}