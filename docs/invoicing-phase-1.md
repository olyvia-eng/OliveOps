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
- `sentAt`, `voidedAt`, and `voidReason` are server-controlled lifecycle audit fields. Billing and job addresses are separate: billing uses only the Customer billing, mailing, or legacy `address` field, while job address uses only `Job.propertyAddressSnapshot`.
- `overContract` records a confirmed custom invoice that exceeds the remaining contract amount.
- `quickBooksLinked` is a read projection indicating a persisted provider mapping; it is not stored on the invoice itself.

For each schema v2 line, `unitPriceBeforeTax` is the pre-tax unit price, `subtotal` is rounded quantity times unit price, `taxAmount` is rounded line subtotal times tax rate for taxable lines, and `total` is subtotal plus tax. `amount` remains populated with the line total for compatibility. Invoice subtotal, tax, and amount are sums of rounded lines. The server always recalculates all derived fields.

Invoice lines use an invoice-specific category set: `contract_service`, `labour`, `material`, `equipment`, and `subcontractor`. Generated Deposit, fixed or percentage Progress, and Final lump-sum lines use `contract_service` (displayed as Contract Services). Imported Job source lines retain their snapshotted resource category. Estimate pricing categories remain unchanged.

Source lines snapshot `sourceWorkAreaId`, `sourceLineItemId`, category, description, quantity, unit, pre-tax price, and taxable status. Future Estimate or Job-plan edits do not mutate saved invoices.

QuickBooks configuration may map Contract Services independently from the four existing resource categories. Existing configurations remain readable and valid. An invoice containing a Contract Services line cannot sync until that category has an explicit QuickBooks Product/Service mapping; it never falls back to Labour or another mapping.

## Contract authority

Contract value uses the first available non-negative value in this order: `Job.currentContractRevenue`, `Job.originalContractRevenue`, `Job.contractValue`, then `Job.originalEstimateSnapshot.subtotal`. Draft and void invoices do not reduce availability. Issued invoices consume their pre-tax accounting revenue using the same fallback rules as Budget P&L.

Invoice `amount` is the customer-facing tax-inclusive total. Balance is also tax-inclusive. Accounting revenue and contract consumption exclude HST: they use a valid stored subtotal, then amount less stored tax, then derived legacy line calculations, and only fall back to amount when no tax detail exists.

## Numbering and lifecycle

The backend reserves `INV-YYYY-NNN` from a DynamoDB item keyed by `BUSINESS#<businessId>` and `INVOICE_COUNTER#<year>`. One atomic `UpdateItem` expression uses `ADD sequence :increment` and `ReturnValues: UPDATED_NEW`. Failed creates may leave gaps. Existing invoice numbers are immutable.

New invoices are always Draft. Generic Phase 1 updates allow Draft to Sent, Sent to Void, persisted legacy Overdue to Void, and safe same-status retries. Overdue is normally derived for display from an unpaid issued invoice's due date and is not manually persisted. Generic PATCH cannot set Partially Paid or Paid; those historical statuses remain readable and are reserved for the future canonical payment workflow. Paid and Void are terminal. Voiding requires a reason and creates an audit event.

Drafts do not reserve contract availability. Sending uses one DynamoDB transaction to conditionally update the invoice and the `JOB_INVOICE_LEDGER#<jobId>` aggregate under the business partition. The ledger stores pre-tax `issuedAmount` plus invoice-specific reservation and release markers. This prevents concurrent sends from consuming the same remaining balance and makes Send and Void retries idempotent. Confirmed Custom invoices may exceed the contract limit but still reserve their full pre-tax amount.

When a Job ledger is first created, it is seeded from the current issued, non-void historical invoice total. Historical invoices remain the reconciliation source before that point. Voiding a historical invoice conditionally releases it when a ledger exists; when no ledger exists, the transaction verifies that absence while voiding so a concurrent initialization cannot create a stale balance. A future maintenance reconciliation may rebuild `issuedAmount` from issued, non-void invoices and their reservation markers without altering invoice records.

Only unlinked Drafts can be hard-deleted. Issued or QuickBooks-linked invoices are read-only for financial fields. QuickBooks-linked records remain locked even when the integration is disconnected.

## QuickBooks projection

Legacy line invoices retain QuickBooks `TaxInclusive` projection. Schema v2 invoices use `TaxExcluded`, pre-tax unit prices, and pre-tax line amounts. Existing mapping keys and source hashes are unchanged. Drafts cannot be created in QuickBooks; users must explicitly mark them Sent first. Provider balances remain display-only and do not overwrite OliveOps status.

## Deferred to Phase 2

Payment recording, online payments, customer portal, PDF generation, email delivery, two-way QuickBooks synchronization, recurring invoices, retainage, and credit notes remain deferred.