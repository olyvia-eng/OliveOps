import assert from 'node:assert/strict';
import test from 'node:test';
import { getTimeEntryJobLabel, getTimeEntryWorkAreaLabel, getTimeEntryWorkLabel } from '../src/utils/timeEntryPresentation.js';

const jobs = [{ id: 'job-a', title: 'Smith Residence' }];

test('active and historical Job Work use the persisted Work Area snapshot', () => {
  const entry = { workType: 'job', jobId: 'job-a', workAreaId: 'area-a', workAreaNameSnapshot: 'Excavation' };
  assert.equal(getTimeEntryJobLabel(entry, jobs), 'Smith Residence');
  assert.equal(getTimeEntryWorkAreaLabel(entry), 'Excavation');
  assert.equal(getTimeEntryWorkLabel(entry, jobs), 'Smith Residence · Excavation');

  const renamedJobArea = { id: 'area-a', name: 'Site Excavation' };
  assert.notEqual(getTimeEntryWorkAreaLabel(entry), renamedJobArea.name);
});

test('legacy Job Work omits Work Area without an unknown placeholder', () => {
  assert.equal(getTimeEntryWorkLabel({ workType: 'job', jobId: 'job-a' }, jobs), 'Smith Residence');
  assert.equal(getTimeEntryWorkAreaLabel({ workType: 'job', jobId: 'job-a' }), null);
});

test('Drive Time and Non-Billable labels are unaffected', () => {
  assert.equal(getTimeEntryWorkLabel({ workType: 'drive_time', workAreaNameSnapshot: 'Ignored' }, jobs), 'Drive Time');
  assert.equal(getTimeEntryWorkLabel({ workType: 'non_billable', workAreaNameSnapshot: 'Ignored' }, jobs), 'Non-Billable Work');
});

test('switched segments retain their independent Work Area identity and snapshots', () => {
  const previous = { workType: 'job', jobId: 'job-a', workAreaId: 'area-a', workAreaNameSnapshot: 'Excavation', status: 'clocked_out' };
  const active = { workType: 'job', jobId: 'job-a', workAreaId: 'area-b', workAreaNameSnapshot: 'Base Prep', status: 'clocked_in' };
  assert.equal(getTimeEntryWorkLabel(previous, jobs), 'Smith Residence · Excavation');
  assert.equal(getTimeEntryWorkLabel(active, jobs), 'Smith Residence · Base Prep');
  assert.equal(active.workAreaId, 'area-b');
});