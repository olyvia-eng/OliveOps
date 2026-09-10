import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detailWorkspaceSource = readFileSync('src/components/detail-workspace/DetailWorkspace.tsx', 'utf8');
const crmSource = readFileSync('src/pages/crm/CRMPage.tsx', 'utf8');
const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const jobDetailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const estimateDetailSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');

test('shared workspace keeps the list mounted in panel mode and hides it when expanded', () => {
  assert.match(detailWorkspaceSource, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(22rem,2fr\)\]/);
  assert.match(detailWorkspaceSource, /expanded \? 'hidden' : 'hidden [^']*lg:block'/);
  assert.match(detailWorkspaceSource, /overflow-y-auto overscroll-contain/);
});

test('clients retain URL-owned drawer state while jobs and estimates use full routes', () => {
  assert.match(crmSource, /recordParam: 'client'.*tabParam: 'clientTab'/);
  assert.match(crmSource, /<DetailWorkspace/);
  assert.match(crmSource, /aria-selected=/);
  assert.match(crmSource, /setDetailWorkspaceMode/);
  assert.match(jobsSource, /to=\{`\/jobs\/\$\{job\.id\}`\}/);
  assert.match(estimatesSource, /to=\{`\/estimates\/\$\{estimate\.id\}`\}/);
  assert.doesNotMatch(jobsSource, /DetailWorkspace|recordParam: 'job'|aria-selected=/);
  assert.doesNotMatch(estimatesSource, /DetailWorkspace|recordParam: 'estimate'|aria-selected=/);
});

test('financial values remain absent from the Jobs list and role gated elsewhere', () => {
  assert.doesNotMatch(jobsSource, />Contract Value<|canViewFinancials/);
  assert.match(estimatesSource, /canViewFinancials \? <th/);
  assert.match(jobDetailSource, /const canEditFinancials = currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(jobDetailSource, /\{canEditFinancials \? <>/);
  assert.match(estimateDetailSource, /activeTab === 'analysis' && canViewAnalysis/);
});

test('dense job and estimate editors remain available on dedicated routes', () => {
  assert.match(jobDetailSource, /Operational Job Information/);
  assert.match(jobDetailSource, /activeTab === 'work-areas'/);
  assert.match(estimateDetailSource, /activeTab === 'info'/);
  assert.match(estimateDetailSource, /activeTab === 'work-areas'/);
});