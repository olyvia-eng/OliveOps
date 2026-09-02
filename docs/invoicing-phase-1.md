# Invoicing Phase 1

OliveOps is the source of truth for invoices. QuickBooks is an optional, downstream accounting destination.

## Schema compatibility

Historical invoices remain unchanged and readable. On those records, `unitPrice` is tax-inclusive, `amount` is the gross line or invoice amount, and included tax is extracted from taxable gross lines. These fields are never silently reinterpreted.

New invoices use `schemaVersion: 2` and `pricingMode: tax_exclusive`:

- `invoiceType` identifies deposit, progress, final, or custom billing.
- `estimateId` and `sourceEstimateSnapshotId` identify the Job's authoritative original estimate snapshot.
- `customerNameSnapshot`, `billingAddressSnapshot`, `jobTitleSnapshot`, and `jobAddressSnapshot` preserve issued context independently of later Customer or Job edits.
- `contractAmountSnapshot` is the authoritative pre-tax Job contract value at save time.
- `previouslyInvoicedSnapshot` is the sum of issued, non-void pre-tax invoice subtotals for the Job.
- `remainingContractAmountSnapshot` is contract amount less previously invoiced, never below zero.
- `paymentTermsDays` records the terms used to derive the initial due date. The due date remains independently editable.
- `sentAt`, `voidedAt`, and `voidReason` are server-controlled lifecycle audit fields.
- `overContract` records a confirmed custom invoice that exceeds the remaining contract amount.
- `quickBooksLinked` is a read projection indicating a persisted provider mapping; it is not stored on the invoice itself.

For each schema v2 line, `unitPriceBeforeTax` is the pre-tax unit price, `subtotal` is rounded quantity times unit price, `taxAmount` is rounded line subtotal times tax rate for taxable lines, and `total` is subtotal plus tax. `amount` remains populated with the line total for compatibility. Invoice subtotal, tax, and amount are sums of rounded lines. The server always recalculates all derived fields.

Source lines snapshot `sourceWorkAreaId`, `sourceLineItemId`, category, description, quantity, unit, pre-tax price, and taxable status. Future Estimate or Job-plan edits do not mutate saved invoices.

## Contract authority

Contract value uses the first available non-negative value in this order: `Job.currentContractRevenue`, `Job.originalContractRevenue`, `Job.contractValue`, then `Job.originalEstimateSnapshot.subtotal`. Draft and void invoices do not reduce availability. Issued legacy invoices use their stored subtotal when available, otherwise their historical amount.

## Numbering and lifecycle

The backend reserves `INV-YYYY-NNN` from a DynamoDB item keyed by `BUSINESS#<businessId>` and `INVOICE_COUNTER#<year>`. One atomic `UpdateItem` expression uses `ADD sequence :increment` and `ReturnValues: UPDATED_NEW`. Failed creates may leave gaps. Existing invoice numbers are immutable.

New invoices are always Draft. Allowed transitions are Draft to Sent; Sent to Partially Paid, Paid, Overdue, or Void; Partially Paid or Overdue to each other, Paid, or Void. Paid and Void are terminal. Voiding requires a reason and creates an audit event. Payment recording remains deferred, so the status model is ready for the Phase 2 payment workflow without changing stored invoices.

Only unlinked Drafts can be hard-deleted. Issued or QuickBooks-linked invoices are read-only for financial fields. QuickBooks-linked records remain locked even when the integration is disconnected.

## QuickBooks projection

Legacy line invoices retain QuickBooks `TaxInclusive` projection. Schema v2 invoices use `TaxExcluded`, pre-tax unit prices, and pre-tax line amounts. Existing mapping keys and source hashes are unchanged. Drafts cannot be created in QuickBooks; users must explicitly mark them Sent first. Provider balances remain display-only and do not overwrite OliveOps status.

## Deferred to Phase 2

Payment recording, online payments, customer portal, PDF generation, email delivery, two-way QuickBooks synchronization, recurring invoices, retainage, and credit notes remain deferred.