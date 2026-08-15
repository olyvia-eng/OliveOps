import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const aggregatedEvents = readFileSync('api/integrations/calendars/events.js', 'utf8');
const googleSettings = readFileSync('api/integrations/google/settings.js', 'utf8');
const microsoftSettings = readFileSync('api/integrations/microsoft/settings.js', 'utf8');
const externalEvents = readFileSync('api/_lib/externalCalendarEvents.js', 'utf8');
const schedulePage = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');
const personalCalendar = readFileSync('src/components/calendar/PersonalCalendar.tsx', 'utf8');

for (const [provider, source] of [['Google', googleSettings], ['Microsoft', microsoftSettings]]) {
  test(`${provider} personal settings allow authenticated users but protect company job export`, () => {
    assert.match(source, /requireSession\(req, res\)/);
    assert.doesNotMatch(source, /requireSession\(req, res, \['owner', 'admin'\]\)/);
    assert.match(source, /syncOliveOpsJobs && !\['owner', 'admin'\]\.includes\(session\.role\)/);
    assert.match(source, /Only owners and admins can sync company jobs/);
  });
}

test('external event aggregation is scoped only from the authenticated session', () => {
  assert.match(aggregatedEvents, /requireSession\(req, res\)/);
  assert.match(aggregatedEvents, /businessId: session\.businessId/);
  assert.match(aggregatedEvents, /userId: session\.id/);
  assert.doesNotMatch(aggregatedEvents, /req\.(body|query).*userId/);
  assert.match(externalEvents, /getGoogleConnection\(\{ businessId, userId \}\)/);
  assert.match(externalEvents, /getMicrosoftConnection\(\{ businessId, userId \}\)/);
});

test('personal providers are loaded only by My Calendar, never company Schedule', () => {
  assert.match(personalCalendar, /api\/integrations\/calendars\/events/);
  assert.doesNotMatch(schedulePage, /api\/integrations\/calendars\/events|ExternalCalendarEvent|source: 'external'/);
});
