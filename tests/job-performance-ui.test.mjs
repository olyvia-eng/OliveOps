import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const detailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const summarySource = readFileSync('src/components/jobs/JobAnalysisSummary.tsx', 'utf8');
const analysisTabSource = detailSource.slice(
  detailSource.indexOf("activeTab === 'analysis'"),
  detailSource.indexOf("activeTab === 'project-management'"),
);

test('Jobs list contains long titles and presents labour hours instead of completion progress', () => {
  assert.match(jobsSource, /min-w-\[1120px\] table-fixed/);
  assert.match(jobsSource, /title=\{job\.title\}/);
  assert.match(jobsSource, /max-w-full break-words text-left/);
  assert.match(jobsSource, />Labour Hours</);
  assert.match(jobsSource, /Actual labour hours used compared with estimated labour hours; this is not percent complete\./);
  assert.match(jobsSource, /No hours estimate/);
  assert.match(jobsSource, /hr over/);
  assert.doesNotMatch(jobsSource, />Progress</);
  assert.doesNotMatch(jobsSource, /job\.actualHours \/ job\.estimatedHours/);
});

test('Job summary and Analysis consume one shared performance model', () => {
  assert.match(jobsSource, /new Map\(jobs\.map\(\(job\) => \[job\.id, calculateJobPerformance\(\{/);
  assert.match(jobsSource, /const performance = jobPerformanceById\.get\(job\.id\)!/);
  assert.match(detailSource, /const performance = useMemo\(\(\) => job \? calculateJobPerformance\(\{/);
  assert.match(detailSource, /scopeWorkAreaId: analysisScope/);
  assert.match(detailSource, /<option value="entire-job">Entire Job<\/option>/);
  assert.match(detailSource, /<option key=\{area\.id\} value=\{area\.id\}>\{area\.name\}<\/option>/);
  assert.match(detailSource, /<option value="unallocated">Unallocated<\/option>/);
  assert.match(detailSource, /onChange=\{\(event\) => setAnalysisScope\(event\.target\.value\)\}/);
  assert.doesNotMatch(detailSource, /trackedLaborCost|projectedProfitFromTracking|job\.actualHours\.toFixed/);
});

test('Job Analysis stops after the scoped financial summary and cost distribution card', () => {
  assert.match(analysisTabSource, /Job Performance/);
  assert.match(analysisTabSource, /Accepted Estimate baseline compared with eligible time and recorded costs\./);
  assert.match(analysisTabSource, /<JobAnalysisSummary performance=\{performance\} \/>/);
  for (const label of ['Estimated versus actual costs', 'Unbillable work', 'Detailed item comparison', 'Job-linked receipts and expenses', 'JobLabourSummaryCard']) {
    assert.doesNotMatch(analysisTabSource, new RegExp(label));
  }
});

test('Job economics mirrors the Budget split-card hierarchy without coupling calculation models', () => {
  assert.match(summarySource, /lg:grid-cols-\[minmax\(0,0\.9fr\)_minmax\(360px,1\.1fr\)\]/);
  assert.match(summarySource, /Job Economics/);
  assert.match(summarySource, /Financial Summary/);
  assert.match(summarySource, /Cost Distribution/);
  assert.match(summarySource, /Where each contract dollar is currently allocated/);
  assert.match(summarySource, /valueMode === mode/);
  assert.doesNotMatch(summarySource, /budgetFinancialModel|buildBudgetAnalysisSummary|Target Profit Margin/);
});

test('Job financial summary keeps estimated, actual, and variance values in explicit modes', () => {
  for (const label of ['Estimated', 'Actual to date', 'Variance', 'Contract revenue, excluding tax', 'Total estimated cost', 'Total actual cost to date', 'Expected profit', 'Expected profit margin', 'Margin after recorded costs', 'Cost consumed']) assert.match(summarySource, new RegExp(label));
  assert.match(summarySource, /under estimate to date/);
  assert.match(summarySource, /over estimate/);
  assert.match(summarySource, /On estimate/);
  assert.match(summarySource, /Incomplete cost data/);
  assert.match(summarySource, /It is not the final Job profit until all costs are recorded/);
  assert.match(summarySource, /value === null \? 'Unavailable' : formatCurrency\(value\)/);
  assert.match(summarySource, /row\.variance === null/);
});

test('Cost distribution remains accessible and loss-safe without the target footer', () => {
  for (const label of ['Estimated costs', 'Actual costs to date']) assert.match(summarySource, new RegExp(label));
  assert.match(summarySource, /<PieChart>/);
  assert.match(summarySource, /<table className="sr-only">/);
  assert.match(summarySource, /no negative donut slice is drawn/);
  assert.match(summarySource, /segment\.amount > 0/);
  assert.doesNotMatch(summarySource, /Job Target|Planned|Remaining estimated cost|forecastUnavailableReason/);
  assert.doesNotMatch(summarySource, /<Input|onTargetMarginChange/);
});