import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const settingsSource = readFileSync('src/pages/settings/IntegrationsPage.tsx', 'utf8');
const calendarSource = readFileSync('src/pages/calendar/CalendarPage.tsx', 'utf8');
const homeSource = readFileSync('src/pages/home/HomePage.tsx', 'utf8');
const dashboardSource = readFileSync('src/pages/home/PersonalHomeDashboard.tsx', 'utf8');
const personalCalendarSource = readFileSync('src/components/calendar/PersonalCalendar.tsx', 'utf8');
const personalEventsSource = readFileSync('src/components/calendar/usePersonalCalendarEvents.ts', 'utf8');
const personalSettingsSource = readFileSync('src/pages/settings/PersonalCalendarSettingsPage.tsx', 'utf8');

test('Google Calendar settings remain owner-admin guarded and expose no token fields', () => {
  assert.match(appSource, /path="settings\/integrations"/);
  assert.match(appSource, /canManageUsers \? <IntegrationsPage \/>/);
  assert.match(sidebarSource, /Google|Integrations/);
  assert.match(settingsSource, /Connect Google Calendar/);
  assert.match(settingsSource, /Show Google Calendar events in OliveOps/);
  assert.match(settingsSource, /Add OliveOps scheduled jobs to Google Calendar/);
  assert.doesNotMatch(settingsSource, /refreshToken|accessToken|clientSecret/);
});

test('unfinished Outlook integration is hidden and does not request data while disabled', () => {
  assert.match(settingsSource, /const OUTLOOK_INTEGRATION_ENABLED = false/);
  assert.match(settingsSource, /if \(OUTLOOK_INTEGRATION_ENABLED\) void loadMicrosoft\(\)/);
  assert.match(settingsSource, /if \(OUTLOOK_INTEGRATION_ENABLED && microsoft\.connected\) void loadMicrosoftCalendars\(\)/);
  assert.match(settingsSource, /if \(!OUTLOOK_INTEGRATION_ENABLED\) return;[\s\S]*searchParams\.get\('microsoft'\)/);
  assert.match(settingsSource, /\{OUTLOOK_INTEGRATION_ENABLED \? <Card[\s\S]*Connect Outlook Calendar[\s\S]*<\/Card> : null\}/);
});

test('Google Calendar and QuickBooks remain visible outside the Outlook availability gate', () => {
  const outlookGateIndex = settingsSource.indexOf('{OUTLOOK_INTEGRATION_ENABLED ? <Card');
  assert.ok(outlookGateIndex > 0);
  assert.ok(settingsSource.indexOf('Connect Google Calendar') < outlookGateIndex);
  assert.ok(settingsSource.indexOf('QuickBooks Online') > outlookGateIndex);
  assert.match(settingsSource, /void load\(\);\s*void loadQuickBooks\(\);\s*if \(OUTLOOK_INTEGRATION_ENABLED\) void loadMicrosoft\(\);/);
});

test('company Schedule is provider-free and keeps operational job actions', () => {
  assert.doesNotMatch(calendarSource, /api\/integrations\/calendars\/events/);
  assert.doesNotMatch(calendarSource, /ExternalCalendarEvent|source: 'external'/);
  assert.match(calendarSource, /Open Job/);
  assert.match(calendarSource, /Edit Schedule/);
});

test('Home uses a range-loaded personal calendar and exposes self-service connections', () => {
  assert.match(homeSource, /PersonalHomeDashboard/);
  assert.match(dashboardSource, /<PersonalCalendar/);
  assert.match(personalCalendarSource, /timeGridWeek/);
  assert.match(personalEventsSource, /api\/integrations\/calendars\/events/);
  assert.match(personalCalendarSource, /kind: 'task'/);
  assert.match(appSource, /path="settings\/personal-calendar"/);
  assert.match(personalSettingsSource, /Events remain private to your OliveOps account/);
  assert.doesNotMatch(personalSettingsSource, /QuickBooks/);
});