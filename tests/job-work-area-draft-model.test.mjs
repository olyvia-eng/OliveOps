import test from 'node:test';
import assert from 'node:assert/strict';

import { isEstimateEditorDirty } from '../src/utils/estimateDirtyModel.js';
import { formatJobPlanRateInput, jobLinePlannedQuantity, jobLinePlannedTotal, jobWorkAreaDraftTotals, loadJobWorkAreaDraft } from '../src/utils/jobWorkAreaDraftModel.js';

const workArea = {
  id: 'area-1', name: 'Patio', description: 'Sold scope', status: 'not_started',
  lineItems: [
    { id: 'labour', category: 'labour', itemName: 'Crew', workers: 2, hoursPerWorker: 6, quantity: 12, unit: 'hr', unitCost: 62.10526315789473, contractRevenue: 1200, total: 1200 },
    { id: 'equipment', category: 'equipment', itemName: 'Excavator', quantity: 5, unit: 'hr', unitCost: 80, contractRevenue: 700, total: 700 },
    { id: 'material', category: 'material', itemName: 'Stone', quantity: 3, unit: 'tonne', unitCost: 45, contractRevenue: 240, total: 240 },
    { id: 'subcontractor', category: 'subcontractor', itemName: 'Electrician', quantity: 1, unit: 'job', unitCost: 500, contractRevenue: 650, total: 650 },
  ],
};

test('Job Work Area draft preserves category units and calculates Labour from workers and hours per worker', () => {
  const draft = loadJobWorkAreaDraft(workArea);
  assert.deepEqual(draft.lineItems.map((line) => line.unit), ['hr', 'hr', 'tonne', 'job']);
  assert.equal(jobLinePlannedQuantity(draft.lineItems[0]), 12);
  assert.equal(jobLinePlannedTotal(draft.lineItems[0]), 745.2631578947368);
  const changedLabour = { ...draft.lineItems[0], workers: 3, hoursPerWorker: 4.5 };
  assert.equal(jobLinePlannedQuantity(changedLabour), 13.5);
  assert.equal(jobLinePlannedTotal(changedLabour), 838.4210526315788);
});

test('Job planned rates format to two decimals and nested edits make the Work Area dirty', () => {
  const draft = loadJobWorkAreaDraft(workArea);
  assert.equal(formatJobPlanRateInput(62.10526315789473), '62.11');
  assert.equal(formatJobPlanRateInput(40), '40.00');
  assert.equal(isEstimateEditorDirty(draft, draft), false);
  assert.equal(isEstimateEditorDirty({ ...draft, lineItems: draft.lineItems.map((line) => line.id === 'material' ? { ...line, quantity: 4 } : line) }, draft), true);
  const totals = jobWorkAreaDraftTotals(draft);
  assert.equal(totals.plannedCost.toFixed(2), '1780.26');
  assert.equal(totals.soldRevenue, 2790);
});