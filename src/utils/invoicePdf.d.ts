import type { jsPDF } from 'jspdf';
import type { InvoiceCustomerDocumentSnapshot } from '../types';

export function invoicePdfFileName(snapshot: InvoiceCustomerDocumentSnapshot): string;
export function createInvoiceDocument(snapshot: InvoiceCustomerDocumentSnapshot): jsPDF;