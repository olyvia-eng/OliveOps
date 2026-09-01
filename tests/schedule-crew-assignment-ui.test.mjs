import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Schedule saves employee IDs, supports explicit crew removal, and cancel does not save', async () => {
  const modal = await source('../src/components/calendar/ScheduleJobModal.tsx');
  assert.match(modal, /assignedEmployeeIds: \[\.\.\.new Set\(form\.assignedEmployeeIds\)\]/);
  assert.match(modal, /crewId: form\.crewId \|\| null/);
  assert.match(modal, /if \(saved\) onClose\(\)/);
  assert.match(modal, /<Button variant="secondary" onClick=\{onClose\}>Cancel<\/Button>/);
  assert.doesNotMatch(modal, /employee\.name[^]*assignedEmployeeIds:/);
});

test('Schedule offers active employees and retains assigned inactive employees for removal', async () => {
  const modal = await source('../src/components/calendar/ScheduleJobModal.tsx');
  assert.match(modal, /employee\.active \|\| form\.assignedEmployeeIds\.includes\(employee\.id\)/);
  assert.match(modal, /!employee\.active \? 'Inactive'/);
  assert.match(modal, /crew\.active \|\| crew\.id === form\.crewId/);
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