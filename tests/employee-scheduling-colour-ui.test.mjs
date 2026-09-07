import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Employee create and edit expose Scheduling Colour only for Foremen and persist it', async () => {
  const [createModal, editModal, picker] = await Promise.all([
    source('../src/components/employees/EmployeeCreateModal.tsx'),
    source('../src/components/employees/EmployeeEditModal.tsx'),
    source('../src/components/employees/SchedulingColourPicker.tsx'),
  ]);
  for (const modal of [createModal, editModal]) {
    assert.match(modal, /form\.role === 'foreman'/);
    assert.match(modal, /<SchedulingColourPicker/);
    assert.match(modal, /schedulingColor/);
  }
  assert.match(picker, /SCHEDULE_COLOUR_PALETTE\.map/);
  assert.match(picker, /aria-pressed/);
});

test('Employee API validates the exact shared scheduling palette', async () => {
  const api = await source('../api/data.js');
  for (const colour of ['#0f766e', '#1d4ed8', '#15803d', '#b45309', '#b91c1c', '#6d28d9', '#0e7490', '#be123c']) {
    assert.match(api, new RegExp(colour));
  }
  assert.match(api, /Employee scheduling colour is invalid/);
});

test('Employee repository maps scheduling color through reads and writes', async () => {
  const repository = await source('../api/_lib/authRepo.js');
  assert.match(repository, /schedulingColor: result\.Item\.schedulingColor/);
  assert.match(repository, /schedulingColor: employeeInput\.schedulingColor/);
  assert.match(repository, /schedulingColor: typeof employee\.schedulingColor/);
});