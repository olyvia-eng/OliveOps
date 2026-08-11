import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requireEnv } from './env.js';
import { decryptSecret, encryptSecret } from './secretEncryption.js';
import {
  acquireMicrosoftRefreshLease,
  consumeMicrosoftOAuthState,
  getMicrosoftConnection,
  hashMicrosoftOAuthState,
  persistMicrosoftRefreshedCredentials,
  releaseMicrosoftRefreshLease,
} from './microsoftCalendarRepo.js';

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_API = `${GRAPH_ORIGIN}/v1.0`;
export const OLIVEOPS_JOB_PROPERTY_ID = 'String {7a55f0f5-2d63-4c35-bd44-d7fd5a64eb41} Name oliveOpsJobId';

export const MICROSOFT_CALENDAR_SCOPES = Object.freeze([
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
]);

function oauthConfig() {
  return {
    clientId: requireEnv('MICROSOFT_CLIENT_ID'),
    clientSecret: requireEnv('MICROSOFT_CLIENT_SECRET'),
    redirectUri: requireEnv('MICROSOFT_REDIRECT_URI'),
  };
}

const encryptionContext = (businessId, userId) => ({
  provider: 'microsoft-calendar',
  businessId,
  realmId: userId,
});

const encryptionOptions = { envName: 'MICROSOFT_TOKEN_ENCRYPTION_KEY' };

async function readMicrosoftResponse(response) {
  if (response.status === 204) return {};
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error('Microsoft Graph request failed');
    error.status = response.status;
    error.code = String(payload?.error?.code ?? payload?.error ?? 'MICROSOFT_API_ERROR').slice(0, 80);
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
  return readMicrosoftResponse(response);
}

