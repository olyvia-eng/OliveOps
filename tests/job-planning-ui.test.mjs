import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const jobSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const builderSource = readFileSync('src/pages/jobs/JobWorkAreaBuilderPage.tsx', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');

test('Job Work Areas initialize once and open a dedicated current-plan editor', () => {
  assert.match(appSource, /jobs\/:id\/work-areas\/:workAreaId/);
  assert.match(jobSource, /initializeJobPlan\(job\.id\)/);
  assert.match(jobSource, /Edit Current Plan/);
  assert.match(jobSource, /mutateJobPlan\(job\.id, \{ action: 'add-work-area' \}\)/);
  assert.match(builderSource, /Current Job Plan/);
  assert.match(builderSource, /WORK_AREA_CATEGORY_ORDER\.map/);
});

test('Job editor separates editable planned cost from immutable sold revenue', () => {
  assert.match(builderSource, /label=\{`Planned Cost \/ \$\{line\.unit\}`\}/);
  assert.match(builderSource, /Contract revenue/);
  assert.match(builderSource, /sourceEstimateLineItemId \? ' · Sold Estimate line' : ' · Job-only resource'/);
  assert.match(builderSource, /canEditFinancials \? \{ unitCost: Math\.max/);
  assert.match(builderSource, /quantity: Math\.max/);
});

test('new Job resources use the authorized planning catalog and revisioned store mutation', () => {
  assert.match(builderSource, /\/api\/job-plans\?jobId=.*action=catalog/);
  assert.match(builderSource, /action: 'add-resource'/);
  assert.match(builderSource, /New resources affect planned cost, not contract revenue/);
  assert.match(storeSource, /expectedRevision: current\.planningRevision/);
});

test('Job Info separates editable operations from read-only conversion history', () => {
  assert.match(jobSource, /Operational Job Information/);
  assert.match(jobSource, /Save Changes/);
  assert.match(jobSource, /Conversion History/);
  assert.match(jobSource, /Original Contract Revenue/);
  assert.match(jobSource, /Contract Total/);
  assert.match(jobSource, /Proposal Number/);
});

test('Job Analysis presents original, current-plan, and actual values without invented actual revenue', () => {
  assert.match(jobSource, />Original Estimate</);
  assert.match(jobSource, />Current Job Plan</);
  assert.match(jobSource, />Actual To Date</);
  assert.match(jobSource, /originalEstimateSnapshot\?\.subtotal/);
  assert.match(jobSource, /currentPlannedCost/);
  assert.match(jobSource, /Actual revenue is not recognized here/);
});