import { createHash } from 'node:crypto';
import { requireEnv } from './env.js';
import { decryptSecret, encryptSecret } from './secretEncryption.js';
import {
  consumeOAuthState,
  hashOAuthState,
  putGoogleConnection,
} from './googleCalendarRepo.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export const GOOGLE_CALENDAR_SCOPES = Object.freeze([
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]);

export async function validateGoogleOAuthCallbackState({ businessId, userId, state, consumeState = consumeOAuthState }) {
  if (typeof state !== 'string' || !state) return false;
  try {
    const consumed = await consumeState({
      businessId,
      userId,
      stateHash: hashOAuthState(state),
    });
    return Boolean(consumed);
  } catch {
    return false;
  }
}

function oauthConfig() {
  return {
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirectUri: requireEnv('GOOGLE_REDIRECT_URI'),
  };
}

async function readGoogleResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? payload?.error_description ?? 'Google Calendar request failed');
    error.status = response.status;
    error.code = payload?.error?.status ?? payload?.error ?? 'GOOGLE_API_ERROR';
    throw error;
  }
  return payload ?? {};
}

async function postForm(url, values, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  return readGoogleResponse(response);
}

export function buildGoogleAuthorizationUrl({ state, config = oauthConfig() }) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    state,
  }).toString();
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(code, { fetchImpl = fetch, config = oauthConfig() } = {}) {
  return postForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  }, fetchImpl);
}

export async function fetchGoogleAccountEmail(accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await readGoogleResponse(response);
  if (typeof payload.email !== 'string' || !payload.email) {
    throw new Error('Google account did not provide an email address');
  }
  return payload.email.trim().toLowerCase();
}

export function buildEncryptedGoogleCredentials({ businessId, userId, tokens, existingRefreshToken }) {
  const context = { businessId, userId };
  const expiresIn = Number(tokens.expires_in);
  const accessTokenExpiresAt = Number.isFinite(expiresIn)
    ? new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000).toISOString()
    : new Date(Date.now() + 50 * 60 * 1000).toISOString();
  const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token
    ? encryptSecret(tokens.refresh_token, context)
    : existingRefreshToken;
  if (!refreshToken) throw new Error('Google did not provide a refresh token');

  return {
    encryptedRefreshToken: refreshToken,
    encryptedAccessToken: encryptSecret(tokens.access_token, context),
    accessTokenExpiresAt,
    grantedScopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : [],
  };
}

export async function getValidGoogleAccessToken({ businessId, userId, connection, fetchImpl = fetch }) {
  const context = { businessId, userId };
  if (
    connection.encryptedAccessToken
    && typeof connection.accessTokenExpiresAt === 'string'
    && Date.parse(connection.accessTokenExpiresAt) > Date.now() + 30_000
  ) {
    return decryptSecret(connection.encryptedAccessToken, context);
  }

  const refreshToken = decryptSecret(connection.encryptedRefreshToken, context);
  const config = oauthConfig();
  const tokens = await postForm(GOOGLE_TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  }, fetchImpl);
  const encrypted = buildEncryptedGoogleCredentials({
    businessId,
    userId,
    tokens,
    existingRefreshToken: connection.encryptedRefreshToken,
  });
  await putGoogleConnection({ businessId, userId, connection: { ...connection, ...encrypted } });
  return tokens.access_token;
}

async function googleApiRequest({ accessToken, path, method = 'GET', query, body, fetchImpl = fetch }) {
  const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
  }
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readGoogleResponse(response);
}