export function createMicrosoftPkcePair() {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function encryptMicrosoftCodeVerifier({ businessId, userId, verifier }) {
  return encryptSecret(verifier, encryptionContext(businessId, userId), undefined, encryptionOptions);
}

export function buildMicrosoftAuthorizationUrl({ state, codeChallenge, config = oauthConfig() }) {
  const url = new URL(MICROSOFT_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export async function consumeMicrosoftOAuthCallbackState({ businessId, userId, state, consumeState = consumeMicrosoftOAuthState }) {
  if (typeof state !== 'string' || !state) return null;
  try {
    const consumed = await consumeState({ businessId, userId, stateHash: hashMicrosoftOAuthState(state) });
    if (!consumed?.encryptedCodeVerifier) return null;
    return {
      ...consumed,
      codeVerifier: decryptSecret(consumed.encryptedCodeVerifier, encryptionContext(businessId, userId), undefined, encryptionOptions),
    };
  } catch {
    return null;
  }
}

export async function exchangeMicrosoftAuthorizationCode(code, codeVerifier, { fetchImpl = fetch, config = oauthConfig() } = {}) {
  return postForm(MICROSOFT_TOKEN_URL, {
    code,
    code_verifier: codeVerifier,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
  }, fetchImpl);
}

export function buildEncryptedMicrosoftCredentials({ businessId, userId, tokens, existingRefreshToken }) {
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('Microsoft did not provide an access token');
  const expiresIn = Number(tokens.expires_in);
  const accessTokenExpiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? Math.max(0, expiresIn - 60) : 3000) * 1000).toISOString();
  const encryptedRefreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token
    ? encryptSecret(tokens.refresh_token, encryptionContext(businessId, userId), undefined, encryptionOptions)
    : existingRefreshToken;
  if (!encryptedRefreshToken) throw new Error('Microsoft did not provide a refresh token');
  return {
    encryptedAccessToken: encryptSecret(tokens.access_token, encryptionContext(businessId, userId), undefined, encryptionOptions),
    encryptedRefreshToken,
    accessTokenExpiresAt,
    grantedScopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : [],
  };
}

export async function getValidMicrosoftAccessToken({ businessId, userId, connection, fetchImpl = fetch, dependencies = {} }) {
  const deps = {
    acquireLease: acquireMicrosoftRefreshLease,
    getConnection: getMicrosoftConnection,
    persistCredentials: persistMicrosoftRefreshedCredentials,
    releaseLease: releaseMicrosoftRefreshLease,
    randomUUID,
    ...dependencies,
  };
  const context = encryptionContext(businessId, userId);
  if (connection.encryptedAccessToken && Date.parse(connection.accessTokenExpiresAt) > Date.now() + 30_000) {
    return decryptSecret(connection.encryptedAccessToken, context, undefined, encryptionOptions);
  }

  const leaseId = deps.randomUUID();
  const acquired = await deps.acquireLease({ businessId, userId, leaseId, expiresAt: new Date(Date.now() + 30_000).toISOString() });
  if (!acquired) {
    const current = await deps.getConnection({ businessId, userId });
    if (current?.encryptedAccessToken && Date.parse(current.accessTokenExpiresAt) > Date.now() + 30_000) {
      return decryptSecret(current.encryptedAccessToken, context, undefined, encryptionOptions);
    }
    const error = new Error('Microsoft credentials are being refreshed');
    error.status = 409;
    error.code = 'TOKEN_REFRESH_IN_PROGRESS';
    throw error;
  }

  try {
    const refreshToken = decryptSecret(connection.encryptedRefreshToken, context, undefined, encryptionOptions);
    const config = oauthConfig();
    const tokens = await postForm(MICROSOFT_TOKEN_URL, {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'refresh_token',
      scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
    }, fetchImpl);
    const credentials = buildEncryptedMicrosoftCredentials({
      businessId,
      userId,
      tokens,
      existingRefreshToken: connection.encryptedRefreshToken,
    });
    await deps.persistCredentials({ businessId, userId, leaseId, credentials });
    return tokens.access_token;
  } catch (error) {
    await deps.releaseLease({ businessId, userId, leaseId }).catch(() => {});
    throw error;
  }
}

function validateGraphUrl(value) {
  const url = new URL(value, GRAPH_API);
  if (url.protocol !== 'https:' || url.origin !== GRAPH_ORIGIN || !url.pathname.startsWith('/v1.0/')) {
    throw new Error('Microsoft Graph returned an invalid pagination URL');
  }
  return url;
}

async function graphRequest({ accessToken, path, url: nextUrl, method = 'GET', query, body, fetchImpl = fetch }) {
  const url = nextUrl ? validateGraphUrl(nextUrl) : validateGraphUrl(`${GRAPH_API}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
  }
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'IdType="ImmutableId", outlook.timezone="UTC"',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readMicrosoftResponse(response);
}

export async function fetchMicrosoftAccount({ accessToken, fetchImpl = fetch }) {
  const account = await graphRequest({ accessToken, path: '/me', query: { '$select': 'id,displayName,mail,userPrincipalName' }, fetchImpl });
  if (typeof account.id !== 'string' || !account.id) throw new Error('Microsoft account identity was unavailable');
  return {
    id: account.id,
    displayName: typeof account.displayName === 'string' ? account.displayName : '',
    email: String(account.mail || account.userPrincipalName || '').trim().toLowerCase(),
  };
}

export async function listMicrosoftCalendars({ accessToken, fetchImpl = fetch }) {
  const calendars = [];
  let nextUrl = null;
  do {
    const payload = await graphRequest({
      accessToken,
      path: '/me/calendars',
      url: nextUrl,
      query: nextUrl ? undefined : { '$select': 'id,name,isDefaultCalendar,canEdit,color', '$top': '100' },
      fetchImpl,
    });
    calendars.push(...(payload.value ?? []).filter((calendar) => typeof calendar.id === 'string').map((calendar) => ({
      id: calendar.id,
      summary: typeof calendar.name === 'string' && calendar.name.trim() ? calendar.name.trim() : 'Calendar',
      primary: calendar.isDefaultCalendar === true,
      canEdit: calendar.canEdit === true,
      color: calendar.color ?? null,
    })));
    nextUrl = typeof payload['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : null;
  } while (nextUrl);
  return calendars;
}

function normalizeGraphDateTime(value, timeZone) {
  if (typeof value !== 'string' || !value) return null;
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) return value;
  return String(timeZone).toUpperCase() === 'UTC' ? `${value}Z` : value;
}

export function mapMicrosoftEvent(event, calendarId) {
  if (typeof event?.id !== 'string') return null;
  const allDay = event.isAllDay === true;
  const start = allDay ? event.start?.dateTime?.slice(0, 10) : normalizeGraphDateTime(event.start?.dateTime, event.start?.timeZone);
  const end = allDay ? event.end?.dateTime?.slice(0, 10) : normalizeGraphDateTime(event.end?.dateTime, event.end?.timeZone);
  if (!start || !end) return null;
  const jobProperty = (event.singleValueExtendedProperties ?? []).find((property) => property.id === OLIVEOPS_JOB_PROPERTY_ID);
  return {
    externalEventId: event.id,
    externalCalendarId: calendarId,
    title: typeof event.subject === 'string' && event.subject.trim() ? event.subject.trim() : '(No title)',
    start,
    end,
    allDay,
    location: typeof event.location?.displayName === 'string' ? event.location.displayName : '',
    status: event.isCancelled === true ? 'cancelled' : 'confirmed',
    htmlLink: typeof event.webLink === 'string' ? event.webLink : '',
    provider: 'microsoft',
    sourceLabel: 'Outlook Calendar',
    oliveOpsJobId: typeof jobProperty?.value === 'string' ? jobProperty.value : null,
  };
}

export async function listMicrosoftEvents({ accessToken, calendarId, timeMin, timeMax, fetchImpl = fetch }) {
  const events = [];
  let nextUrl = null;
  do {
    const payload = await graphRequest({
      accessToken,
      path: `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`,
      url: nextUrl,
      query: nextUrl ? undefined : {
        startDateTime: timeMin,
        endDateTime: timeMax,
        '$top': '250',
        '$select': 'id,subject,start,end,isAllDay,isCancelled,location,webLink',
        '$expand': `singleValueExtendedProperties($filter=id eq '${OLIVEOPS_JOB_PROPERTY_ID.replaceAll("'", "''")}')`,
      },
      fetchImpl,
    });
    for (const item of payload.value ?? []) {
      const mapped = mapMicrosoftEvent(item, calendarId);
      if (mapped) events.push(mapped);
    }
    nextUrl = typeof payload['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : null;
  } while (nextUrl);
  return events;
}

