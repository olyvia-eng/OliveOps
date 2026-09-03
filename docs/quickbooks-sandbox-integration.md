# QuickBooks Online Sandbox Integration

Phase 1 connects one QuickBooks Online sandbox company to one OliveOps business. OliveOps remains the invoice record. QuickBooks is an optional accounting destination.

## Intuit sandbox setup

1. Create or select an Intuit Developer app with the QuickBooks Online Accounting scope.
2. Use the app's development credentials. Do not use production credentials for Phase 1.
3. Register the exact callback URL:

   `https://<oliveops-host>/api/integrations/quickbooks/callback`

4. Configure these server-side environment variables:

   - `QUICKBOOKS_CLIENT_ID`
   - `QUICKBOOKS_CLIENT_SECRET`
   - `QUICKBOOKS_REDIRECT_URI`
   - `QUICKBOOKS_TOKEN_ENCRYPTION_KEY`

Generate the encryption key once and store it securely:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Changing or losing this key makes stored QuickBooks credentials undecryptable. Use a separate value from `GOOGLE_TOKEN_ENCRYPTION_KEY`.

## Security model

- Only OliveOps owners and admins can connect, configure, synchronize, create QuickBooks invoices, or disconnect.
- OAuth state is random, stored only as a SHA-256 hash, expires after ten minutes, and is consumed atomically once.
- Tokens are exchanged and used only on the server.
- AES-256-GCM authenticated data binds QuickBooks credentials to provider, OliveOps business, and QuickBooks realm.
- Browser status responses never contain tokens, encrypted envelopes, client secrets, or refresh leases.
- Rotating refresh tokens are protected by a short conditional DynamoDB lease so stale concurrent requests cannot overwrite newer credentials.
- All provider API traffic is pinned to `sandbox-quickbooks.api.intuit.com`. Phase 1 has no production API switch.

## Required configuration

After connecting, an owner or admin must explicitly:

1. Map each OliveOps invoice category in use to an active QuickBooks Product/Service Item.
2. Select an active taxable QuickBooks sales tax code when taxable invoices will be synchronized.
3. Select an active non-taxable QuickBooks sales tax code. A single valid option may be preselected; multiple options require an explicit choice.
4. Map each OliveOps customer to an existing QuickBooks customer or explicitly create it in QuickBooks.

OliveOps never guesses Product/Service Items, income accounts, tax codes, customer matches, or currency conversion.

## Invoice behavior

- Legacy OliveOps invoices retain tax-inclusive `unitPrice` calculations and are sent to QuickBooks with `TaxInclusive` semantics.
- Schema version 2 invoices use explicit pre-tax `unitPriceBeforeTax` values. OliveOps rounds each line subtotal and tax independently, and sends these invoices to QuickBooks with `TaxExcluded` semantics.
- Before creation, OliveOps verifies that the current QuickBooks taxable code rate is compatible with the authoritative OliveOps invoice tax rate. Unknown or materially different treatment blocks only QuickBooks synchronization and leaves the OliveOps invoice unchanged.
- Draft invoices cannot be created in QuickBooks. A user must explicitly mark the OliveOps invoice Sent first.
- Historical flat invoices remain readable but cannot be created in QuickBooks until a user adds line details.
- Each local invoice creates at most one QuickBooks invoice per QuickBooks realm.
- Intuit receives a deterministic request ID, so retrying the same logical creation does not intentionally issue a different create request.
- After creation, OliveOps reads QuickBooks document number, total, balance, due status, and payment completion. OliveOps does not create payments or overwrite QuickBooks accounting state.
- Later local edits are displayed as `Local changes not synced`; Phase 1 does not automatically update or delete the QuickBooks invoice.

## Disconnect and reconnect

Disconnect attempts token revocation and always removes local credentials even if Intuit is unavailable. Customer and invoice mapping history remains realm-scoped so reconnecting the same company does not create duplicates. A different realm cannot reuse another company's mappings.

## Audit events

OliveOps records sanitized audit events for connection, disconnection, customer mapping/creation, and invoice creation. Audit metadata may contain local IDs, QuickBooks entity IDs, realm ID, company name, and sandbox environment. It must never contain OAuth tokens, secrets, encrypted envelopes, or full provider error responses.

## Not included in Phase 1

- Production QuickBooks companies
- Expenses, vendors, bills, purchase orders, or payments
- Bank feeds or reconciliation
- Payroll
- Journal entries or general-ledger synchronization
- Tax filing or accounting advice
- Currency conversion
- Automatic invoice updates or deletes
- Broad two-way or background synchronization