export async function listGoogleCalendars({ accessToken, fetchImpl = fetch }) {
  const calendars = [];
  let pageToken;
  do {
    const payload = await googleApiRequest({
      accessToken,
      path: '/users/me/calendarList',
      query: { maxResults: 250, pageToken },
      fetchImpl,
    });
    calendars.push(...(payload.items ?? []).map((calendar) => ({
      id: calendar.id,
      summary: calendar.summaryOverride ?? calendar.summary ?? calendar.id,
      primary: calendar.primary === true,
      accessRole: calendar.accessRole ?? 'reader',
      backgroundColor: calendar.backgroundColor ?? null,
    })));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return calendars;
}

export function mapGoogleEvent(event, calendarId) {
  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (typeof event.id !== 'string' || typeof start !== 'string' || typeof end !== 'string') return null;
  return {
    googleEventId: event.id,
    googleCalendarId: calendarId,
    title: typeof event.summary === 'string' && event.summary.trim() ? event.summary.trim() : '(No title)',
    start,
    end,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
    location: typeof event.location === 'string' ? event.location : '',
    status: event.status ?? 'confirmed',
    htmlLink: typeof event.htmlLink === 'string' ? event.htmlLink : '',
    googleUpdatedAt: event.updated ?? null,
    etag: event.etag ?? null,
    source: 'google',
    oliveOpsJobId: event.extendedProperties?.private?.oliveOpsJobId ?? null,
  };
}

export async function listGoogleEvents({ accessToken, calendarId, timeMin, timeMax, fetchImpl = fetch }) {
  const events = [];
  let pageToken;
  do {
    const payload = await googleApiRequest({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      query: {
        timeMin,
        timeMax,
        singleEvents: true,
        showDeleted: true,
        maxResults: 2500,
        pageToken,
      },
      fetchImpl,
    });
    for (const item of payload.items ?? []) {
      const mapped = mapGoogleEvent(item, calendarId);
      if (mapped) events.push(mapped);
    }
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return events;
}

export function buildDeterministicGoogleEventId({ businessId, userId, calendarId, jobId }) {
  return `oo${createHash('sha256').update(`${businessId}\0${userId}\0${calendarId}\0${jobId}`).digest('hex').slice(0, 48)}`;
}

export function mapJobToGoogleEvent({ businessId, userId, calendarId, job, customer, employees = [], appOrigin }) {
  const allDay = job.scheduleAllDay === true || !job.scheduledStartAt || !job.scheduledEndAt;
  const crew = employees.map((employee) => employee.name).filter(Boolean).join(', ');
  const description = [
    job.jobNumber ? `Job number: ${job.jobNumber}` : null,
    customer?.name ? `Customer: ${customer.name}` : null,
    crew ? `Crew: ${crew}` : null,
    job.scheduleNotes?.trim() || job.notes?.trim() || null,
    appOrigin ? `Open in OliveOps: ${new URL(`/jobs/${encodeURIComponent(job.id)}`, appOrigin).toString()}` : null,
  ].filter(Boolean).join('\n');
  const payload = {
    id: buildDeterministicGoogleEventId({ businessId, userId, calendarId, jobId: job.id }),
    summary: job.title || customer?.name || 'OliveOps job',
    location: job.propertyAddressSnapshot || job.propertyLabel || '',
    description,
    extendedProperties: {
      private: {
        oliveOpsBusinessId: businessId,
        oliveOpsJobId: job.id,
        oliveOpsSource: 'job',
      },
    },
  };
  if (allDay) {
    payload.start = { date: job.startDate };
    payload.end = { date: addOneDay(job.endDate || job.startDate) };
  } else {
    payload.start = { dateTime: job.scheduledStartAt };
    payload.end = { dateTime: job.scheduledEndAt };
  }
  return payload;
}

function addOneDay(dateValue) {
  const [year, month, day] = String(dateValue).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

export async function upsertGoogleEvent({ accessToken, calendarId, googleEventId, event, fetchImpl = fetch }) {
  try {
    return await googleApiRequest({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      method: 'PATCH',
      body: event,
      fetchImpl,
    });
  } catch (error) {
    if (error.status !== 404) throw error;
    return googleApiRequest({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      method: 'POST',
      query: { sendUpdates: 'none' },
      body: { ...event, id: googleEventId },
      fetchImpl,
    });
  }
}

export async function deleteGoogleEvent({ accessToken, calendarId, googleEventId, fetchImpl = fetch }) {
  try {
    await googleApiRequest({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      method: 'DELETE',
      query: { sendUpdates: 'none' },
      fetchImpl,
    });
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error;
  }
}

export async function revokeGoogleCredential(token, fetchImpl = fetch) {
  if (!token) return;
  await postForm(GOOGLE_REVOKE_URL, { token }, fetchImpl);
}