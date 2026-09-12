import { jsPDF } from 'jspdf';
import { PROPOSAL_BRAND } from './proposalBrand.js';
import { buildProposalPresentation, proposalDisplayDate } from './proposalPresentationModel.js';
import { fitPdfText, measurePdfText, wrapPdfText } from './proposalPdfLayout.js';

const PAGE_WIDTH = 612;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = 735;
// accent/accentStrong come from the business's own proposal color choice (see buildProposalPresentation);
// everything else here is a fixed neutral, not a brand color.
const { neutral: OLIVE_TINT, border: OLIVE_BORDER, ink: INK, muted: MUTED, divider: DIVIDER, white: WHITE } = PROPOSAL_BRAND;

function hexToRgb(value, fallback) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const parsed = parseInt(match[1], 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

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
  const OLIVE = hexToRgb(presentation.company.color, PROPOSAL_BRAND.accent);
  const OLIVE_DEEP = hexToRgb(presentation.company.accentColor, PROPOSAL_BRAND.accentStrong);
  const companyName = clean(presentation.company.name);
  const customerDocumentLabel = options.acceptance ? 'ACCEPTED' : 'PROPOSAL';
  const layoutTrace = [];
  let cursorY = 0;

  const setText = (size, color = INK, style = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const lines = (value, width, wrapOptions) => wrapPdfText(doc, clean(value), width, wrapOptions);
  const recordText = (kind, page, x, baselineY, allocatedWidth, measurement, text, align) => layoutTrace.push({
    kind,
    page,
    x: align === 'right' ? x + allocatedWidth - measurement.width : x,
    y: baselineY - (measurement.lineHeight * 0.8),
    width: measurement.width,
    allocatedWidth,
    height: measurement.height,
    text: clean(text),
  });
  const drawMeasuredText = (value, { kind = 'text', x, y, width, size, minimumFontSize, lineHeight, color = INK, style = 'normal', align, noWrap = false }) => {
    setText(size, color, style);
    const measurement = noWrap
      ? fitPdfText(doc, clean(value), width, { fontSize: size, minimumFontSize, lineHeight, style })
      : measurePdfText(doc, clean(value), width, { fontSize: size, lineHeight, style });
    setText(measurement.fontSize ?? size, color, style);
    measurement.lines.forEach((line, index) => doc.text(line, align === 'right' ? x + width : x, y + index * lineHeight, { align }));
    recordText(kind, doc.getCurrentPageInfo().pageNumber, x, y, width, measurement, value, align);
    return measurement;
  };
  const divider = (y, left = MARGIN, right = PAGE_WIDTH - MARGIN, width = 0.6) => {
    doc.setDrawColor(...DIVIDER);
    doc.setLineWidth(width);
    doc.line(left, y, right, y);
  };
  const continuationHeader = () => {
    const continuationTop = 0;
    const continuationHeight = 62;
    doc.setFillColor(...OLIVE_DEEP);
    doc.rect(0, continuationTop, PAGE_WIDTH, continuationHeight, 'F');
    drawMeasuredText(companyName, { kind: 'continuation-company', x: MARGIN, y: 24, width: 330, size: 10, lineHeight: 12, color: WHITE, style: 'bold' });
    drawMeasuredText(presentation.document.number, { kind: 'continuation-number', x: PAGE_WIDTH - MARGIN - 150, y: 24, width: 150, size: 9, minimumFontSize: 7, lineHeight: 11, color: WHITE, style: 'bold', align: 'right', noWrap: true });
    cursorY = 80;
  };
  const addPage = () => {
    doc.addPage();
    continuationHeader();
  };
  const ensureSpace = (height) => {
    if (cursorY + height > CONTENT_BOTTOM) addPage();
  };
  const flowingLines = (wrapped, { kind = 'flow-text', left = MARGIN, width = CONTENT_WIDTH, size = 9.5, lineHeight = 12, color = INK, style = 'normal', marker = '' } = {}) => {
    wrapped.forEach((line, index) => {
      ensureSpace(lineHeight);
      setText(size, color, style);
      if (marker && index === 0) doc.text(marker, left, cursorY);
      const textLeft = left + (marker ? 16 : 0);
      doc.text(line, textLeft, cursorY);
      const measurement = measurePdfText(doc, line, width - (marker ? 16 : 0), { fontSize: size, lineHeight, style, noWrap: true });
      recordText(kind, doc.getCurrentPageInfo().pageNumber, textLeft, cursorY, width - (marker ? 16 : 0), measurement, line);
      cursorY += lineHeight;
    });
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
      flowingLines(wrapped, { kind: 'formatted-text', marker });
      cursorY += 5;
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

  const headerTop = 18;
  const headerLeft = 24;
  const headerWidth = PAGE_WIDTH - 48;
  const headerPaddingX = 18;
  const headerPaddingY = 18;
  const logoBoxWidth = 70;
  const logoGap = 12;
  const proposalWidth = 132;
  const proposalGap = 22;
  let logoRendered = false;
  if (presentation.company.logoDataUrl) {
    try {
      const format = presentation.company.logoDataUrl.toLowerCase().startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const properties = doc.getImageProperties(presentation.company.logoDataUrl);
      const scale = Math.min(66 / properties.width, 56 / properties.height);
      const logoWidth = properties.width * scale;
      const logoHeight = properties.height * scale;
      logoRendered = true;
      presentation.company.logoLayout = { format, logoWidth, logoHeight };
    } catch { /* Invalid snapshot logos fall back to the company name. */ }
  }
  const companyX = headerLeft + headerPaddingX + (logoRendered ? logoBoxWidth + logoGap : 0);
  const proposalX = headerLeft + headerWidth - headerPaddingX - proposalWidth;
  const companyWidth = proposalX - proposalGap - companyX;
  setText(15, WHITE, 'bold');
  const companyNameMeasure = measurePdfText(doc, companyName, companyWidth, { fontSize: 15, lineHeight: 18, style: 'bold' });
  setText(8.5, WHITE);
  const companyDetails = presentation.company.details.map((detail) => ({
    value: clean(detail),
    measurement: measurePdfText(doc, detail, companyWidth, { fontSize: 8.5, lineHeight: 11.5 }),
  }));
  const companyHeight = companyNameMeasure.height + (companyDetails.length ? 7 : 0)
    + companyDetails.reduce((height, detail) => height + detail.measurement.height + 2, 0);
  setText(25, WHITE, 'bold');
  const proposalLabelMeasure = fitPdfText(doc, presentation.document.label.toUpperCase(), proposalWidth, { fontSize: 25, minimumFontSize: 18, lineHeight: 28, style: 'bold' });
  setText(10, WHITE, 'bold');
  const proposalNumberMeasure = measurePdfText(doc, presentation.document.number, proposalWidth, { fontSize: 10, lineHeight: 13, style: 'bold' });
  const proposalHeight = proposalLabelMeasure.height + 8 + proposalNumberMeasure.height;
  const headerContentHeight = Math.max(logoRendered ? 56 : 0, companyHeight, proposalHeight);
  const headerHeight = headerPaddingY * 2 + headerContentHeight;

  doc.setFillColor(...OLIVE_DEEP);
  doc.roundedRect(headerLeft, headerTop, headerWidth, headerHeight, 8, 8, 'F');
  if (logoRendered) {
    const logoY = headerTop + headerPaddingY;
    doc.setFillColor(...WHITE);
    doc.roundedRect(headerLeft + headerPaddingX, logoY, logoBoxWidth, 56, 6, 6, 'F');
    const logo = presentation.company.logoLayout;
    doc.addImage(presentation.company.logoDataUrl, logo.format, headerLeft + headerPaddingX + (logoBoxWidth - logo.logoWidth) / 2, logoY + (56 - logo.logoHeight) / 2, logo.logoWidth, logo.logoHeight, undefined, 'FAST');
    layoutTrace.push({ kind: 'logo', page: 1, x: headerLeft + headerPaddingX, y: logoY, width: logoBoxWidth, height: 56 });
  }
  let companyY = headerTop + headerPaddingY + 13;
  drawMeasuredText(companyName, { kind: 'company-name', x: companyX, y: companyY, width: companyWidth, size: 15, lineHeight: 18, color: WHITE, style: 'bold' });
  companyY += companyNameMeasure.height + (companyDetails.length ? 7 : 0);
  companyDetails.forEach((detail) => {
    drawMeasuredText(detail.value, { kind: 'company-detail', x: companyX, y: companyY, width: companyWidth, size: 8.5, lineHeight: 11.5, color: WHITE });
    companyY += detail.measurement.height + 2;
  });
  const proposalY = headerTop + headerPaddingY + 21;
  drawMeasuredText(presentation.document.label.toUpperCase(), { kind: 'proposal-label', x: proposalX, y: proposalY, width: proposalWidth, size: 25, minimumFontSize: 18, lineHeight: 28, color: WHITE, style: 'bold', align: 'right', noWrap: true });
  drawMeasuredText(presentation.document.number, { kind: 'proposal-number', x: proposalX, y: proposalY + proposalLabelMeasure.height + 8, width: proposalWidth, size: 10, lineHeight: 13, color: WHITE, style: 'bold', align: 'right' });

  const information = presentation.information;
  const informationTop = headerTop + headerHeight + 10;
  const columnWidths = [CONTENT_WIDTH * 0.25, CONTENT_WIDTH * 0.4, CONTENT_WIDTH * 0.175, CONTENT_WIDTH * 0.175];
  const informationPaddingX = 10;
  const informationPaddingY = 15;
  const informationMeasures = information.map((item, index) => {
    const width = columnWidths[index] - informationPaddingX * 2;
    setText(9.5, INK, 'bold');
    const value = item.key === 'issued' || item.key === 'valid'
      ? fitPdfText(doc, item.value || '-', width, { fontSize: 9.5, minimumFontSize: 7.5, lineHeight: 13, style: 'bold' })
      : measurePdfText(doc, item.value || '-', width, { fontSize: 9.5, lineHeight: 13, style: 'bold' });
    setText(8.5, MUTED);
    const details = (item.details ?? []).map((detail) => measurePdfText(doc, detail, width, { fontSize: 8.5, lineHeight: 11.5 }));
    return { width, value, details, height: 9 + 9 + value.height + details.reduce((sum, detail) => sum + detail.height + 2, 0) };
  });
  const informationPanelHeight = informationPaddingY * 2 + Math.max(...informationMeasures.map((item) => item.height));
  doc.setFillColor(...OLIVE_TINT);
  doc.setDrawColor(...OLIVE_BORDER);
  doc.setLineWidth(0.8);
  doc.roundedRect(MARGIN, informationTop, CONTENT_WIDTH, informationPanelHeight, 8, 8, 'FD');
  let columnX = MARGIN;
  information.forEach((item, index) => {
    const contentX = columnX + informationPaddingX;
    const contentWidth = informationMeasures[index].width;
    let informationY = informationTop + informationPaddingY + 7;
    drawMeasuredText(item.label.toUpperCase(), { kind: `information-label-${item.key}`, x: contentX, y: informationY, width: contentWidth, size: 7.5, lineHeight: 9, color: MUTED, style: 'bold', noWrap: true });
    informationY += 18;
    const valueMeasure = drawMeasuredText(item.value || '-', { kind: `information-value-${item.key}`, x: contentX, y: informationY, width: contentWidth, size: 9.5, lineHeight: 13, color: INK, style: 'bold', noWrap: item.key === 'issued' || item.key === 'valid' });
    informationY += valueMeasure.height;
    (item.details ?? []).forEach((detail) => {
      informationY += 2;
      const detailMeasure = drawMeasuredText(detail, { kind: `information-detail-${item.key}`, x: contentX, y: informationY, width: contentWidth, size: 8.5, lineHeight: 11.5, color: MUTED });
      informationY += detailMeasure.height;
    });
    columnX += columnWidths[index];
  });
  cursorY = informationTop + informationPanelHeight + 26;

  if (clean(presentation.introduction)) {
    heading('Introduction', 17);
    formattedText(presentation.introduction);
    cursorY += 8;
  }

  if (presentation.workType === 'service') {
    heading('Services', 57);
    for (const service of presentation.services) {
      setText(12, OLIVE_DEEP, 'bold');
      const serviceNameLines = lines(service.name, CONTENT_WIDTH - 170);
      setText(8.5, MUTED, 'italic');
      const scheduleLines = lines(service.scheduleSummary.replace(' · ', '  |  '), CONTENT_WIDTH);
      ensureSpace(serviceNameLines.length * 15 + scheduleLines.length * 12 + 30);
      setText(12, OLIVE_DEEP, 'bold');
      doc.text(serviceNameLines, MARGIN, cursorY);
      doc.text(service.displayPrice, PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
      cursorY += serviceNameLines.length * 15 + 3;
      setText(8.5, MUTED, 'italic');
      flowingLines(scheduleLines, { kind: 'service-schedule', size: 8.5, lineHeight: 12, color: MUTED, style: 'italic' });
      cursorY += 6;
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
      cursorY = estimatedCardHeight < CONTENT_BOTTOM - 72
        ? Math.max(cursorY + 16, cardTop + estimatedCardHeight + 14)
        : cursorY + 16;
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
    const paymentTextWidth = CONTENT_WIDTH - 190;
    const firstDueLines = lines(presentation.paymentSchedule[0].due, paymentTextWidth);
    heading('Payment Schedule', Math.max(43, firstDueLines.length * 11 + 27));
    for (const payment of presentation.paymentSchedule) {
      setText(10, INK, 'bold');
      const labelLines = lines(payment.label, paymentTextWidth);
      setText(8.5, MUTED);
      const dueLines = lines(payment.due, paymentTextWidth);
      const rowHeight = Math.max(43, labelLines.length * 13 + dueLines.length * 11 + 14);
      ensureSpace(rowHeight);
      setText(9, OLIVE, 'bold');
      doc.text(`${payment.index}.`, MARGIN, cursorY);
      setText(10, INK, 'bold');
      doc.text(labelLines, MARGIN + 24, cursorY);
      doc.text(payment.displayAmount, PAGE_WIDTH - MARGIN, cursorY, { align: 'right' });
      setText(8.5, MUTED);
      // Percentage sits on the same line as the amount (not the due-date line below), so the two
      // right-aligned columns read as one clean row instead of one sitting a line lower than the other.
      if (payment.percentageLabel) doc.text(payment.percentageLabel, PAGE_WIDTH - MARGIN - 100, cursorY, { align: 'right' });
      const dueY = cursorY + labelLines.length * 13 + 2;
      doc.text(dueLines, MARGIN + 24, dueY);
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
      flowingLines(blockLines, { kind: `section-${section.key}`, marker, lineHeight: 13 });
      cursorY += 6;
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
    drawMeasuredText(options.acceptance.customerName, { kind: 'acceptance-name', x: MARGIN, y: cursorY + 75, width: 142, size: 9, lineHeight: 11, color: INK, style: 'bold' });
    drawMeasuredText(proposalDisplayDate(options.acceptance.acceptedAt), { kind: 'acceptance-date', x: MARGIN + 150, y: cursorY + 75, width: 60, size: 8.5, minimumFontSize: 7, lineHeight: 11, color: MUTED, align: 'right', noWrap: true });
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
    drawMeasuredText(companyName, { kind: 'footer-company', x: MARGIN, y: 769, width: 190, size: 8, minimumFontSize: 6, lineHeight: 9, color: INK, style: 'bold', noWrap: true });
    const companyEmail = clean(projection.company.email);
    if (companyEmail) drawMeasuredText(companyEmail, { kind: 'footer-email', x: MARGIN, y: 780, width: 190, size: 7, minimumFontSize: 6, lineHeight: 8, color: MUTED, noWrap: true });
    drawMeasuredText(`Page ${page} of ${pageCount}`, { kind: 'footer-page', x: PAGE_WIDTH / 2 - 48, y: 776, width: 96, size: 8, minimumFontSize: 7, lineHeight: 9, color: MUTED, align: 'center', noWrap: true });
    drawMeasuredText(customerDocumentLabel, { kind: 'footer-label', x: PAGE_WIDTH - MARGIN - 120, y: 776, width: 120, size: 9, minimumFontSize: 7, lineHeight: 10, color: OLIVE_DEEP, style: 'bold', align: 'right', noWrap: true });
  }
  Object.defineProperty(doc, '__oliveOpsLayout', { value: layoutTrace, enumerable: false });
  return doc;
}