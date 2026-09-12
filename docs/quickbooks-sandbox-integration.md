# QuickBooks Online Integration

Phase 1 connects one QuickBooks Online company - sandbox or a real, live company - to one OliveOps business. OliveOps remains the invoice record. QuickBooks is an optional accounting destination.

## Intuit app setup

1. Create or select an Intuit Developer app with the QuickBooks Online Accounting scope.
2. Every Intuit app has two separate credential pairs: development (sandbox) keys and production keys, each with their own Client ID/Secret. Use the pair matching the environment you're configuring below - never use production credentials against the sandbox API host, or sandbox credentials against the production host.
3. Register the exact callback URL, once per environment (Intuit lets you register one redirect URI per credential pair):

   `https://<oliveops-host>/api/integrations/quickbooks/callback`

4. Configure these server-side environment variables:

   - `QUICKBOOKS_CLIENT_ID`
   - `QUICKBOOKS_CLIENT_SECRET`
   - `QUICKBOOKS_REDIRECT_URI`
   - `QUICKBOOKS_TOKEN_ENCRYPTION_KEY`
   - `QUICKBOOKS_ENVIRONMENT` - `sandbox` (default) or `production`. This selects which Accounting API host every request is pinned to (`sandbox-quickbooks.api.intuit.com` vs `quickbooks.api.intuit.com`) and must match whichever Client ID/Secret pair you configured above - a sandbox Client ID against the production host (or vice versa) fails outright.

Generate the encryption key once and store it securely:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Changing or losing this key makes stored QuickBooks credentials undecryptable. Use a separate value from `GOOGLE_TOKEN_ENCRYPTION_KEY`.

## Switching a deployment from sandbox to a real company

