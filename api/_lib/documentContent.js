export const CONTENT_MODES = new Set(['structured', 'document']);
export const PDF_EXPORT_MESSAGE = 'PDF files are supported. Open your Word document and choose Save As or Export to create a PDF, then upload it here.';

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeContentMode(value) {
  return CONTENT_MODES.has(value) ? value : 'structured';
}

export function normalizePdfDocument(value) {
  if (!value || typeof value !== 'object') return null;
  const fileId = cleanText(value.fileId, 160);
  if (!fileId) return null;
  return {
    fileId,
    originalFileName: cleanText(value.originalFileName, 255),
    mimeType: cleanText(value.mimeType, 120).toLowerCase(),
    sizeBytes: Number.isSafeInteger(Number(value.sizeBytes)) ? Number(value.sizeBytes) : 0,
    uploadedAt: cleanText(value.uploadedAt, 40),
    status: value.status === 'ready' ? 'ready' : 'pending',
    version: Number.isSafeInteger(Number(value.version)) && Number(value.version) > 0 ? Number(value.version) : null,
  };
}

export function validateReadyPdfDocument(document) {
  if (!document) return 'Upload a PDF before publishing.';
  if (document.status !== 'ready') return 'Wait for the PDF upload and validation to finish before publishing.';
  if (document.mimeType !== 'application/pdf') return PDF_EXPORT_MESSAGE;
  if (!document.originalFileName.toLowerCase().endsWith('.pdf')) return PDF_EXPORT_MESSAGE;
  if (!Number.isSafeInteger(document.sizeBytes) || document.sizeBytes <= 0) return 'The uploaded PDF metadata is invalid.';
  return '';
}

export function documentFromFileRecord(file, { entityType, entityId }) {
  if (!file || file.businessId === undefined || file.entityType !== entityType || file.entityId !== entityId || file.category !== 'document') return null;
  if (file.uploadStatus !== 'uploaded' || !file.pdfValidatedAt) return null;
  if (file.mimeType !== 'application/pdf' || !String(file.originalFileName ?? '').toLowerCase().endsWith('.pdf')) return null;
  return normalizePdfDocument({
    fileId: file.id,
    originalFileName: file.originalFileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploadedAt: file.uploadedAt,
    status: 'ready',
  });
}