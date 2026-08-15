import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReadEntity,
  canWriteEntity,
  filterRecordsForSession,
  authorizeRecordAccess,
  canClockForEmployee,
} from '../api/_lib/authorization.js';

test('owner and admin roles retain broad access', () => {
  assert.equal(canReadEntity('budgets', 'owner'), true);
  assert.equal(canWriteEntity('time-entries', 'admin'), true);
});

test('only owner and admin can write employee settings', () => {
  assert.equal(canWriteEntity('employees', 'owner'), true);
  assert.equal(canWriteEntity('employees', 'admin'), true);
  assert.equal(canWriteEntity('employees', 'crew_member'), false);
});

test('crew members can only see their own time entries and submissions', () => {
  const session = { role: 'crew_member', employeeId: 'emp-1', businessId: 'biz-1' };
  const records = [
    { id: 't1', employeeId: 'emp-1' },
    { id: 't2', employeeId: 'emp-2' },
  ];

  assert.deepEqual(filterRecordsForSession(session, 'time-entries', records), [{ id: 't1', employeeId: 'emp-1' }]);
  assert.deepEqual(filterRecordsForSession(session, 'form-submissions', records), [{ id: 't1', employeeId: 'emp-1' }]);
});

test('crew members can access direct and active crew job assignments only', () => {
  const session = { role: 'crew_member', employeeId: 'emp-1', businessId: 'biz-1' };
  const records = [
    { id: 'job-1', assignedEmployeeIds: ['emp-1'] },
    { id: 'job-2', assignedEmployeeIds: ['emp-2'] },
    { id: 'job-3', assignedEmployeeIds: [], crewId: 'crew-member' },
    { id: 'job-4', assignedEmployeeIds: [], crewId: 'crew-lead' },
    { id: 'job-5', assignedEmployeeIds: [], crewId: 'crew-inactive' },
    { id: 'job-6', assignedEmployeeIds: [], crewId: 'crew-other' },
  ];
  const crews = [
    { id: 'crew-member', active: true, leadEmployeeId: 'emp-2', memberIds: ['emp-1'] },
    { id: 'crew-lead', active: true, leadEmployeeId: 'emp-1', memberIds: [] },
    { id: 'crew-inactive', active: false, leadEmployeeId: 'emp-1', memberIds: ['emp-1'] },
    { id: 'crew-other', active: true, leadEmployeeId: 'emp-2', memberIds: ['emp-2'] },
  ];

  assert.deepEqual(filterRecordsForSession(session, 'jobs', records, { crews }), [
    { id: 'job-1', assignedEmployeeIds: ['emp-1'] },
    { id: 'job-3', assignedEmployeeIds: [], crewId: 'crew-member' },
    { id: 'job-4', assignedEmployeeIds: [], crewId: 'crew-lead' },
  ]);
});

test('clocking authorization allows self-service and blocks other employees for crew members', () => {
  const session = { role: 'crew_member', employeeId: 'emp-1', businessId: 'biz-1' };

  assert.equal(canClockForEmployee(session, 'emp-1'), true);
  assert.equal(canClockForEmployee(session, 'emp-2'), false);
});

test('owners and admins can clock any employee', () => {
  const ownerSession = { role: 'owner', employeeId: 'emp-1', businessId: 'biz-1' };
  const adminSession = { role: 'admin', employeeId: 'emp-1', businessId: 'biz-1' };

  assert.equal(canClockForEmployee(ownerSession, 'emp-2'), true);
  assert.equal(canClockForEmployee(adminSession, 'emp-2'), true);
});

test('crew members cannot write budgets or invoices', () => {
  assert.equal(canWriteEntity('budgets', 'crew_member'), false);
  assert.equal(canWriteEntity('invoices', 'crew_member'), false);
});

test('crew members can access their own employee profile but not others', () => {
  const session = { role: 'crew_member', employeeId: 'emp-1', businessId: 'biz-1' };
  assert.equal(authorizeRecordAccess(session, 'employees', { id: 'emp-1' }), true);
  assert.equal(authorizeRecordAccess(session, 'employees', { id: 'emp-2' }), false);
});

test('unbillable category permissions allow read to crew and write to owner/admin only', () => {
  assert.equal(canReadEntity('unbillable-time-categories', 'crew_member'), true);
  assert.equal(canReadEntity('unbillable-time-categories', 'foreman'), true);
  assert.equal(canWriteEntity('unbillable-time-categories', 'owner'), true);
  assert.equal(canWriteEntity('unbillable-time-categories', 'admin'), true);
  assert.equal(canWriteEntity('unbillable-time-categories', 'foreman'), false);
  assert.equal(canWriteEntity('unbillable-time-categories', 'crew_member'), false);
});
