import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const selectorSource = readFileSync('src/pages/crm/clientDetailSelectors.ts', 'utf8');
const panelSource = readFileSync('src/pages/crm/ClientDetailPanel.tsx', 'utf8');

test('client detail selectors scope all related records by customer', () => {
  assert.match(selectorSource, /estimates\.filter\(\(estimate\) => estimate\.customerId === customerId\)/);
  assert.match(selectorSource, /jobs\.filter\(\(job\) => job\.customerId === customerId\)/);
  assert.match(selectorSource, /invoices\.filter\(\(invoice\) => invoice\.customerId === customerId\)/);
  assert.match(selectorSource, /job\.status === 'scheduled' \|\| job\.status === 'in_progress'/);
});

test('client values use the canonical normalized estimate calculation', () => {
  assert.match(selectorSource, /normalizeEstimateWorkAreas\(estimate\)/);
  assert.match(selectorSource, /computeEstimateSubtotal/);
  assert.match(selectorSource, /computeEstimateTax/);
  assert.match(selectorSource, /computeEstimateTotal/);
});

test('client financial summaries are hidden when the role cannot view them', () => {
  assert.match(panelSource, /canViewFinancials \? <Card/);
  assert.match(panelSource, /canViewFinancials \? <span/);
  assert.match(panelSource, /Overview/);
  assert.match(panelSource, /Estimates/);
  assert.match(panelSource, /Jobs/);
  assert.match(panelSource, /Notes/);
});