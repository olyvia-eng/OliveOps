import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobDetail = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const timeReports = readFileSync('src/pages/reports/TimeReportsPage.tsx', 'utf8');

test('Job Photos includes every Job-associated time-entry photo once with activity metadata and caption', () => {
  assert.match(jobDetail, /normalizeEntryJobIds\(entry\)\.includes\(id\)/);
  assert.match(jobDetail, /new Set\(\[/);
  assert.match(jobDetail, /activityLabel = getTimeEntryPresentation\(entry, jobs\)\.activityLabel/);
  assert.match(jobDetail, /employeeName, activityLabel, clockIn: entry\.clockIn, caption: entry\.notes/);
  assert.match(jobDetail, /\{photo\.employeeName\} · \{photo\.activityLabel\}/);
  assert.match(jobDetail, /\{formatDateTime\(photo\.clockIn\)\}/);
  assert.match(jobDetail, /photo\.caption/);
});

test('Time Entries uses shared contextual work labels in the Job and Work Area column', () => {
  assert.match(timeReports, />Job \/ Work Area</);
  assert.match(timeReports, /getTimeEntryPresentation\(entry, jobs\)/);
  assert.match(timeReports, /presentation\.workLabel/);
});