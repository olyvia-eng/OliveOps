# Google Calendar Integration

OliveOps uses its existing Vite client and Vercel serverless API architecture. Google OAuth and Calendar API requests run only in `api/`; the browser never receives client secrets, refresh tokens, access tokens, or encrypted credential envelopes.

## Google Cloud setup

1. Create or select a Google Cloud project.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen and add the users required by the Google test project while the app is in testing mode.
4. Create a Web application OAuth client.
5. Add the exact callback URL used by the deployment, for example `https://app.example.com/api/integrations/google/callback`, to Authorized redirect URIs.

OliveOps requests only identity/email, calendar-list read access, and calendar-event access. Connections use offline access so scheduled jobs can continue synchronizing after the initial browser authorization.

## Environment variables

Configure these variables in Vercel for every environment where the integration is enabled:

- `GOOGLE_CLIENT_ID`: Google OAuth web client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth web client secret.
- `GOOGLE_REDIRECT_URI`: Exact registered callback URL.
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: Stable base64-encoded 32-byte AES key.

Generate an encryption key with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Do not use a different encryption key across serverless instances in the same environment. Changing this key without re-encrypting stored credentials makes existing connections unreadable; disconnect and reconnect affected accounts as the Phase 1 rotation procedure.

The existing DynamoDB role needs `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, and `Query` permissions for the OliveOps table. Google records remain under `PK = BUSINESS#<businessId>` and include the authenticated OliveOps user in their sort key and record ownership fields.

## Behavior

- Connections and preferences are per OliveOps company and user.
- Only owners and admins can connect accounts in Phase 1.
- The primary Google calendar is selected by default. Users may select another writable calendar.
- Google-originated events are read-only and never create OliveOps jobs.
- Each enabled connection gets its own deterministic copy of an OliveOps scheduled job.
- OliveOps schedule changes succeed even when Google is unavailable; failed synchronization attempts are stored without OAuth credentials.
- Disabling outbound sync leaves existing Google events in place. Re-enabling reconciles current confirmed jobs without creating duplicate IDs.
- Disconnect attempts Google token revocation and removes local connection credentials and event projections even if Google is unavailable.

Phase 1 does not poll, create push-notification channels, process incremental sync tokens, invite attendees, or implement employee/division filters. Repository records reserve settings and synchronization metadata for those later additions.