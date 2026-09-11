import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const detailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const summarySource = readFileSync('src/components/jobs/JobAnalysisSummary.tsx', 'utf8');
const workspaceSource = readFileSync('src/components/jobs/JobAnalysisWorkspace.tsx', 'utf8');
const analysisApiSource = readFileSync('src/pages/jobs/jobAnalysisApi.ts', 'utf8');
test('Jobs list contains long titles without loading labour performance', () => {
  assert.match(jobsSource, /w-full table-fixed text-sm/);
  assert.match(jobsSource, /title=\{job\.title\}/);
  assert.match(jobsSource, /max-w-full break-words text-left/);
  assert.doesNotMatch(jobsSource, />Labour Hours|No hours estimate|hr over|calculateJobPerformance/);
  assert.doesNotMatch(jobsSource, />Progress</);
  assert.doesNotMatch(jobsSource, /job\.actualHours \/ job\.estimatedHours/);
});

test('Job summary and Analysis use the normalized server performance model', () => {
  assert.doesNotMatch(jobsSource, /calculateJobPerformance|jobPerformanceById/);
  assert.match(detailSource, /<JobAnalysisWorkspace job=\{job\}/);
  assert.match(analysisApiSource, /scopeWorkAreaId/);
  assert.match(workspaceSource, /useState\('entire-job'\)/);
  assert.match(workspaceSource, /<option value="entire-job">Entire Job<\/option>/);
  assert.match(workspaceSource, /<option key=\{area\.id\} value=\{area\.id\}>\{area\.name\}<\/option>/);
  assert.match(workspaceSource, /<option value="unallocated">Unallocated<\/option>/);
  assert.match(workspaceSource, /onChange=\{\(event\) => setScope\(event\.target\.value\)\}/);
  assert.doesNotMatch(detailSource, /trackedLaborCost|projectedProfitFromTracking|job\.actualHours\.toFixed/);
});

test('Job Analysis renders the complete scoped cost workspace', () => {
  assert.match(detailSource, /analysisVisited && canViewAnalysis/);
  assert.match(detailSource, /hidden=\{activeTab !== 'analysis'\}/);
  assert.match(detailSource, /<JobAnalysisWorkspace job=\{job\} \/>/);
  assert.match(detailSource, /if \(activeTab === 'analysis' && canViewAnalysis\) setAnalysisVisited\(true\)/);
  for (const label of ['Accepted Estimate baseline compared with direct costs recorded to date.', 'Job Cost Summary', 'Estimated vs Actual', 'Time Analysis', 'Equipment Usage', 'Material Vendor Bills', 'Subcontractor Bills']) assert.match(workspaceSource, new RegExp(label));
});

