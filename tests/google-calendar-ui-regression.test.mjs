import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const settingsSource = readFileSync('src/pages/settings/IntegrationsPage.tsx', 'utf8');
const calendarSource = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');
const homeSource = readFileSync('src/pages/home/HomePage.tsx', 'utf8');

test('Google Calendar settings remain owner-admin guarded and expose no token fields', () => {
  assert.match(appSource, /path="settings\/integrations"/);
  assert.match(appSource, /canManageUsers \? <IntegrationsPage \/>/);
  assert.match(sidebarSource, /Google|Integrations/);
  assert.match(settingsSource, /Connect Google Calendar/);
  assert.match(settingsSource, /Show Google Calendar events in OliveOps/);
  assert.match(settingsSource, /Add OliveOps scheduled jobs to Google Calendar/);
  assert.doesNotMatch(settingsSource, /refreshToken|accessToken|clientSecret/);
});

test('existing operations calendar merges source-aware read-only Google events', () => {
  assert.match(calendarSource, /source: 'google'/);
  assert.match(calendarSource, /Google Calendar · Read-only in OliveOps/);
  assert.match(calendarSource, /editable: false/);
  assert.match(calendarSource, /eventDrop\.event\.extendedProps\?\.source === 'google'/);
  assert.match(calendarSource, /Open Job/);
  assert.match(calendarSource, /Edit Schedule/);
});

test('Home This Week normalizes Google events and preserves job quick view navigation', () => {
  assert.match(homeSource, /api\/integrations\/google\/events/);
  assert.match(homeSource, /normalizeGoogleScheduleEntry/);
  assert.match(homeSource, /Google Calendar/);
  assert.match(homeSource, /setSelectedJobId\(entry\.jobId \?\? null\)/);
  assert.match(homeSource, /to=\{`\/jobs\/\$\{selectedJob\.id\}`\}/);
});