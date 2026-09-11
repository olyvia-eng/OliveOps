import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAccessProjectJobForClocking,
  getProjectJobAssignedEmployeeIds,
  isProjectJobActiveForClocking,
  isProjectJobClockingEligible,
  isProjectJobScheduledOn,
  isProjectJobScheduledTodayForEmployee,
} from '../api/_lib/projectJobClocking.js';

const employeeSession = (employeeId) => ({ role: 'crew_member', employeeId });

test('canonical Project Job assignment supports Foreman, Crew employees, and legacy Crew membership', () => {
  const job = {
    status: 'scheduled',
    assignedForemanId: 'foreman-a',
    assignedCrewEmployeeIds: ['employee-a'],
    assignedEmployeeIds: ['legacy-employee'],
    crewId: 'crew-a',
  };
  const crews = [{ id: 'crew-a', active: true, leadEmployeeId: 'crew-lead', memberIds: ['legacy-crew-member'] }];

  assert.deepEqual(getProjectJobAssignedEmployeeIds(job), ['foreman-a', 'employee-a', 'legacy-employee']);
  assert.equal(canAccessProjectJobForClocking(employeeSession('foreman-a'), job, crews), true);
  assert.equal(canAccessProjectJobForClocking(employeeSession('employee-a'), job, crews), true);
  assert.equal(canAccessProjectJobForClocking(employeeSession('legacy-employee'), job, crews), true);
  assert.equal(canAccessProjectJobForClocking(employeeSession('legacy-crew-member'), job, crews), true);
  assert.equal(canAccessProjectJobForClocking(employeeSession('unassigned'), job, crews), false);
  assert.equal(canAccessProjectJobForClocking(employeeSession('legacy-employee'), { status: 'scheduled', assignedEmployeeIds: ['legacy-employee'] }), true);
});

test('owner, admin, and Foreman retain operational Project Job access', () => {
  const job = { status: 'in_progress' };
  for (const role of ['owner', 'admin', 'foreman']) {
    assert.equal(canAccessProjectJobForClocking({ role, employeeId: `${role}-a` }, job), true);
  }
});

test('Project Job schedule inclusion handles yesterday, multi-day ranges, and excluded weekends', () => {
  assert.equal(isProjectJobScheduledOn({ startDate: '2026-09-10', endDate: '2026-09-10' }, '2026-09-11'), false);
  assert.equal(isProjectJobScheduledOn({ startDate: '2026-09-09', endDate: '2026-09-12' }, '2026-09-11'), true);
  assert.equal(isProjectJobScheduledOn({ startDate: '2026-09-11', endDate: '2026-09-14', includeWeekends: false }, '2026-09-12'), false);
});

test('completed, cancelled, and on-hold Project Jobs are never clocking eligible', () => {
  const session = employeeSession('employee-a');
  for (const status of ['completed', 'cancelled', 'on_hold']) {
    const job = { status, assignedEmployeeIds: ['employee-a'] };
    assert.equal(isProjectJobActiveForClocking(job), false);
    assert.equal(isProjectJobClockingEligible(session, job), false);
  }
});

test('scheduled today for employee requires both schedule inclusion and actual assignment', () => {
  const job = { status: 'scheduled', startDate: '2026-09-11', assignedEmployeeIds: ['employee-a'] };
  assert.equal(isProjectJobScheduledTodayForEmployee('employee-a', job, [], '2026-09-11'), true);
  assert.equal(isProjectJobScheduledTodayForEmployee('employee-b', job, [], '2026-09-11'), false);
  assert.equal(isProjectJobScheduledTodayForEmployee('employee-a', job, [], '2026-09-12'), false);
});