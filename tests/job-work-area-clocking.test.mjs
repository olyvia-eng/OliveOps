import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEligibleJobWorkAreas,
  resolveClockingWorkArea,
  WORK_AREA_CLOCKING_CONTRACT_VERSION,
} from '../api/_lib/jobWorkAreas.js';

const job = {
  id: 'job-1',
  operationalWorkAreas: [
    { id: 'area-base', sourceEstimateWorkAreaId: 'estimate-base', name: 'Base Prep', description: '', status: 'in_progress', sortOrder: 1 },
    { id: 'area-excavation', sourceEstimateWorkAreaId: 'estimate-excavation', name: 'Excavation', description: '', status: 'not_started', sortOrder: 0 },
    { id: 'area-complete', name: 'Cleanup', description: '', status: 'complete', sortOrder: 2 },
    { id: 'area-hold', name: 'Patio', description: '', status: 'on_hold', sortOrder: 3 },
  ],
};

test('eligible Job Work Areas use the canonical operational statuses and safe presentation fields', () => {
  assert.deepEqual(getEligibleJobWorkAreas(job), [
    { id: 'area-excavation', name: 'Excavation', description: '', status: 'not_started', sortOrder: 0 },
    { id: 'area-base', name: 'Base Prep', description: '', status: 'in_progress', sortOrder: 1 },
  ]);
});

test('new contract resolves a Job-owned Work Area and server name snapshot', () => {
  assert.deepEqual(resolveClockingWorkArea({
    job,
    workType: 'job',
    workAreaId: 'area-base',
    contractVersion: WORK_AREA_CLOCKING_CONTRACT_VERSION,
  }), { ok: true, workAreaId: 'area-base', workAreaNameSnapshot: 'Base Prep' });
});

test('new contract rejects missing, fabricated, source Estimate, and ineligible Work Area IDs', () => {
  for (const workAreaId of [undefined, 'fabricated', 'estimate-base', 'area-complete', 'area-hold']) {
    const result = resolveClockingWorkArea({ job, workType: 'job', workAreaId, contractVersion: 2 });
    assert.equal(result.ok, false);
  }
});

test('old clients remain compatible while legacy Jobs persist an explicit null relationship', () => {
  assert.deepEqual(resolveClockingWorkArea({ job, workType: 'job' }), {
    ok: true,
    workAreaId: null,
    workAreaNameSnapshot: null,
  });
  assert.deepEqual(resolveClockingWorkArea({
    job: { id: 'legacy-job' },
    workType: 'job',
    contractVersion: 2,
  }), { ok: true, workAreaId: null, workAreaNameSnapshot: null });
});

test('a modern Job with only ineligible Work Areas cannot fall back to Job-level clocking', () => {
  const result = resolveClockingWorkArea({
    job: { id: 'job-closed', operationalWorkAreas: [{ id: 'area-1', name: 'Done', status: 'complete' }] },
    workType: 'job',
    contractVersion: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'job_work_area_unavailable');
});

test('Drive Time and Unbillable ignore Work Area requirements', () => {
  assert.equal(resolveClockingWorkArea({ job, workType: 'drive_time', contractVersion: 2 }).ok, true);
  assert.equal(resolveClockingWorkArea({ job, workType: 'non_billable', contractVersion: 2 }).ok, true);
});