import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const cardSource = readFileSync('src/components/jobs/JobLabourSummaryCard.tsx', 'utf8');

test('Job Analysis loads one authoritative labour summary without changing quoted revenue', () => {
  assert.match(detailSource, /\/api\/job-labour-summary\?jobId=/);
  assert.match(detailSource, /<JobLabourSummaryCard summary=\{labourSummary\}/);
  assert.doesNotMatch(cardSource, /contractValue|originalEstimateSnapshot|estimatedRevenue/);
});

test('Job labour Analysis compares estimate, schedule, and actual with useful drill-downs', () => {
  assert.match(cardSource, /label="Estimated"/);
  assert.match(cardSource, /label="Scheduled"/);
  assert.match(cardSource, /label="Actual"/);
  assert.match(cardSource, /By Labour Class/);
  assert.match(cardSource, /Scheduled Employees/);
  assert.match(cardSource, /Actual Employees/);
  assert.match(cardSource, /under estimate/);
  assert.match(cardSource, /over estimate/);
});

test('unknown durations and labour costs remain visibly unavailable', () => {
  assert.match(cardSource, /total\.hoursAvailable \? hours\(total\.hours\) : 'Unavailable'/);
  assert.match(cardSource, /row\.scheduledCostAvailable \? formatCurrency\(row\.scheduledCost\) : 'Unavailable'/);
  assert.match(cardSource, /row\.actualCostAvailable \? formatCurrency\(row\.actualCost\) : 'Unavailable'/);
});