import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MICROSOFT_CALENDAR_SCOPES,
  buildEncryptedMicrosoftCredentials,
  buildMicrosoftAuthorizationUrl,
  buildMicrosoftTransactionId,
  createMicrosoftPkcePair,
  encryptMicrosoftCodeVerifier,
  listMicrosoftCalendars,
  listMicrosoftEvents,
  mapJobToMicrosoftEvent,
  mapMicrosoftEvent,
} from '../api/_lib/microsoftCalendarService.js';
import { decryptSecret } from '../api/_lib/secretEncryption.js';

const encodedKey = Buffer.alloc(32, 7).toString('base64');

test('Microsoft authorization uses common authority, minimal scopes, and S256 PKCE', () => {
  const { verifier, challenge } = createMicrosoftPkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));

  const value = buildMicrosoftAuthorizationUrl({
    state: 'state-value',
    codeChallenge: challenge,
    config: { clientId: 'client-id', clientSecret: 'unused', redirectUri: 'https://app.example.com/api/integrations/microsoft/callback' },
  });
  const url = new URL(value);
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.pathname, '/common/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_mode'), 'query');
  assert.deepEqual(url.searchParams.get('scope').split(' '), [...MICROSOFT_CALENDAR_SCOPES]);
  assert.deepEqual([...MICROSOFT_CALENDAR_SCOPES], ['offline_access', 'User.Read', 'Calendars.ReadWrite']);
});

test('Microsoft secrets are encrypted with provider, business, and user isolation', () => {
  process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY = encodedKey;
  const encrypted = encryptMicrosoftCodeVerifier({ businessId: 'business-a', userId: 'admin-a', verifier: 'verifier-value' });
  const context = { provider: 'microsoft-calendar', businessId: 'business-a', realmId: 'admin-a' };
  assert.equal(decryptSecret(encrypted, context, undefined, { envName: 'MICROSOFT_TOKEN_ENCRYPTION_KEY' }), 'verifier-value');
  assert.throws(() => decryptSecret(encrypted, { ...context, businessId: 'business-b' }, undefined, { envName: 'MICROSOFT_TOKEN_ENCRYPTION_KEY' }));
  assert.throws(() => decryptSecret(encrypted, { ...context, realmId: 'admin-b' }, undefined, { envName: 'MICROSOFT_TOKEN_ENCRYPTION_KEY' }));

  const credentials = buildEncryptedMicrosoftCredentials({
    businessId: 'business-a',
    userId: 'admin-a',
    tokens: { access_token: 'access-value', refresh_token: 'refresh-value', expires_in: 3600, scope: 'User.Read Calendars.ReadWrite' },
  });
  assert.doesNotMatch(JSON.stringify(credentials), /access-value|refresh-value/);
});

test('Graph calendars paginate only through the fixed Graph v1 host', async () => {
  const requested = [];
  const calendars = await listMicrosoftCalendars({
    accessToken: 'token',
    fetchImpl: async (url) => {
      requested.push(String(url));
      return new Response(JSON.stringify(requested.length === 1 ? {
        value: [{ id: 'one', name: 'Primary', isDefaultCalendar: true, canEdit: true }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=next',
      } : { value: [{ id: 'two', name: 'Read only', canEdit: false }] }), { status: 200 });
    },
  });
  assert.equal(requested.length, 2);
  assert.deepEqual(calendars.map(({ id, canEdit }) => ({ id, canEdit })), [{ id: 'one', canEdit: true }, { id: 'two', canEdit: false }]);

  await assert.rejects(() => listMicrosoftEvents({
    accessToken: 'token',
    calendarId: 'calendar',
    timeMin: '2026-08-01T00:00:00.000Z',
    timeMax: '2026-09-01T00:00:00.000Z',
    fetchImpl: async () => new Response(JSON.stringify({ value: [], '@odata.nextLink': 'https://evil.example/v1.0/events' }), { status: 200 }),
  }), /invalid pagination URL/);
});

test('Graph events normalize immutable IDs, UTC values, and OliveOps ownership', () => {
  assert.deepEqual(mapMicrosoftEvent({
    id: 'CaseSensitiveImmutableId',
    subject: 'Site visit',
    start: { dateTime: '2026-08-11T14:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-08-11T15:00:00.0000000', timeZone: 'UTC' },
    location: { displayName: '12 Main St' },
    webLink: 'https://outlook.office.com/calendar/item',
    singleValueExtendedProperties: [{ id: 'String {7a55f0f5-2d63-4c35-bd44-d7fd5a64eb41} Name oliveOpsJobId', value: 'job-1' }],
  }, 'calendar-1'), {
    externalEventId: 'CaseSensitiveImmutableId',
    externalCalendarId: 'calendar-1',
    title: 'Site visit',
    start: '2026-08-11T14:00:00.0000000Z',
    end: '2026-08-11T15:00:00.0000000Z',
    allDay: false,
    location: '12 Main St',
    status: 'confirmed',
    htmlLink: 'https://outlook.office.com/calendar/item',
    provider: 'microsoft',
    sourceLabel: 'Outlook Calendar',
    oliveOpsJobId: 'job-1',
  });
});

test('job mapping uses stable UUID transaction IDs and exclusive all-day end dates', () => {
  const input = { businessId: 'business-1', userId: 'admin-1', calendarId: 'calendar-1', jobId: 'job-1' };
  const first = buildMicrosoftTransactionId(input);
  assert.equal(first, buildMicrosoftTransactionId(input));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const event = mapJobToMicrosoftEvent({
    ...input,
    job: { id: 'job-1', title: 'Install', startDate: '2026-08-11', endDate: '2026-08-12', scheduleAllDay: true },
    customer: { name: 'Customer' },
    appOrigin: 'https://app.example.com',
  });
  assert.equal(event.start.dateTime, '2026-08-11T00:00:00');
  assert.equal(event.end.dateTime, '2026-08-13T00:00:00');
  assert.equal(event.isAllDay, true);
  assert.equal(event.transactionId, first);
  assert.equal(event.attendees, undefined);
});