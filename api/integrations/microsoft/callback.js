import { requireSession } from '../../_lib/session.js';
import { getMicrosoftConnection, putMicrosoftConnection } from '../../_lib/microsoftCalendarRepo.js';
import {
  buildEncryptedMicrosoftCredentials,
  consumeMicrosoftOAuthCallbackState,
  exchangeMicrosoftAuthorizationCode,
  fetchMicrosoftAccount,
  listMicrosoftCalendars,
} from '../../_lib/microsoftCalendarService.js';
import { methodNotAllowed, redirectToMicrosoftIntegrations } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!state) return redirectToMicrosoftIntegrations(res, 'invalid_state');
  const consumed = await consumeMicrosoftOAuthCallbackState({ businessId: session.businessId, userId: session.id, state });
  if (!consumed) return redirectToMicrosoftIntegrations(res, 'invalid_state');
  if (typeof req.query.error === 'string') return redirectToMicrosoftIntegrations(res, 'denied');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return redirectToMicrosoftIntegrations(res, 'missing_code');

  try {
    const existing = await getMicrosoftConnection({ businessId: session.businessId, userId: session.id });
    const tokens = await exchangeMicrosoftAuthorizationCode(code, consumed.codeVerifier);
    const [account, calendars] = await Promise.all([
      fetchMicrosoftAccount({ accessToken: tokens.access_token }),
      listMicrosoftCalendars({ accessToken: tokens.access_token }),
    ]);
    const selected = calendars.find((calendar) => calendar.primary && calendar.canEdit) ?? calendars.find((calendar) => calendar.canEdit);
    if (!selected) return redirectToMicrosoftIntegrations(res, 'no_calendars');
    const credentials = buildEncryptedMicrosoftCredentials({
      businessId: session.businessId,
      userId: session.id,
      tokens,
      existingRefreshToken: existing?.encryptedRefreshToken,
    });
    await putMicrosoftConnection({
      businessId: session.businessId,
      userId: session.id,
      connection: {
        microsoftAccountId: account.id,
        microsoftAccountEmail: account.email,
        microsoftAccountName: account.displayName,
        selectedCalendarId: selected.id,
        selectedCalendarSummary: selected.summary,
        ...credentials,
      },
    });
    return redirectToMicrosoftIntegrations(res, 'connected');
  } catch {
    return redirectToMicrosoftIntegrations(res, 'connection_failed');
  }
}