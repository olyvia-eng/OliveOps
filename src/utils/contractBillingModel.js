import { calculateJobInvoicePosition, normalizeInvoiceFinancials, roundCurrency } from './invoiceModel.js';

const cents = (value) => Math.round((Number(value) || 0) * 100);
const money = (value) => value / 100;
const text = (value) => typeof value === 'string' ? value.trim() : '';

function invoiceTypeForStage(stage, index, count) {
  const label = text(stage?.label).toLowerCase();
  if (label.includes('deposit')) return 'deposit';
  if (label.includes('final') || index === count - 1) return 'final';
  return index === 0 ? 'deposit' : 'progress';
}

export function buildContractBillingSchedule(proposalSnapshot) {
  const proposal = proposalSnapshot?.proposal ?? proposalSnapshot ?? {};
  const stages = Array.isArray(proposalSnapshot?.paymentSchedule)
    ? proposalSnapshot.paymentSchedule
    : Array.isArray(proposal.paymentSchedule) ? proposal.paymentSchedule : [];
  const subtotalCents = Math.max(0, cents(proposal.subtotal));
  const taxCents = Math.max(0, cents(proposal.taxAmount));
  const totalCents = Math.max(0, cents(proposal.total || money(subtotalCents + taxCents)));
  const taxRate = Math.max(0, Number(proposal.taxRate) || 0);
  const explicitTaxableCents = Number.isFinite(proposal.taxableSubtotal)
    ? Math.max(0, Math.min(subtotalCents, cents(proposal.taxableSubtotal)))
    : taxCents > 0 ? subtotalCents : 0;
  const nonTaxableCents = subtotalCents - explicitTaxableCents;
  let allocatedSubtotal = 0;
  let allocatedTaxable = 0;
  let allocatedNonTaxable = 0;
  let allocatedTax = 0;

  const items = stages.map((stage, index) => {
    const last = index === stages.length - 1;
    const ratio = totalCents > 0 ? Math.max(0, cents(stage.amount)) / totalCents : 0;
    const itemSubtotal = last ? subtotalCents - allocatedSubtotal : Math.round(subtotalCents * ratio);
    const taxableSubtotal = last ? explicitTaxableCents - allocatedTaxable : Math.round(explicitTaxableCents * ratio);
    const itemNonTaxable = last ? nonTaxableCents - allocatedNonTaxable : itemSubtotal - taxableSubtotal;
    const itemTax = last ? taxCents - allocatedTax : Math.round(taxCents * ratio);
    allocatedSubtotal += itemSubtotal;
    allocatedTaxable += taxableSubtotal;
    allocatedNonTaxable += itemNonTaxable;
    allocatedTax += itemTax;
    return {
      id: text(stage.id) || `payment-${index + 1}`,
      label: text(stage.label) || `Payment ${index + 1}`,
      due: text(stage.due),
      sortOrder: Number.isFinite(stage.sortOrder) ? stage.sortOrder : index,
      type: stage.type === 'fixed' ? 'fixed' : 'percentage',
      percentage: Number(stage.percentage) || 0,
      invoiceType: invoiceTypeForStage(stage, index, stages.length),
      subtotal: money(itemSubtotal),
      taxableSubtotal: money(taxableSubtotal),
      nonTaxableSubtotal: money(itemNonTaxable),
      taxAmount: money(itemTax),
      total: money(itemSubtotal + itemTax),
    };
  });

  return {
    schemaVersion: 1,
    proposalVersionId: proposalSnapshot?.id,
    proposalVersionNumber: proposalSnapshot?.versionNumber,
    contractSubtotal: money(subtotalCents),
    taxableSubtotal: money(explicitTaxableCents),
    nonTaxableSubtotal: money(nonTaxableCents),
    taxRate,
    taxAmount: money(taxCents),
    contractTotal: money(totalCents),
    items,
  };
}

export function buildContractInvoiceLines(scheduleItem, description) {
  const lines = [];
  const label = text(description) || text(scheduleItem?.label) || 'Contract billing';
  if (Number(scheduleItem?.taxableSubtotal) > 0) {
    lines.push({
      category: 'contract_service',
      description: label,
      quantity: 1,
      unit: 'contract',
      unitPrice: roundCurrency(scheduleItem.taxableSubtotal),
      unitPriceBeforeTax: roundCurrency(scheduleItem.taxableSubtotal),
      taxable: true,
      contractBilling: true,
      taxAmountOverride: roundCurrency(scheduleItem.taxAmount),
    });
  }
  if (Number(scheduleItem?.nonTaxableSubtotal) > 0) {
    lines.push({
      category: 'contract_service',
      description: lines.length ? `${label} - non-taxable portion` : label,
      quantity: 1,
      unit: 'contract',
      unitPrice: roundCurrency(scheduleItem.nonTaxableSubtotal),
      unitPriceBeforeTax: roundCurrency(scheduleItem.nonTaxableSubtotal),
      taxable: false,
      contractBilling: true,
    });
  }
  return lines;
}