1. In the Intuit Developer dashboard, switch to the app's **Production** keys tab and copy its Client ID/Secret (production keys are issued immediately - there is no "app review" gate for connecting your own company).
2. If a sandbox company is currently connected for the business, disconnect it first (Settings > Integrations > QuickBooks > Disconnect). A business can only hold one QuickBooks connection at a time, and a sandbox connection cannot be silently reused as a production one.
3. Update `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, and `QUICKBOOKS_REDIRECT_URI` to the production values, and set `QUICKBOOKS_ENVIRONMENT=production`. Redeploy.
4. Reconnect from Settings > Integrations. The OAuth screen now authenticates against real Intuit accounts, and the connected badge reads **LIVE** instead of **SANDBOX**.
5. Re-do the required configuration below (Product/Service mappings, tax codes, customer mappings) - none of it carries over from a sandbox connection, and a different realm cannot reuse another company's mappings.

Once `QUICKBOOKS_ENVIRONMENT=production` is set, every business connected on this deployment talks to real QuickBooks companies and creates real invoices there - there is no per-invoice or per-business sandbox/production toggle.

## OAuth endpoint discovery

The OAuth **authorization**, **token**, and **revocation** endpoints are not hard-coded. OliveOps resolves them from Intuit's [OAuth/OpenID Discovery Document](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-openid-discovery-doc) (`api/_lib/quickBooksDiscovery.js`), so an Intuit-side endpoint rotation doesn't require an OliveOps code change:

- The discovery URL itself is a fixed server-side constant - never derived from a browser/client request.
- A discovered endpoint is used only if it is HTTPS and on one of the exact hosts OliveOps expects (`appcenter.intuit.com`, `oauth.platform.intuit.com`, `developer.api.intuit.com`). A malformed, missing, non-HTTPS, or unexpected-host document is rejected outright rather than partially trusted.
- The validated document is cached in memory for about an hour so OliveOps isn't fetching it on every request.
- Authorization-code exchange and refresh-token exchange both use the discovered token endpoint; discovery failure fails these closed, since there is no endpoint left worth falling back to.
- Disconnect uses the discovered revocation endpoint when Intuit supplies one, but falls back to the last-known-good static revocation endpoint if discovery itself is unavailable - a discovery outage never blocks a user from disconnecting and removing their locally stored credentials.

This is separate from, and does not change, the Accounting API host pinning above: that stays keyed to `QUICKBOOKS_ENVIRONMENT` exactly as described, regardless of what discovery returns.

## Security model

- Only OliveOps owners and admins can connect, configure, synchronize, create QuickBooks invoices, or disconnect.
- OAuth state is random, stored only as a SHA-256 hash, expires after ten minutes, and is consumed atomically once.
- Tokens are exchanged and used only on the server.
- AES-256-GCM authenticated data binds QuickBooks credentials to provider, OliveOps business, and QuickBooks realm.
- Browser status responses never contain tokens, encrypted envelopes, client secrets, or refresh leases.
- Rotating refresh tokens are protected by a short conditional DynamoDB lease so stale concurrent requests cannot overwrite newer credentials.
- All provider API traffic is pinned to the single Accounting API host implied by `QUICKBOOKS_ENVIRONMENT` (`sandbox-quickbooks.api.intuit.com` or `quickbooks.api.intuit.com`) - a deployment cannot address both hosts at once, and nothing in a request (invoice payload, customer id, etc.) can redirect it to the other host.
- OAuth authorize/token/revoke endpoints come from Intuit's own discovery document (see "OAuth endpoint discovery" above), validated against an exact Intuit host allowlist before use - discovery can never redirect these requests to an arbitrary host.

## Required configuration

After connecting, an owner or admin must explicitly:

1. Map each OliveOps invoice category in use to an active QuickBooks Product/Service Item.
2. Select an active taxable QuickBooks sales tax code before synchronizing an invoice with taxable lines.
3. Select an active non-taxable QuickBooks sales tax code before synchronizing an invoice with non-taxable lines. A single valid option may be preselected; multiple options require an explicit choice.
4. Map each OliveOps customer to an existing QuickBooks customer or explicitly create it in QuickBooks.

OliveOps never guesses Product/Service Items, income accounts, tax codes, customer matches, or currency conversion.

Configuration may be saved incrementally. Unmapped categories and blank tax-code selections are valid saved states; synchronization validates only the categories and tax treatments used by the selected invoice.

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

OliveOps records sanitized audit events for connection, disconnection, customer mapping/creation, invoice creation, and QuickBooks request failures (`quickbooks_api_failed` - see below). Audit metadata may contain local IDs, QuickBooks entity IDs, realm ID, company name, environment (`sandbox` or `production`), and Intuit's `intuit_tid` correlation id when Intuit supplied one on that request. It must never contain OAuth tokens, secrets, encrypted envelopes, or full provider error responses. Audit events have no expiry - they are the durable record Intuit's own troubleshooting questionnaire asks about, independent of Vercel's own runtime-log retention window.

## Troubleshooting with Intuit Support

Every QuickBooks Accounting API and OAuth request is read through one centralized response handler (`api/_lib/quickBooksService.js`), which captures Intuit's `intuit_tid` response header - the id Intuit Support asks for when investigating a specific request - for both successes and failures:

- On a failed request, `intuit_tid` (along with the HTTP status and Intuit's own error code) is written to a structured server log (`[quickbooks:failure]`) **and** persisted as a durable `quickbooks_api_failed` audit event (`api/_lib/quickBooksFailureAudit.js`), reusing the same tenant-scoped, no-expiry audit-event system as the events above - not a new logging vendor or table. This covers both Accounting API failures and OAuth token/refresh/revocation failures, whenever the request is scoped to a known business.
- Persisting that audit event is strictly best-effort: it is attempted after the original QuickBooks error is already constructed, wrapped in its own try/catch, and never allowed to throw, delay, or replace the error the caller receives - a DynamoDB outage while writing the diagnostic event still leaves the real QuickBooks error intact.
- A short in-process de-duplication window collapses the same underlying failure (same business, realm, action, status, code, and `intuit_tid`) being recorded more than once if it's ever observed at more than one layer.
- On a successful connection, invoice creation, or customer creation, `intuit_tid` is included in that action's own audit event metadata, alongside the other non-sensitive identifiers already recorded there.
- The header lookup is case-insensitive and a missing header never fails an otherwise valid request, nor blocks the failure audit event from being written - `intuit_tid` is simply `null` in that case.
- Both the log and every audit event here are limited to the same correlation-safe allowlist (action, method, path, realm id, status, error code, `intuit_tid`) - never the request/response body, access tokens, refresh tokens, authorization headers, client secrets, or encryption keys.

### Locating a QuickBooks failure

An owner/admin (or an engineer calling the same endpoint) can locate `quickbooks_api_failed` events through the existing audit-event API, already tenant-scoped and restricted to owner/admin sessions - `GET /api/data?entity=audit-events`, filtered with any of:

- `action=quickbooks_api_failed` - only QuickBooks failures
- `intuitTid=<value>` - the exact request Intuit Support is asking about
- `since=<ISO timestamp>` / `until=<ISO timestamp>` - a date/time range

Settings > Integrations > QuickBooks also surfaces the most recent 25 of these directly (with an `intuit_tid` search box), so this doesn't require a raw API call for the common case.

## Not included in Phase 1

- Expenses, vendors, bills, purchase orders, or payments
- Bank feeds or reconciliation
- Payroll
- Journal entries or general-ledger synchronization
- Tax filing or accounting advice
- Currency conversion
- Automatic invoice updates or deletes
- Broad two-way or background synchronization