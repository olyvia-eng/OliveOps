import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const querySource = readFileSync('src/components/detail-workspace/detailWorkspaceQuery.ts', 'utf8');
const crmSource = readFileSync('src/pages/crm/CRMPage.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');

test('detail workspace query updates preserve unrelated list parameters', () => {
  assert.match(querySource, /new URLSearchParams\(searchParams\)/);
  assert.match(querySource, /next\.delete\(config\.recordParam\)/);
  assert.match(querySource, /next\.delete\(config\.tabParam\)/);
  assert.match(querySource, /next\.delete\('workspace'\)/);
  assert.doesNotMatch(querySource, /new URLSearchParams\(\)/);
});

test('CRM selection, mode, and tabs are derived from the URL', () => {
  assert.match(crmSource, /recordParam: 'client'/);
  assert.match(crmSource, /readDetailWorkspaceQuery\(searchParams/);
  assert.match(crmSource, /setDetailWorkspaceMode/);
  assert.match(crmSource, /setDetailWorkspaceTab/);
  assert.match(crmSource, /aria-selected=/);
});

test('client estimate creation preselects and consumes the customer query parameter', () => {
  assert.match(estimatesSource, /params\.get\('customer'\)/);
  assert.match(estimatesSource, /customerId: customerId \?\? ''/);
  assert.match(estimatesSource, /params\.delete\('customer'\)/);
});