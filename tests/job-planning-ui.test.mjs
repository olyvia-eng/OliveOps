import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const jobSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const analysisSummarySource = readFileSync('src/components/jobs/JobAnalysisSummary.tsx', 'utf8');
const analysisWorkspaceSource = readFileSync('src/components/jobs/JobAnalysisWorkspace.tsx', 'utf8');
const builderSource = readFileSync('src/pages/jobs/JobWorkAreaBuilderPage.tsx', 'utf8');
const estimateBuilderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const sharedSectionSource = readFileSync('src/components/work-areas/WorkAreaResourceSection.tsx', 'utf8');
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
  for (const heading of ['Planned Cost / Unit', 'Sold Rate', 'Total Planned Cost', 'Sold Revenue']) assert.match(builderSource, new RegExp(heading));
  assert.match(builderSource, />From Estimate</);
  assert.doesNotMatch(builderSource, /Sold Estimate line|internal snapshot/i);
  assert.match(builderSource, /formatJobPlanRateInput\(line\.unitCost\)/);
  assert.match(builderSource, /formatCurrency\(line\.contractRevenue \?\? line\.total\)/);
});

test('Job and Estimate Work Areas reuse the same compact resource section pattern', () => {
  assert.match(builderSource, /<WorkAreaResourceSection/);
  assert.match(estimateBuilderSource, /<WorkAreaResourceSection/);
  assert.match(sharedSectionSource, /WORK_AREA_CATEGORY_LABEL\[category\]/);
  assert.match(sharedSectionSource, /WORK_AREA_CATEGORY_ADD_LABEL\[category\]/);
  for (const category of ['labour', 'equipment', 'material', 'subcontractor']) assert.match(builderSource, new RegExp(category));
  for (const heading of ['Workers', 'Hours / Worker', 'Hours / Quantity', 'Actions']) assert.match(builderSource, new RegExp(heading));
});

test('nested Job edits are dirty and persist through one Work Area save without line Save buttons', () => {
  assert.match(builderSource, /isEstimateEditorDirty\(form,/);
  assert.match(builderSource, /useUnsavedChangesGuard\(\{ isDirty/);
  assert.match(builderSource, /action: 'save-work-area'/);
  assert.match(builderSource, /lines: form\.lineItems\.map/);
  assert.match(builderSource, /Save Work Area/);
  assert.doesNotMatch(builderSource, /saveLine|>Save<\/Button>/);
});

test('new Job resources use the authorized planning catalog and revisioned store mutation', () => {
  assert.match(builderSource, /\/api\/job-plans\?jobId=.*action=catalog/);
  assert.match(builderSource, /action: 'add-resource'/);
  assert.match(builderSource, /New resources affect planned cost, not sold revenue/);
  assert.match(storeSource, /expectedRevision: current\.planningRevision/);
});

test('Job hours-per-worker and quantity fields keep a trailing decimal point while typing', () => {
  // Regression: these fields used to be a plain controlled <input> displaying
  // formatNumericDisplayValue(Math.round(value * 100) / 100) on every keystroke, which immediately
  // erased a trailing "." (typing "7." reformatted back to "7" before the next digit landed, turning
  // an intended "7.5" into "75"). DecimalTextInput keeps the user's raw in-progress string instead -
  // see its own definition in src/components/ui/index.tsx - so this asserts the Job builder actually
  // uses it for both fields, the same way the Estimate builder already does for its Quantity/Hours
  // column, rather than the old bare <input> pattern.
  assert.doesNotMatch(builderSource, /editableNumber/);
  assert.match(builderSource, /<DecimalTextInput aria-label=\{`Hours per worker for \$\{line\.itemName\}`\} value=\{hoursPerWorker\} onValueChange=\{/);
  assert.match(builderSource, /<DecimalTextInput aria-label=\{`\$\{line\.unit === 'hr' \? 'Hours' : 'Quantity'\} for \$\{line\.itemName\}`\} value=\{line\.quantity\} onValueChange=\{/);
});

test('a missing Job planning revision surfaces an error toast instead of silently doing nothing', () => {
  // Regression: mutateJobPlan returned { ok: false } here with no emitAppToast call, so typing a
  // change and hitting Save looked like it did absolutely nothing - no success message, no error.
  assert.match(storeSource, /if \(!current\?\.planningRevision\) \{[\s\S]*?emitAppToast\(\{ tone: 'error', message \}\);[\s\S]*?return \{ ok: false, error: message \};[\s\S]*?\}/);
});

test('Job Info separates editable operations from read-only conversion history', () => {
  assert.match(jobSource, /Operational Job Information/);
  assert.match(jobSource, /Save Changes/);
  assert.match(jobSource, /Conversion History/);
  assert.match(jobSource, /Original Contract Revenue/);
  assert.match(jobSource, /Contract Total/);
  assert.match(jobSource, /Proposal Number/);
});

test('Job Analysis compares current estimates with actuals without inventing revenue or profit', () => {
  assert.match(jobSource, /<JobAnalysisWorkspace job=\{job\}/);
  assert.match(analysisWorkspaceSource, /Revenue less cost to date/);
  assert.match(analysisWorkspaceSource, /not final Job profit or a projected final cost/);
  assert.match(analysisSummarySource, /Contract revenue, excluding tax/);
  assert.match(analysisSummarySource, /Margin after recorded costs/);
  assert.match(analysisSummarySource, /It is not the final Job profit until all costs are recorded/);
  assert.match(analysisSummarySource, /actual costs recorded to date/);
  assert.doesNotMatch(analysisSummarySource, /Incomplete cost data/);
  assert.match(analysisSummarySource, /deferredPerformance\.economics\.marginAfterRecordedCosts/);
  assert.doesNotMatch(jobSource, /Estimated versus actual costs|Detailed item comparison|Job-linked receipts and expenses/);
  assert.doesNotMatch(analysisSummarySource, /Job Target|Remaining estimated cost/);
  assert.doesNotMatch(jobSource, /contractValue - actualCosts|projectedProfitFromTracking/);
});