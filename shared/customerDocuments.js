export const PAYMENT_METHOD_TYPES = Object.freeze(['etransfer', 'cheque', 'cash', 'bank_transfer', 'debit', 'visa', 'mastercard', 'other']);

const DEFAULT_LABELS = Object.freeze({
  etransfer: 'E-transfer', cheque: 'Cheque', cash: 'Cash', bank_transfer: 'Bank Transfer',
  debit: 'Debit', visa: 'Visa', mastercard: 'Mastercard', other: 'Other',
});
const text = (value, maximum = 1000) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export function defaultPaymentMethods() {
  return PAYMENT_METHOD_TYPES.map((type) => ({ type, enabled: false, displayName: DEFAULT_LABELS[type], instructions: '' }));
}

export function normalizePaymentMethods(value) {
  const methods = Array.isArray(value) ? value : [];
  const byType = new Map(methods.filter((method) => method && typeof method === 'object').map((method) => [method.type, method]));
  return defaultPaymentMethods().map((fallback) => {
    const method = byType.get(fallback.type);
    return { type: fallback.type, enabled: method?.enabled === true, displayName: text(method?.displayName, 100) || fallback.displayName, instructions: text(method?.instructions, 1000) };
  });
}

export function validatePaymentMethods(value) {
  if (!Array.isArray(value) || value.length > PAYMENT_METHOD_TYPES.length) return 'Payment methods are invalid.';
  const types = new Set();
  for (const method of value) {
    if (!method || typeof method !== 'object' || !PAYMENT_METHOD_TYPES.includes(method.type) || types.has(method.type)) return 'Payment methods are invalid.';
    if (typeof method.enabled !== 'boolean') return 'Payment method enabled values are invalid.';
    if (typeof method.displayName !== 'string' || !method.displayName.trim() || method.displayName.length > 100) return 'Payment method display names are invalid.';
    if (method.instructions !== undefined && (typeof method.instructions !== 'string' || method.instructions.length > 1000)) return 'Payment method instructions are invalid.';
    types.add(method.type);
  }
  return null;
}

export function customerDocumentSettings(business) {
  return {
    defaultPaymentTermsDays: Number.isSafeInteger(business?.defaultPaymentTermsDays) && business.defaultPaymentTermsDays >= 0 && business.defaultPaymentTermsDays <= 365 ? business.defaultPaymentTermsDays : 30,
    defaultInvoiceNotes: text(business?.defaultInvoiceNotes, 5000),
    paymentInstructions: text(business?.paymentInstructions, 5000),
    paymentMethods: normalizePaymentMethods(business?.paymentMethods),
  };
}

export function enabledPaymentMethods(business) {
  return customerDocumentSettings(business).paymentMethods.filter((method) => method.enabled);
}