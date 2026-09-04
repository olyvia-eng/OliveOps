import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const jobDetailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const estimateDetailSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');

test('Jobs index uses the compact Estimates-style table instead of record cards', () => {
  assert.match(jobsSource, /<div className="overflow-x-auto">\s*<table className="w-full min-w-\[1120px\] table-fixed text-sm">/);
  for (const column of ['Job', 'Customer', 'Work Areas', 'Status', 'Labour Hours', 'Contract Value', 'Actions']) {
    assert.match(jobsSource, new RegExp(`>${column}<`));
  }
  assert.doesNotMatch(jobsSource, />Risk<\/th>/);
  assert.match(jobsSource, /<tbody className="divide-y divide-gray-100 dark:divide-brand-700">/);
  assert.doesNotMatch(jobsSource, /<Card\s+key=\{job\.id\}/);
});

test('Jobs search and status filter remain while risk filtering is absent from the list', () => {
  assert.match(jobsSource, /placeholder="Search jobs…"/);
  assert.match(jobsSource, /j\.title\.toLowerCase\(\)\.includes\(search\.toLowerCase\(\)\)/);
  assert.match(jobsSource, /statusFilter === 'all' \|\| j\.status === statusFilter/);
  assert.doesNotMatch(jobsSource, /riskFilter|All Risk Levels|At Risk Jobs/);
});

test('Jobs rows preserve customer, work-area, labour-hours, and contract presentation', () => {
  assert.match(jobsSource, /customer\?\.name \?\? '—'/);
  assert.match(jobsSource, /job\.operationalWorkAreas\?\.map\(\(area\) => area\.name\) \?\? job\.workAreas \?\? \[\]/);
  assert.match(jobsSource, /title=\{workAreaLabel\}/);
  assert.match(jobsSource, /const actualHours = performance\.labour\.actual\.hours/);
  assert.match(jobsSource, /const estimatedHours = performance\.labour\.estimated\.hours/);
  assert.match(jobsSource, /actualHours\.toFixed\(1\).*estimatedHours\.toFixed\(1\)/);
  assert.match(jobsSource, /formatCurrency\(performance\.revenue\.contract\)/);
  assert.doesNotMatch(jobsSource, /label="At Risk"|label="On Track"/);
  assert.match(jobsSource, /label="From Estimate" className="shrink-0 whitespace-nowrap/);
  assert.doesNotMatch(jobsSource, /formatCurrency\(profit\).*margin/);
});

test('Jobs risk calculations remain available to the detail panel but not table rows', () => {
  assert.match(jobsSource, /const jobRiskById = useMemo/);
  assert.match(jobsSource, /const lowMargin = false/);
  assert.match(jobsSource, /const laborVarianceHigh = Boolean\(labourCostRow\?\.variance !== null/);
  assert.match(jobsSource, /risk=\{jobRiskById\.get\(selectedJob\.id\)\}/);
  assert.doesNotMatch(jobsSource, /projectedMarginFromTracking|HIGH_LABOR_VARIANCE_THRESHOLD_PCT/);
});

test('Jobs rows retain URL-backed open and edit actions without duplicate row activation', () => {
  assert.match(jobsSource, /const selectJob = \(jobId: string\) => setSearchParams\(openDetailWorkspace/);
  assert.match(jobsSource, /onClick=\{\(\) => selectJob\(job\.id\)\}/);
  assert.match(jobsSource, /title="Open Details"/);
  assert.match(jobsSource, /event\.stopPropagation\(\); selectJob\(job\.id\)/);
  assert.match(jobsSource, /title="Edit Job"/);
  assert.match(jobsSource, /event\.stopPropagation\(\); openEdit\(job\)/);
});

test('Jobs toolbar and table retain responsive and dark-mode treatments', () => {
  assert.match(jobsSource, /flex flex-col sm:flex-row gap-3 mb-6/);
  assert.match(jobsSource, /dark:border-brand-600 dark:bg-brand-800 dark:text-brand-50/);
  assert.match(jobsSource, /dark:hover:bg-brand-600\/60/);
  assert.match(jobsSource, /min-w-\[1120px\] table-fixed/);
  assert.match(jobsSource, /whitespace-nowrap pb-2 text-right font-medium">Contract Value/);
});

test('dedicated Job and Estimate detail pages remain available and separate from list markup', () => {
  assert.match(jobDetailSource, /export default function JobDetailPage/);
  assert.match(jobDetailSource, /Operational Job Information/);
  assert.match(estimateDetailSource, /export default function EstimateWorkspacePage/);
  assert.match(estimateDetailSource, /activeTab === 'info'/);
  assert.match(estimateDetailSource, /activeTab === 'proposal'/);
  assert.doesNotMatch(jobDetailSource, /Search jobs…/);
  assert.doesNotMatch(estimateDetailSource, /Search jobs…/);
});