export function paymentScheduleItemState(itemId, invoices, jobId) {
  const linked = (Array.isArray(invoices) ? invoices : [])
    .filter((invoice) => invoice?.paymentScheduleItemId === itemId && invoice?.status !== 'void' && (!jobId || invoice?.jobId === jobId))
    .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))[0];
  return { status: linked?.status ?? 'not_invoiced', invoice: linked ?? null };
}

export function remainingContractBillingItem(schedule, scheduleItem, invoices, jobId) {
  const issued = (Array.isArray(invoices) ? invoices : []).filter((invoice) => invoice?.jobId === jobId && !['draft', 'void'].includes(invoice?.status));
  const taxableInvoiced = issued.flatMap((invoice) => invoice.lineItems ?? []).filter((line) => line.taxable).reduce((sum, line) => sum + (Number(line.subtotal) || Number(line.unitPriceBeforeTax) * Number(line.quantity) || 0), 0);
  const nonTaxableInvoiced = issued.flatMap((invoice) => invoice.lineItems ?? []).filter((line) => !line.taxable).reduce((sum, line) => sum + (Number(line.subtotal) || Number(line.unitPriceBeforeTax) * Number(line.quantity) || 0), 0);
  const taxInvoiced = issued.reduce((sum, invoice) => sum + (Number(invoice.taxAmount) || 0), 0);
  const taxableSubtotal = roundCurrency(Math.max(0, Number(schedule.taxableSubtotal) - taxableInvoiced));
  const nonTaxableSubtotal = roundCurrency(Math.max(0, Number(schedule.nonTaxableSubtotal) - nonTaxableInvoiced));
  const taxAmount = roundCurrency(Math.max(0, Number(schedule.taxAmount) - taxInvoiced));
  return {
    ...scheduleItem,
    subtotal: roundCurrency(taxableSubtotal + nonTaxableSubtotal),
    taxableSubtotal,
    nonTaxableSubtotal,
    taxAmount,
    total: roundCurrency(taxableSubtotal + nonTaxableSubtotal + taxAmount),
  };
}

export function configureContractInvoice({ job, record, invoices, idFactory }) {
  const contractSchedule = job?.contractBillingSchedule;
  if (record?.schemaVersion !== 2 || record?.invoiceType === 'custom' || !contractSchedule?.items?.length) {
    if (record?.schemaVersion === 2 && record?.invoiceType === 'custom') {
      return {
        ok: true,
        record: normalizeInvoiceFinancials({
          ...record,
          paymentScheduleItemId: undefined,
          lineItems: (record.lineItems ?? []).map(({ contractBilling: _contractBilling, taxAmountOverride: _taxAmountOverride, ...line }) => line),
        }),
      };
    }
    if (record?.schemaVersion === 2 && record?.invoiceType !== 'custom') {
      const taxRate = Math.max(0, Number(job?.originalEstimateSnapshot?.taxRate) || 0);
      return {
        ok: true,
        record: normalizeInvoiceFinancials({
          ...record,
          paymentScheduleItemId: undefined,
          taxRate,
          lineItems: (record.lineItems ?? []).map(({ contractBilling: _contractBilling, taxAmountOverride: _taxAmountOverride, ...line }) => ({ ...line, taxable: taxRate > 0 })),
        }),
      };
    }
    return { ok: true, record };
  }

  const scheduleItem = contractSchedule.items.find((item) => item.id === record.paymentScheduleItemId);
  if (!scheduleItem) return { ok: false, error: 'Select a payment schedule item for contract billing.' };
  const otherInvoices = (Array.isArray(invoices) ? invoices : []).filter((invoice) => invoice.id !== record.id);
  const duplicate = otherInvoices.find((invoice) => invoice.paymentScheduleItemId === scheduleItem.id && invoice.status !== 'void');
  if (duplicate) return { ok: false, error: 'This payment schedule item already has an invoice.', invoiceId: duplicate.id };

  const allocation = scheduleItem.invoiceType === 'final'
    ? remainingContractBillingItem(contractSchedule, scheduleItem, otherInvoices, job.id)
    : scheduleItem;
  const description = record.lineItems?.[0]?.description;
  const configured = normalizeInvoiceFinancials({
    ...record,
    invoiceType: scheduleItem.invoiceType,
    paymentScheduleItemId: scheduleItem.id,
    taxRate: contractSchedule.taxRate,
    lineItems: buildContractInvoiceLines(allocation, description).map((line) => ({ ...line, id: idFactory(), amount: 0 })),
  });
  const position = calculateJobInvoicePosition(job, otherInvoices);
  if (configured.subtotal > position.remainingAmount) return { ok: false, error: 'Invoice exceeds the remaining contract amount.' };
  return { ok: true, record: configured };
}