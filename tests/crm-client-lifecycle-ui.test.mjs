import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const crm = readFileSync('src/pages/crm/CRMPage.tsx', 'utf8');
const detail = readFileSync('src/pages/crm/ClientDetailPanel.tsx', 'utf8');
const estimates = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const jobs = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');

test('CRM exposes only canonical Lead and Client statuses with an explicit legacy review state', () => {
  assert.match(crm, /CUSTOMER_STATUSES\.map/);
  assert.doesNotMatch(crm, /value="inactive"|value="prospect"|value="active"/);
  assert.match(crm, /c\.status === 'inactive' \? '' : c\.status/);
  assert.match(crm, /Choose Lead or Client before saving/);
  assert.match(crm, /customerStatusLabel/);
});

test('Lead Source is optional, supports Other detail, and clears stale hidden detail', () => {
  assert.match(crm, /Lead Source \(optional\)/);
  assert.match(crm, /form\.leadSource === 'other'/);
  assert.match(crm, /leadSourceOther: event\.target\.value === 'other' \? current\.leadSourceOther : undefined/);
  assert.match(crm, /leadSourceOther: form\.leadSource === 'other'/);
  assert.match(detail, /Original Lead Source:/);
});

test('Estimate and Job customer selectors remain based on customer identity, not CRM status', () => {
  assert.match(estimates, /customers\.map\(\(customer\) => <option/);
  assert.match(jobs, /customers\.map\(\(c\) => <option/);
  assert.doesNotMatch(estimates, /customers\.filter\([^\n]*status/);
  assert.doesNotMatch(jobs, /customers\.filter\([^\n]*status/);
});