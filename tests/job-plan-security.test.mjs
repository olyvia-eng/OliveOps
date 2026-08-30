import test from 'node:test';
import assert from 'node:assert/strict';

import { validateGenericJobPatch } from '../api/_lib/jobPlanSecurity.js';

const convertedJob = {
  id: 'job-1',
  sourceEstimateId: 'estimate-1',
  originalEstimateSnapshot: { subtotal: 1000 },
};

test('generic Job PATCH cannot mutate converted commercial or provenance fields', () => {
  for (const field of [
    'originalEstimateSnapshot', 'sourceEstimateId', 'estimateId', 'convertedFromEstimateAt',
    'contractValue', 'originalContractRevenue', 'currentContractRevenue', 'operationalWorkAreas',
    'planningRevision', 'currentPlannedCost',
  ]) {
    assert.match(validateGenericJobPatch(convertedJob, { [field]: 'forged' }), new RegExp(field));
  }
});

test('generic Job PATCH retains operational metadata edits and manual Job contract setup', () => {
  assert.equal(validateGenericJobPatch(convertedJob, { title: 'Updated', description: 'Current scope', startDate: '2026-09-01' }), null);
  assert.equal(validateGenericJobPatch({ id: 'manual-job' }, { contractValue: 2500 }), null);
});