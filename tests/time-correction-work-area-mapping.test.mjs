import assert from 'node:assert/strict';
import test from 'node:test';

import { ddb } from '../api/_lib/db.js';
import { getTimeCorrectionForBusiness, listTimeCorrectionsForBusiness } from '../api/_lib/authRepo.js';

const persistedCorrection = {
  PK: 'BUSINESS#biz-a',
  SK: 'TIME_CORRECTION#correction-a',
  entityType: 'TIME_CORRECTION',
  businessId: 'biz-a',
  correctionId: 'correction-a',
  employeeId: 'employee-a',
  requestType: 'wrong_job',
  status: 'pending',
  originalWorkAreaId: 'area-old',
  originalWorkAreaNameSnapshot: 'Excavation',
  requestedWorkAreaId: 'area-new',
  requestedWorkAreaNameSnapshot: 'Base Prep',
};

test('correction list and detail retain persisted Work Area identity and snapshots', async (t) => {
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => command.constructor.name === 'QueryCommand'
    ? { Items: [persistedCorrection] }
    : { Item: persistedCorrection };
  t.after(() => { ddb.send = originalSend; });

  const [listed] = await listTimeCorrectionsForBusiness('biz-a');
  const detail = await getTimeCorrectionForBusiness('biz-a', 'correction-a');

  for (const correction of [listed, detail]) {
    assert.equal(correction.originalWorkAreaId, 'area-old');
    assert.equal(correction.originalWorkAreaNameSnapshot, 'Excavation');
    assert.equal(correction.requestedWorkAreaId, 'area-new');
    assert.equal(correction.requestedWorkAreaNameSnapshot, 'Base Prep');
  }
});