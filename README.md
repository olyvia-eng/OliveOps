# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Multi-User Accounts

This app now supports business-level user accounts in-app:

- A business owner signs up from `/signup`.
- The owner is created with role `owner`.
- Owner/admin users can create additional `employee` and `admin` users from **User Access**.
- Users sign in through `/login`.

### Roles

- `owner`: business creator, full access.
- `admin`: secondary admin, can create users.
- `employee`: standard user.

## DynamoDB Setup (Your Side)

The app now stores auth data in DynamoDB through Vercel serverless APIs.

### 1. Create the table

In AWS DynamoDB, create one table:

- Table name: `OliveOpsAuth` (or your choice)
- Partition key: `PK` (String)
- Sort key: `SK` (String)
- Billing: On-demand (recommended to start)

No GSI is required for this current implementation.

### 2. Create AWS credentials for Vercel

Create an IAM user with programmatic access and permissions limited to this table.

Minimum policy actions:

- `dynamodb:GetItem`
- `dynamodb:PutItem`
- `dynamodb:Query`
- `dynamodb:TransactWriteItems`

Scope these to your table ARN.

### 3. Add Vercel environment variables

In your Vercel project, go to Settings -> Environment Variables and add:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `DDB_TABLE_NAME` (example: `OliveOpsAuth`)
- `JWT_SECRET` (long random string)
- `GOOGLE_CLIENT_ID` (Google OAuth web client ID)
- `GOOGLE_CLIENT_SECRET` (Google OAuth web client secret)
- `GOOGLE_REDIRECT_URI` (exact registered OAuth callback URL)
- `GOOGLE_TOKEN_ENCRYPTION_KEY` (stable base64-encoded 32-byte key)
- `VITE_GOOGLE_MAPS_API_KEY` (HTTP-referrer-restricted browser key for optional Canadian address autocomplete)
- `MICROSOFT_CLIENT_ID` (Microsoft Entra Application client ID)
- `MICROSOFT_CLIENT_SECRET` (Microsoft Entra Web client secret)
- `MICROSOFT_REDIRECT_URI` (exact registered callback URL ending in `/api/integrations/microsoft/callback`)
- `MICROSOFT_TOKEN_ENCRYPTION_KEY` (separate stable base64-encoded 32-byte key)
- `APP_ORIGIN` (canonical OliveOps origin used in synchronized event links)
- `QUICKBOOKS_CLIENT_ID` (Intuit sandbox app client ID)
- `QUICKBOOKS_CLIENT_SECRET` (Intuit sandbox app client secret)
- `QUICKBOOKS_REDIRECT_URI` (exact registered sandbox callback URL ending in `/api/integrations/quickbooks/callback`)
- `QUICKBOOKS_TOKEN_ENCRYPTION_KEY` (separate stable base64-encoded 32-byte key)

Add them for Production (and Preview/Development if needed), then redeploy.

See [Google Calendar Integration](docs/google-calendar-integration.md) for OAuth setup, scopes, encryption, and synchronization behavior.

See [Google Places Address Autocomplete](docs/google-places-address-autocomplete.md) for required APIs, browser-key restrictions, local setup, and fallback behavior.

See [Microsoft 365 Calendar Integration](docs/microsoft-calendar-integration.md) for Entra registration, Graph permissions, redirect URIs, encryption, and synchronization behavior.

See [QuickBooks Sandbox Integration](docs/quickbooks-sandbox-integration.md) for sandbox setup, explicit accounting mappings, customer synchronization, invoice creation, and Phase 1 boundaries.

### 4. Local development notes

The auth APIs are in `api/` and are served by Vercel runtime.

- `npm run dev` starts Vite only on `http://localhost:5174`
- `npm run dev:full` starts the app plus API routes on `http://localhost:5173`
- `npm run dev:clean` clears stale listeners on common local dev ports
- `npm run dev:health` checks required env keys, local port collisions, and auth endpoint reachability
- `npm run dev:full:clean` runs cleanup first, then starts full stack

### 5. Data model used in the table

Examples of stored items:

- Business profile
  - `PK = BUSINESS#<businessId>`
  - `SK = PROFILE`
- User record
  - `PK = BUSINESS#<businessId>`
  - `SK = USER#<userId>`
- Global email lookup
  - `PK = EMAIL#<normalizedEmail>`
  - `SK = USER`

This model enforces unique email and supports listing users by business.

## Budget Multi-Budget Migration

When upgrading from single-budget data to multi-budget data, legacy budget-related records may not have a `budgetId` yet. Use the migration endpoint below to backfill those records safely.

Endpoint: `/api/budget-migration`

- `GET /api/budget-migration`: dry-run (no writes)
- `POST /api/budget-migration`: execute migration
- Optional `targetBudgetId` can be provided on query or body to force a target budget.

Examples (authenticated owner/admin session required):

```bash
# Dry-run preview
curl -X GET "http://localhost:5173/api/budget-migration" -b "<your-session-cookie>"

# Execute migration using latest budget (or auto-create a legacy budget if none exists)
curl -X POST "http://localhost:5173/api/budget-migration" -b "<your-session-cookie>"

# Execute migration into a specific budget
curl -X POST "http://localhost:5173/api/budget-migration?targetBudgetId=<budget-id>" -b "<your-session-cookie>"
```

The migration backfills `budgetId` on:

- Budget items
- Labour budget plans
- Labour hours sales goals
- Revenue sales goals
