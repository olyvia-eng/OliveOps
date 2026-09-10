import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('New and Edit Employee reuse one Time Tracking Permissions section immediately above Account Access', async () => {
  const [createModal, editModal, section] = await Promise.all([
    source('../src/components/employees/EmployeeCreateModal.tsx'),
    source('../src/components/employees/EmployeeEditModal.tsx'),
    source('../src/components/employees/TimeTrackingPermissionsSection.tsx'),
  ]);

  assert.match(section, />Time Tracking Permissions</);
  assert.doesNotMatch(`${createModal}\n${editModal}\n${section}`, /Mobile Time Permissions/);
  for (const modal of [createModal, editModal]) {
    assert.match(modal, /import TimeTrackingPermissionsSection from '\.\/TimeTrackingPermissionsSection'/);
    assert.ok(modal.indexOf('<TimeTrackingPermissionsSection') < modal.indexOf('>Account Access<'));
  }
  assert.match(section, />Allow clock-in time adjustment</);
  assert.match(section, /Allows this employee to choose an earlier start time when clocking in from the mobile app\./);
  assert.match(section, />Allow shift\/work-area editing</);
  assert.match(section, /Allows this employee to adjust how their current shift was divided between Work Areas before clocking out\./);
});

test('New Employee defaults permissions off and submits the existing mobileTimePermissions model', async () => {
  const createModal = await source('../src/components/employees/EmployeeCreateModal.tsx');
  assert.match(createModal, /adjustClockInTime: false,[\s\S]*editShiftWorkAreas: false/);
  assert.match(createModal, /mobileTimePermissions: \{\s*adjustClockInTime: form\.adjustClockInTime,\s*editShiftWorkAreas: form\.editShiftWorkAreas,\s*\}/);
  assert.match(createModal, /adjustClockInTime=\{form\.adjustClockInTime\}/);
  assert.match(createModal, /editShiftWorkAreas=\{form\.editShiftWorkAreas\}/);
  assert.doesNotMatch(createModal, /form\.role.*adjustClockInTime|form\.role.*editShiftWorkAreas/);
});

test('Edit Employee hydrates and saves the same persisted permission fields', async () => {
  const editModal = await source('../src/components/employees/EmployeeEditModal.tsx');
  assert.match(editModal, /adjustClockInTime: employee\.mobileTimePermissions\?\.adjustClockInTime === true/);
  assert.match(editModal, /editShiftWorkAreas: employee\.mobileTimePermissions\?\.editShiftWorkAreas === true/);
  assert.match(editModal, /mobileTimePermissions: \{\s*adjustClockInTime: form\.adjustClockInTime,\s*editShiftWorkAreas: form\.editShiftWorkAreas,\s*\}/);
});
