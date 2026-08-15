import { requireSession } from '../../_lib/session.js';
import { getGoogleConnection, putGoogleConnection } from '../../_lib/googleCalendarRepo.js';
import {
  buildEncryptedGoogleCredentials,
  exchangeGoogleAuthorizationCode,
  fetchGoogleAccountEmail,
  listGoogleCalendars,
  validateGoogleOAuthCallbackState,
} from '../../_lib/googleCalendarService.js';
import { methodNotAllowed, redirectToIntegrations } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = await requireSession(req, res);
  if (!session) return;

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!state) return redirectToIntegrations(res, 'invalid_state');

  const validState = await validateGoogleOAuthCallbackState({
    businessId: session.businessId,
    userId: session.id,
    state,
  });
  if (!validState) return redirectToIntegrations(res, 'invalid_state');

  if (typeof req.query.error === 'string') return redirectToIntegrations(res, 'denied');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return redirectToIntegrations(res, 'missing_code');

  try {
    const existing = await getGoogleConnection({ businessId: session.businessId, userId: session.id });
    const tokens = await exchangeGoogleAuthorizationCode(code);
    const googleAccountEmail = await fetchGoogleAccountEmail(tokens.access_token);
    const calendars = await listGoogleCalendars({ accessToken: tokens.access_token });
    const primary = calendars.find((calendar) => calendar.primary) ?? calendars[0];
    if (!primary) return redirectToIntegrations(res, 'no_calendars');
    const credentials = buildEncryptedGoogleCredentials({
      businessId: session.businessId,
      userId: session.id,
      tokens,
      existingRefreshToken: existing?.encryptedRefreshToken,
    });
    await putGoogleConnection({
      businessId: session.businessId,
      userId: session.id,
      connection: {
        googleAccountEmail,
        selectedCalendarId: primary.id,
        selectedCalendarSummary: primary.summary,
        ...credentials,
      },
    });
    return redirectToIntegrations(res, 'connected');
  } catch {
    return redirectToIntegrations(res, 'connection_failed');
  }
}