import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('crew conflict detection uses the canonical overlap window and remains non-blocking metadata', () => {
  const source = readFileSync('src/utils/jobSchedule.ts', 'utf8');
  assert.match(source, /const conflictingCrewId = crewId && job\.crewId === crewId/);
  assert.match(source, /scheduleWindowsOverlap\(scheduleWindow, otherSchedule\)/);
  assert.match(source, /\.\.\.\(conflictingCrewId \? \{ conflictingCrewId \} : \{\}\)/);
});

test('crew, employee, and equipment conflicts remain separate dimensions', () => {
  const source = readFileSync('src/utils/jobSchedule.ts', 'utf8');
  assert.match(source, /conflictingEmployeeIds/);
  assert.match(source, /conflictingEquipmentIds/);
  assert.match(source, /!conflictingCrewId && conflictingEmployeeIds\.length === 0 && conflictingEquipmentIds\.length === 0/);
});