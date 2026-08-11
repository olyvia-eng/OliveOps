# Microsoft 365 Calendar Integration

OliveOps connects each owner or admin to one editable Outlook calendar through Microsoft Graph delegated OAuth. The integration reads external events into Calendar and Home and can synchronize confirmed OliveOps jobs into the selected calendar. Google and Outlook connections operate independently.

## Microsoft Entra registration

1. Register an application in Microsoft Entra ID.
2. Select **Accounts in any organizational directory and personal Microsoft accounts**.
3. Add a **Web** platform.
4. Register each exact callback URI:
   - Production: `https://<production-domain>/api/integrations/microsoft/callback`
   - Local full stack: `http://localhost:5173/api/integrations/microsoft/callback`
   - Staging: use a stable staging alias and register it explicitly.
5. Create a client secret and store it only in the corresponding Vercel environment.

Arbitrary Vercel preview wildcard callback URIs are not supported by Microsoft Entra. Use a stable staging hostname for integration testing.

## Graph permissions

Configure delegated Microsoft Graph permissions only:

- `User.Read`: connected-account display metadata.
- `Calendars.ReadWrite`: list/read calendars and create, update, and delete synchronized events.
- `offline_access`: requested during OAuth so OliveOps can refresh delegated access.

Do not add application permissions, directory permissions, mail permissions, `Calendars.ReadWrite.Shared`, or `User.RevokeSessions.All`. Shared/delegated calendars are outside this phase.

## Vercel variables

- `MICROSOFT_CLIENT_ID`: Entra Application (client) ID.
- `MICROSOFT_CLIENT_SECRET`: confidential Web client secret.
- `MICROSOFT_REDIRECT_URI`: exact callback URI registered for that environment.
- `MICROSOFT_TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte AES key, independent from Google and QuickBooks keys.
- `APP_ORIGIN`: canonical OliveOps origin, such as `https://app.example.com`.

Keep the encryption key stable across deployments. Changing it without a credential migration requires every connected user to reconnect.

## Security model

- OAuth uses the Microsoft identity platform `common` authority, authorization code flow, S256 PKCE, and one-time SHA-256 state records with a ten-minute TTL.
- Code exchange, refresh, and Graph requests occur only on the server.
- PKCE verifiers and access/refresh tokens are encrypted using AES-256-GCM authenticated to the provider, OliveOps business, and OliveOps user.
- Microsoft refresh tokens may rotate. A conditional DynamoDB lease ensures only one request persists refreshed credentials.
- Graph pagination links are followed only when they remain HTTPS URLs on `graph.microsoft.com/v1.0`.
- Browser responses contain safe account/calendar metadata and normalized events, never tokens, client secrets, PKCE material, encryption envelopes, or raw provider error descriptions.

## Event behavior

- Calendar and Home show Google and Outlook events through one read-only external-event model with separate visibility toggles.
- OliveOps sends confirmed, non-cancelled scheduled jobs only when Outlook job synchronization is enabled.
- Creates use a deterministic Graph `transactionId`. The returned immutable Graph event ID is stored and reused for updates and deletes.
- Job reschedules and content changes PATCH the existing event.
- Job cancellation, unscheduling, or deletion removes a mapped event, including after outbound synchronization has been disabled while the connection remains active.
- Disabling synchronization retains existing Outlook events and stops new upserts.
- Disconnect deletes local credentials, projections, and mappings but retains Outlook events and synchronization audit records.
- Switching calendars while synchronization is active removes old mapped events before reconciling eligible jobs into the new calendar.

OliveOps does not add attendees, create Teams meetings, subscribe to webhooks, edit external events, or write external changes back into OliveOps.

## Disconnect limitation

Microsoft does not provide a narrow app-only refresh-token revocation endpoint that works for both organizational and personal accounts. OliveOps therefore destroys its local credentials on disconnect. It does not call `/me/revokeSignInSessions`, which would revoke sessions for unrelated applications and requires broader permission. Users may separately remove OliveOps consent from their Microsoft account security settings.

## Verification

Before production rollout:

1. Connect one Microsoft 365 work account and one Outlook.com personal account.
2. Confirm only editable calendars are selectable.
3. Connect Google and Outlook concurrently and verify independent visibility toggles.
4. Create, reschedule, unschedule, cancel, and delete a confirmed job.
5. Disable synchronization and confirm existing events remain while later cancellation still removes the mapped event.
6. Revoke Microsoft consent and verify OliveOps requests reconnection without hiding healthy Google events.
7. Confirm Calendar and Home external events remain read-only on desktop and mobile.