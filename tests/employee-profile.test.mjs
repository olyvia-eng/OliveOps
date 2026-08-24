import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getEmployeeRangeStart, scopeEmployeeProfileRecords } from '../src/pages/employees/employeeProfileModel.js';

const appSource = readFileSync('src/App.tsx', 'utf8');
const directorySource = readFileSync('src/pages/employees/EmployeesPage.tsx', 'utf8');
const profileSource = readFileSync('src/pages/employees/EmployeeProfilePage.tsx', 'utf8');

test('employee profile scoping never mixes employee records', () => {
  const scoped = scopeEmployeeProfileRecords({
    employeeId: 'employee-a',
    timeEntries: [{ id: 'time-a', employeeId: 'employee-a' }, { id: 'time-b', employeeId: 'employee-b' }],
    timeCorrections: [{ id: 'correction-a', employeeId: 'employee-a' }, { id: 'correction-b', employeeId: 'employee-b' }],
    formSubmissions: [
      { id: 'form-a', employeeId: 'employee-a', status: 'submitted' },
      { id: 'draft-a', employeeId: 'employee-a', status: 'draft' },
      { id: 'form-b', employeeId: 'employee-b', status: 'approved' },
    ],
    files: [
      { id: 'file-a', entityType: 'employee', entityId: 'employee-a' },
      { id: 'file-b', entityType: 'employee', entityId: 'employee-b' },
      { id: 'job-file', entityType: 'job', entityId: 'employee-a' },
    ],
  });

  assert.deepEqual(scoped.timeEntries.map((item) => item.id), ['time-a']);
  assert.deepEqual(scoped.timeCorrections.map((item) => item.id), ['correction-a']);
  assert.deepEqual(scoped.formSubmissions.map((item) => item.id), ['form-a']);
  assert.deepEqual(scoped.files.map((item) => item.id), ['file-a']);
});

test('employee profile date presets have stable supported boundaries', () => {
  const now = new Date(2026, 7, 23, 12, 0, 0);
  assert.equal(getEmployeeRangeStart('30-days', now).toISOString(), new Date(2026, 6, 25).toISOString());
  assert.equal(getEmployeeRangeStart('90-days', now).toISOString(), new Date(2026, 4, 26).toISOString());
  assert.equal(getEmployeeRangeStart('year-to-date', now).toISOString(), new Date(2026, 0, 1).toISOString());
});

test('employees directory links cards and rows to a deep-linkable profile', () => {
  assert.match(appSource, /path="employees\/:employeeId"/);
  assert.match(directorySource, /navigate\(`\/employees\/\$\{encodeURIComponent\(emp\.id\)\}`\)/);
  assert.match(directorySource, /title="Employees"/);
});

test('profile exposes the requested architecture and honest unsupported states', () => {
  for (const label of ['Overview', 'Scorecard', 'Time & Attendance', 'Time Off', 'Training', 'Documents']) {
    assert.match(profileSource, new RegExp(`label: '${label.replace('&', '\\&')}'`));
  }
  assert.match(profileSource, /Employee not found/);
  assert.match(profileSource, /<EmployeeEditModal[\s\S]*employeeId=\{employee\.id\}/);
  assert.match(profileSource, /No composite score is calculated/);
  assert.match(profileSource, /Overtime Hours[\s\S]*Not tracked separately/);
  assert.match(profileSource, /time-off-requests\?action=list/);
  assert.match(profileSource, /Pending Requests/);
  assert.match(profileSource, /Upcoming Approved/);
  assert.match(profileSource, /Training records and assigned courses will appear here once Training is enabled/);
  assert.match(profileSource, /entityType=employee/);
});

test('profile keeps sensitive management actions behind existing owner and admin roles', () => {
  assert.match(profileSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(profileSource, /\{canManageEmployee \?/);
  assert.match(appSource, /sessionUser\.role === 'crew_member' \|\| sessionUser\.role === 'foreman'[\s\S]*Navigate to="\/employee-login"/);
});