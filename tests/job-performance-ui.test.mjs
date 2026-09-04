import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const detailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const panelSource = readFileSync('src/pages/jobs/JobDetailPanel.tsx', 'utf8');

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
  assert.match(jobsSource, /performance=\{jobPerformanceById\.get\(selectedJob\.id\)\}/);
  assert.match(panelSource, /performance\?\.labour\.actual\.hours/);
  assert.match(detailSource, /scopeWorkAreaId: analysisScope/);
  assert.match(detailSource, /<option value="entire-job">Entire Job<\/option>/);
  assert.match(detailSource, /<option value="unallocated">Unallocated<\/option>/);
  assert.doesNotMatch(detailSource, /trackedLaborCost|projectedProfitFromTracking|job\.actualHours\.toFixed/);
});

test('Job Analysis exposes source-aware financial, time, detail, and expense sections', () => {
  for (const label of ['Contract revenue', 'Issued revenue', 'Estimated gross profit', 'Estimated net profit', 'Profit to date', 'Estimated versus actual costs', 'Unbillable work', 'Detailed item comparison', 'Job-linked receipts and expenses']) {
    assert.match(detailSource, new RegExp(label));
  }
  assert.match(detailSource, /Incomplete cost data/);
  assert.match(detailSource, /performance\.costs\.varianceConvention/);
  assert.match(detailSource, /Not tracked/);
  assert.match(detailSource, /Supporting record; not added again/);
});