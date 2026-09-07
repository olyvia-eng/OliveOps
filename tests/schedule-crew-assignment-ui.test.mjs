import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Schedule saves canonical assignments and a deduplicated compatibility union', async () => {
  const editor = await source('../src/components/calendar/JobScheduleEditor.tsx');
  assert.match(editor, /assignedForemanId: form\.assignedForemanId \|\| null/);
  assert.match(editor, /assignedCrewEmployeeIds: \[\.\.\.new Set\(form\.assignedCrewEmployeeIds\)\]/);
  assert.match(editor, /assignedEmployeeIds: \[\s*\.\.\.new Set\(\[form\.assignedForemanId, \.\.\.form\.assignedCrewEmployeeIds\]/);
  assert.match(editor, /crewId: form\.crewId \|\| null/);
  assert.match(editor, /if \(saved\) onExit\(\)/);
  assert.match(editor, /<Button variant="secondary" onClick=\{onExit\}>Cancel<\/Button>/);
  assert.doesNotMatch(editor, /employee\.name[^]*assignedEmployeeIds:/);
});

test('Schedule offers active Foremen and active crew employees without duplicate Foreman selection', async () => {
  const editor = await source('../src/components/calendar/JobScheduleEditor.tsx');
  assert.match(editor, /employee\.active && employee\.role === 'foreman'/);
  assert.match(editor, /employee\.active && employee\.id !== form\.assignedForemanId/);
  assert.match(editor, /assignedCrewEmployeeIds: current\.assignedCrewEmployeeIds\.filter/);
  assert.doesNotMatch(editor, /label="Primary Crew"/);
});

test('successful Job updates reconcile from the API and failed updates roll back', async () => {
  const store = await source('../src/store/index.ts');
  const updateStart = store.indexOf('updateJob: async');
  const updateEnd = store.indexOf('initializeJobPlan:', updateStart);
  const updateJob = store.slice(updateStart, updateEnd);
  assert.match(updateJob, /payload\.job as Job/);
  assert.match(updateJob, /jobs: state\.jobs\.map/);
  assert.match(updateJob, /set\(\{ jobs: previous \}\)/);
  assert.match(updateJob, /return false/);
  assert.doesNotMatch(updateJob, /location\.reload|window\.location/);
});