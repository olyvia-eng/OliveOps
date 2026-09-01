import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('web store treats authoritative 202 clock-in as pending without creating an active entry', async () => {
  const store = await source('../src/store/index.ts');
  assert.match(store, /parseClockingResponse\(response, 'clock-in'\)/);
  assert.match(store, /result\.kind === 'pending'[^]*return \{ ok: true, pending: true, workflow: result\.workflow \}/);
  assert.match(store, /if \(result\.kind === 'pending'\)[^]*return[^]*const incoming = result\.timeEntry/);
  assert.doesNotMatch(store, /Clock-in failed \(HTTP \$\{response\.status\}\)/);
});

test('web store reconciles completed clocking without optimistic clock-out on 202', async () => {
  const store = await source('../src/store/index.ts');
  assert.match(store, /const incoming = result\.timeEntry[^]*timeEntries: \[/);
  assert.match(store, /parseClockingResponse\(response, 'clock-out'\)/);
  assert.match(store, /result\.kind === 'pending'[^]*pending: true/);
  assert.match(store, /entry\.id === result\.timeEntry\.id \? result\.timeEntry : entry/);
  const clockOutAction = store.slice(store.indexOf('clockOut: async'), store.indexOf('addTimeEntry:'));
  assert.doesNotMatch(clockOutAction, /status: 'clocked_out'/);
});

test('ready pending workflows use the existing authoritative finalize endpoints', async () => {
  const store = await source('../src/store/index.ts');
  assert.match(store, /remainingRequiredFormCount === 0/);
  assert.match(store, /\/api\/clocking\?action=\$\{action\}-finalize/);
  assert.match(store, /workflowOccurrenceId: result\.workflow\.workflowOccurrenceId/);
});

test('admin clock-in sends Work Area contract v2 and clears stale selections when Job changes', async () => {
  const [store, modal] = await Promise.all([
    source('../src/store/index.ts'),
    source('../src/pages/employees/ClockInModal.tsx'),
  ]);
  assert.match(store, /workAreaId: workType === 'job' \? options\.workAreaId/);
  assert.match(store, /clockingContractVersion: 2/);
  assert.match(modal, /const nextEligibleAreas =[^]*not_started[^]*in_progress/);
  assert.match(modal, /setSelectedWorkAreaId\(nextEligibleAreas\.length === 1 \? nextEligibleAreas\[0\]\.id : ''\)/);
  assert.match(modal, /selectedJob[^]*operationalWorkAreas[^]*!selectedWorkAreaId/);
  assert.doesNotMatch(modal, /type="checkbox"[^]*selectedJobIds/);
});

test('admin modal presents mandatory clock-in and clock-out as pending rather than success', async () => {
  const modal = await source('../src/pages/employees/ClockInModal.tsx');
  assert.match(modal, /result\.pending && result\.workflow/);
  assert.match(modal, /Clock-in pending/);
  assert.match(modal, /Clock-out pending/);
  assert.match(modal, /OliveOps mobile app/);
  assert.match(modal, /clockInIntent\?\.jobIds/);
  assert.match(modal, /clockInIntent\?\.workAreaNameSnapshot/);
  assert.match(modal, /if \(result\.pending[^]*setStep\('pending'\)[^]*return;[^]*setStep\('clocked_in'\)/);
});

test('direct employee clock-out also keeps pending workflows visible', async () => {
  const employeesPage = await source('../src/pages/employees/EmployeesPage.tsx');
  assert.match(employeesPage, /result\.pending && result\.workflow/);
  assert.match(employeesPage, /Clock-out pending/);
  assert.match(employeesPage, /required post-shift/);
});

test('employee portal preserves Work Area intent and displays pending workflows', async () => {
  const portal = await source('../src/pages/employees/EmployeePortalPage.tsx');
  assert.match(portal, /workAreaId: clockType === 'job' \? selectedWorkAreaId/);
  assert.match(portal, /setSelectedWorkAreaId\(nextEligibleAreas\.length === 1 \? nextEligibleAreas\[0\]\.id : ''\)/);
  assert.match(portal, /result\.pending && result\.workflow/);
  assert.match(portal, /Clock-in pending/);
  assert.match(portal, /Clock-out pending/);
});