import { jsPDF } from 'jspdf';
import { buildInvoicePresentation } from './invoicePresentationModel.js';
import { measurePdfText } from './proposalPdfLayout.js';

export function invoicePdfFileName(snapshot) {
  const number = String(snapshot?.invoice?.number ?? 'invoice').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${number || 'invoice'}.pdf`;
}

export function createInvoiceDocument(snapshot) {
  const presentation = buildInvoicePresentation(snapshot);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 42;
  const width = 528;
  const contentBottom = 744;
  let y = 132;
  const drawHeader = () => {
    doc.setFillColor(54, 91, 67); doc.roundedRect(24, 18, 564, 94, 8, 8, 'F');
    let companyX = margin;
    if (presentation.company.logoDataUrl) {
      try {
        const properties = doc.getImageProperties(presentation.company.logoDataUrl);
        const scale = Math.min(54 / properties.width, 54 / properties.height);
        const logoWidth = properties.width * scale;
        const logoHeight = properties.height * scale;
        doc.setFillColor(255, 255, 255); doc.roundedRect(38, 34, 62, 62, 4, 4, 'F');
        doc.addImage(presentation.company.logoDataUrl, properties.fileType, 69 - logoWidth / 2, 65 - logoHeight / 2, logoWidth, logoHeight);
        companyX = 112;
      } catch { companyX = margin; }
    }
    let headerY = 47;
    const headerText = (value, size, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(255, 255, 255);
      const lines = doc.splitTextToSize(value, companyX === margin ? 300 : 235).slice(0, 2);
      lines.forEach((line, index) => doc.text(line, companyX, headerY + index * (size + 2)));
      headerY += lines.length * (size + 2);
    };
    headerText(presentation.company.name, 15, true);
    presentation.company.details.forEach((detail) => headerText(detail, 7));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.text('INVOICE', 570, 53, { align: 'right' });
    doc.setFontSize(10); doc.text(presentation.document.number, 570, 74, { align: 'right' });
  };
  const drawFooter = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text('Payment is made directly to the contractor. OliveOps does not process payments.', margin, 770);
    doc.text(`Page ${doc.getNumberOfPages()}`, 570, 770, { align: 'right' });
  };
  const nextPage = () => { doc.addPage(); drawHeader(); drawFooter(); y = 132; };
  const ensureSpace = (height) => { if (y + height > contentBottom) nextPage(); };
  const text = (value, x, options = {}) => {
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal'); doc.setFontSize(options.size ?? 9); doc.setTextColor(...(options.color ?? [31, 41, 55]));
    const measured = measurePdfText(doc, value, options.width ?? width, { fontSize: options.size ?? 9, lineHeight: options.lineHeight ?? 13, style: options.bold ? 'bold' : 'normal' });
    measured.lines.forEach((line) => { ensureSpace(measured.lineHeight); doc.text(line, x, y, options.align ? { align: options.align } : undefined); y += measured.lineHeight; });
    return measured;
  };
  drawHeader(); drawFooter();
  for (const item of presentation.information) { text(item.label.toUpperCase(), margin, { size: 8, bold: true, color: [54, 91, 67] }); text(item.value, margin, { size: 10, bold: true }); item.details.forEach((detail) => text(detail, margin, { size: 8, color: [100, 116, 139] })); y += 6; }
  y += 8; ensureSpace(34); text('INVOICE DETAILS', margin, { size: 13, bold: true, color: [54, 91, 67] }); y += 7;
  presentation.lines.forEach((line) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const measured = measurePdfText(doc, line.description, 390, { fontSize: 9, lineHeight: 13 });
    ensureSpace(measured.height + 7);
    const lineY = y;
    measured.lines.forEach((part, index) => doc.text(part, margin, lineY + index * measured.lineHeight));
    doc.setFont('helvetica', 'bold'); doc.setTextColor(31, 41, 55); doc.text(line.displayTotal, 570, lineY, { align: 'right' });
    y += measured.height + 7;
  });
  ensureSpace(105); y += 10; doc.line(360, y, 570, y); y += 17;
  for (const [label, value] of [['Subtotal', presentation.totals.displaySubtotal], ['Tax', presentation.totals.displayTax], ['Total', presentation.totals.displayTotal], ['Amount paid', presentation.totals.displayAmountPaid], ['Balance due', presentation.totals.displayBalance]]) { doc.setFont('helvetica', label === 'Balance due' ? 'bold' : 'normal'); doc.text(label, 390, y); doc.text(value, 570, y, { align: 'right' }); y += 16; }
  if (presentation.paymentMethods.length || presentation.paymentInstructions) { y += 12; ensureSpace(38); text('HOW TO PAY', margin, { size: 13, bold: true, color: [54, 91, 67] }); y += 5; presentation.paymentMethods.forEach((method) => { ensureSpace(30); text(method.displayName, margin, { bold: true }); if (method.instructions) text(method.instructions, margin, { width, color: [71, 85, 105] }); y += 4; }); if (presentation.paymentInstructions) text(presentation.paymentInstructions, margin, { color: [71, 85, 105] }); }
  if (presentation.notes) { y += 12; ensureSpace(38); text('NOTES', margin, { size: 13, bold: true, color: [54, 91, 67] }); y += 5; text(presentation.notes, margin); }
  return doc;
}