import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const page = readFileSync('src/pages/employees/TimeOffRequestsPage.tsx', 'utf8');
const profile = readFileSync('src/pages/employees/EmployeeProfilePage.tsx', 'utf8');
const modal = readFileSync('src/components/employees/TimeOffReviewModal.tsx', 'utf8');

 test('Time Off is an owner/admin Team route and does not grant foreman administration', () => {
  assert.match(sidebar, /to: '\/time-off', label: 'Time Off'/);
  assert.match(sidebar, /roles: ownerAdminRoles/);
  assert.match(app, /path="time-off"/);
  assert.match(app, /canViewReports \? <TimeOffRequestsPage/);
});

test('company Time Off page provides status tabs, practical filters, detail opening, and empty states', () => {
  for (const label of ['Pending', 'Approved', 'Denied', 'All']) assert.match(page, new RegExp(`label: '${label}'`));
  for (const aria of ['Filter by employee', 'Filter by request type', 'Filter from date', 'Filter through date']) assert.match(page, new RegExp(`aria-label="${aria}"`));
  assert.match(page, /setSelected\(request\)/);
  assert.match(page, /No pending time-off requests\./);
});

test('shared review modal handles approve, deny, retry-safe errors, and stale authoritative state', () => {
  assert.match(modal, /action: 'approve' \| 'deny'/);
  assert.match(modal, /response\.status === 409/);
  assert.match(modal, /payload\.request\) onUpdated/);
  assert.match(modal, />Approve</);
  assert.match(modal, />Deny</);
  assert.match(modal, /Try again/);
});

test('Employee Profile renders canonical Time Off groups and upcoming approved summary', () => {
  assert.match(profile, /\/api\/time-off-requests\?action=list/);
  for (const heading of ['Pending Requests', 'Upcoming Approved', 'Past Requests', 'Upcoming Time Off']) assert.match(profile, new RegExp(heading));
  assert.match(profile, /request\.status === 'approved' && request\.endDate >= todayKey/);
  assert.match(profile, /<TimeOffReviewModal/);
  assert.match(profile, /No time-off requests yet\./);
  assert.doesNotMatch(profile, /does not currently have a time-off request model/);
});