test('Job detail uses stable store selection and lazy tab data survives tab switches', () => {
  assert.match(detailSource, /useStore\(useShallow\(/);
  assert.doesNotMatch(detailSource, /useStore\(\);/);
  assert.match(detailSource, /useState\(activeTab === 'analysis' && canViewAnalysis\)/);
});

test('Vendor and Subcontractor Bills use catalog-first editable line-item workflows', () => {
  for (const label of ['Add from Estimate', 'Add from Material Catalog', 'Custom Line', 'Material / Description', 'Quantity', 'Unit Cost', 'Work Area', 'Subtotal', 'Tax', 'Total', 'Choose from Subcontractor Catalog']) assert.match(workspaceSource, new RegExp(label));
  assert.match(workspaceSource, /materialCatalogItemId/);
  assert.match(workspaceSource, /line\.quantity \* line\.unitCost/);
  assert.match(workspaceSource, /createMaterialBillLine/);
  assert.match(workspaceSource, /createSubcontractorBillLine/);
  assert.doesNotMatch(workspaceSource, /> Add line</);
});

test('Job economics mirrors the Budget split-card hierarchy without coupling calculation models', () => {
  assert.match(summarySource, /lg:grid-cols-\[minmax\(0,0\.9fr\)_minmax\(360px,1\.1fr\)\]/);
  assert.match(summarySource, /Job Economics/);
  assert.match(summarySource, /Financial Summary/);
  assert.match(summarySource, /Cost Distribution/);
  assert.match(summarySource, /Planned internal cost allocation/);
  assert.match(summarySource, /valueMode === mode/);
  assert.doesNotMatch(summarySource, /budgetFinancialModel|buildBudgetAnalysisSummary|Target Profit Margin/);
});

test('Job financial summary keeps estimated, actual, and variance values in explicit modes', () => {
  for (const label of ['Estimated', 'Actual to date', 'Variance', 'Contract revenue, excluding tax', 'Total estimated cost', 'Total actual cost to date', 'Expected profit', 'Expected profit margin', 'Margin after recorded costs', 'Cost consumed']) assert.match(summarySource, new RegExp(label));
  assert.match(summarySource, /under estimate to date/);
  assert.match(summarySource, /over estimate/);
  assert.match(summarySource, /On estimate/);
  assert.match(summarySource, /actual costs recorded to date/);
  assert.match(summarySource, /It is not the final Job profit until all costs are recorded/);
  assert.match(summarySource, /value === null \? 'Unavailable' : formatCurrency\(value\)/);
  assert.match(summarySource, /row\.variance === null/);
  assert.doesNotMatch(summarySource, /Incomplete cost data:/);
});

test('one Analysis mode controls accessible distribution and variance visualizations', () => {
  assert.match(summarySource, /ariaLabel="Job Analysis mode"/);
  assert.doesNotMatch(summarySource, /chartMode|summaryMode/);
  assert.match(summarySource, /<PieChart>/);
  assert.match(summarySource, /<BarChart/);
  assert.match(summarySource, /Cost variance by category/);
  assert.match(summarySource, /<table className="sr-only">/);
  assert.match(summarySource, /segment\.amount > 0/);
  assert.match(summarySource, /mode === 'actual' && !deferredPerformance\.economics\.actualCostComplete/);
  assert.match(summarySource, /mode === 'variance' && deferredPerformance\.costs\.varianceUnavailableCategories\.length/);
  assert.doesNotMatch(summarySource, /Job Target|Remaining estimated cost|forecastUnavailableReason/);
  assert.doesNotMatch(summarySource, /<Input|onTargetMarginChange/);
});

test('legacy Estimates use contract value allocation without presenting it as cost or profit', () => {
  assert.match(summarySource, /Contract Value Distribution/);
  assert.match(summarySource, /How the accepted pre-tax contract value is distributed by category\./);
  assert.match(summarySource, /contractValueChartSegments/);
  assert.match(summarySource, /Accepted contract value distribution chart/);
  assert.match(summarySource, /estimatedUsesInternalCosts \? 'Planned internal cost allocation' : 'Contract value distribution'/);
  assert.match(summarySource, /deferredPerformance\.profit\.estimatedGross/);
  assert.doesNotMatch(summarySource, /contractValueChartSegments[\s\S]{0,160}estimatedGross/);
});

test('actual and variance modes filter zero slices and retain genuine unavailable states', () => {
  assert.match(summarySource, /distributionSegments\.filter\(\(segment\) => segment\.amount > 0\)/);
  assert.doesNotMatch(summarySource, /Unavailable actual costs:/);
  assert.doesNotMatch(summarySource, /Actual cost data is incomplete/);
  assert.match(summarySource, /No comparable accepted and actual cost data for:/);
  assert.match(summarySource, /No recorded actual costs yet\./);
  assert.match(summarySource, /row\.variance === null \? \[\] :/);
  assert.match(summarySource, /useDeferredValue\(performance\)/);
  assert.match(summarySource, /deferredPerformance !== performance/);
  assert.match(analysisApiSource, /query\.set\('scopeWorkAreaId', options\.scopeWorkAreaId\)/);
});

test('Job Analysis restores a grouped Estimate and actual chart from the table category data', () => {
  assert.match(workspaceSource, /<CostComparisonChart rows=\{analysis\.categories\} \/>/);
  assert.match(workspaceSource, /<BarChart data=\{data\}/);
  assert.match(workspaceSource, /dataKey="Estimated"/);
  assert.match(workspaceSource, /dataKey="Actual"/);
  assert.match(workspaceSource, /Estimated and actual cost by category/);
});

test('Project Job header delegates status editing to Info and keeps scheduling in existing workflows', () => {
  const header = detailSource.slice(detailSource.indexOf('<div className="mb-4">'), detailSource.indexOf('<div className="mb-6 overflow-x-auto">'));
  assert.doesNotMatch(header, /Edit Schedule|Schedule Job|label="Job Status"/);
  assert.match(detailSource, /<Select label="Job Status" value=\{jobInfo\.status\}/);
  assert.match(detailSource, /updateJob\(job\.id, \{ \.\.\.jobInfo/);
});

test('Job Proposal uses OliveOps surfaces without changing PDF generation', () => {
  assert.match(detailSource, /rounded-lg border-brand-100 bg-white dark:border-brand-600 dark:bg-brand-700/);
  assert.match(detailSource, /bg-brand-50\/70/);
  assert.match(detailSource, /dark:bg-brand-800\/50/);
});