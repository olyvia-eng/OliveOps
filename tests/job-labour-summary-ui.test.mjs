import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const performanceSource = readFileSync('src/utils/jobPerformanceModel.js', 'utf8');
const costingSource = readFileSync('src/utils/jobCostingModel.js', 'utf8');
const workspaceSource = readFileSync('src/components/jobs/JobAnalysisWorkspace.tsx', 'utf8');
const labourSource = readFileSync('src/utils/jobLabourSummary.js', 'utf8');

test('Job Analysis retains canonical labour calculations with an employee breakdown', () => {
  assert.match(detailSource, /JobAnalysisWorkspace/);
  assert.doesNotMatch(jobsSource, /calculateJobPerformance\(\{/);
  assert.match(costingSource, /calculateJobLabourSummary\(\{/);
  assert.match(workspaceSource, /actualEmployees\.map/);
  assert.match(workspaceSource, /Time Analysis/);
  assert.doesNotMatch(detailSource, /job\.actualHours\.toFixed|trackedLaborCost|projectedProfitFromTracking/);
  assert.doesNotMatch(jobsSource, /employee\.hourlyRate|job\.actualHours \/ job\.estimatedHours/);
  assert.match(performanceSource, /calculateJobLabourSummary\(\{/);
});

test('Job labour calculations remain available to the shared performance model', () => {
  assert.match(labourSource, /export function calculateJobLabourSummary/);
  assert.match(labourSource, /estimatedHours/);
  assert.match(labourSource, /scheduledHours/);
  assert.match(labourSource, /actualHours/);
  assert.match(labourSource, /byLabourClass/);
});

test('unknown durations and labour costs remain visibly unavailable', () => {
  assert.match(labourSource, /cost: costAvailable \? cost : null/);
  assert.match(labourSource, /hoursAvailable/);
  assert.match(labourSource, /unavailableReason/);
});