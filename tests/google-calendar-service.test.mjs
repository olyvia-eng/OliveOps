import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOOGLE_CALENDAR_SCOPES,
  buildDeterministicGoogleEventId,
  buildGoogleAuthorizationUrl,
  listGoogleEvents,
  mapGoogleEvent,
  mapJobToGoogleEvent,
} from '../api/_lib/googleCalendarService.js';

test('Google authorization requests only the required identity and calendar scopes', () => {
  const url = new URL(buildGoogleAuthorizationUrl({
    state: 'state-value',
    config: { clientId: 'client-id', clientSecret: 'unused', redirectUri: 'https://app.example.com/api/integrations/google/callback' },
  }));
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.deepEqual(url.searchParams.get('scope').split(' '), [...GOOGLE_CALENDAR_SCOPES]);
});

test('Google timed and all-day events map to safe projections', () => {
  const timed = mapGoogleEvent({
    id: 'timed-1',
    summary: 'Site visit',
    start: { dateTime: '2026-08-11T13:00:00Z' },
    end: { dateTime: '2026-08-11T14:00:00Z' },
    location: '10 Main Street',
    extendedProperties: { private: { oliveOpsJobId: 'job-1' } },
  }, 'primary');
  const allDay = mapGoogleEvent({
    id: 'all-day-1',
    start: { date: '2026-08-12' },
    end: { date: '2026-08-13' },
  }, 'primary');

  assert.equal(timed.allDay, false);
  assert.equal(timed.oliveOpsJobId, 'job-1');
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.title, '(No title)');
});

test('event listing follows Google pagination', async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    const secondPage = new URL(url).searchParams.get('pageToken') === 'page-2';
    return new Response(JSON.stringify(secondPage
      ? { items: [{ id: 'event-2', start: { date: '2026-08-12' }, end: { date: '2026-08-13' } }] }
      : { items: [{ id: 'event-1', start: { date: '2026-08-11' }, end: { date: '2026-08-12' } }], nextPageToken: 'page-2' }), { status: 200 });
  };
  const events = await listGoogleEvents({
    accessToken: 'access',
    calendarId: 'calendar@example.com',
    timeMin: '2026-08-01T00:00:00Z',
    timeMax: '2026-09-01T00:00:00Z',
    fetchImpl,
  });
  assert.equal(events.length, 2);
  assert.equal(requestedUrls.length, 2);
});

test('outbound job mapping preserves schedule semantics and deterministic IDs', () => {
  const input = {
    businessId: 'business-1',
    userId: 'user-1',
    calendarId: 'primary',
    job: {
      id: 'job-1',
      jobNumber: 'J-1042',
      title: 'Kitchen renovation',
      startDate: '2026-08-11',
      endDate: '2026-08-12',
      scheduleAllDay: true,
      assignedEmployeeIds: ['employee-1'],
      propertyAddressSnapshot: '10 Main Street',
      scheduleNotes: 'Use side entrance',
    },
    customer: { name: 'Taylor Residence' },
    employees: [{ id: 'employee-1', name: 'Sam Lee' }],
    appOrigin: 'https://app.oliveops.com',
  };
  const first = mapJobToGoogleEvent(input);
  const second = mapJobToGoogleEvent(input);

  assert.equal(first.id, second.id);
  assert.equal(first.id, buildDeterministicGoogleEventId({ businessId: 'business-1', userId: 'user-1', calendarId: 'primary', jobId: 'job-1' }));
  assert.deepEqual(first.start, { date: '2026-08-11' });
  assert.deepEqual(first.end, { date: '2026-08-13' });
  assert.match(first.description, /J-1042/);
  assert.match(first.description, /Sam Lee/);
  assert.match(first.description, /https:\/\/app\.oliveops\.com\/jobs\/job-1/);
});