export function buildMicrosoftTransactionId({ businessId, userId, calendarId, jobId }) {
  const bytes = Buffer.from(createHash('sha256').update(`${businessId}\0${userId}\0${calendarId}\0${jobId}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function addOneDay(dateValue) {
  const [year, month, day] = String(dateValue).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function mapJobToMicrosoftEvent({ businessId, userId, calendarId, job, customer, employees = [], appOrigin }) {
  const allDay = job.scheduleAllDay === true || !job.scheduledStartAt || !job.scheduledEndAt;
  const crew = employees.map((employee) => employee.name).filter(Boolean).join(', ');
  const content = [
    job.jobNumber ? `Job number: ${job.jobNumber}` : null,
    customer?.name ? `Customer: ${customer.name}` : null,
    crew ? `Crew: ${crew}` : null,
    job.scheduleNotes?.trim() || job.notes?.trim() || null,
    appOrigin ? `Open in OliveOps: ${new URL(`/jobs/${encodeURIComponent(job.id)}`, appOrigin).toString()}` : null,
  ].filter(Boolean).join('\n');
  const payload = {
    subject: job.title || customer?.name || 'OliveOps job',
    body: { contentType: 'text', content },
    location: { displayName: job.propertyAddressSnapshot || job.propertyLabel || '' },
    transactionId: buildMicrosoftTransactionId({ businessId, userId, calendarId, jobId: job.id }),
    singleValueExtendedProperties: [{ id: OLIVEOPS_JOB_PROPERTY_ID, value: job.id }],
    isAllDay: allDay,
  };
  if (allDay) {
    payload.start = { dateTime: `${job.startDate}T00:00:00`, timeZone: 'UTC' };
    payload.end = { dateTime: `${addOneDay(job.endDate || job.startDate)}T00:00:00`, timeZone: 'UTC' };
  } else {
    payload.start = { dateTime: new Date(job.scheduledStartAt).toISOString().replace(/Z$/, ''), timeZone: 'UTC' };
    payload.end = { dateTime: new Date(job.scheduledEndAt).toISOString().replace(/Z$/, ''), timeZone: 'UTC' };
  }
  return payload;
}

export async function upsertMicrosoftEvent({ accessToken, calendarId, microsoftEventId, event, fetchImpl = fetch }) {
  if (microsoftEventId) {
    try {
      return await graphRequest({ accessToken, path: `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(microsoftEventId)}`, method: 'PATCH', body: event, fetchImpl });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return graphRequest({ accessToken, path: `/me/calendars/${encodeURIComponent(calendarId)}/events`, method: 'POST', body: event, fetchImpl });
}

export async function deleteMicrosoftEvent({ accessToken, calendarId, microsoftEventId, fetchImpl = fetch }) {
  if (!microsoftEventId) return;
  try {
    await graphRequest({ accessToken, path: `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(microsoftEventId)}`, method: 'DELETE', fetchImpl });
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error;
  }
}