import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detailWorkspaceSource = readFileSync('src/components/detail-workspace/DetailWorkspace.tsx', 'utf8');
const crmSource = readFileSync('src/pages/crm/CRMPage.tsx', 'utf8');
const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const jobPanelSource = readFileSync('src/pages/jobs/JobDetailPanel.tsx', 'utf8');
const estimatePanelSource = readFileSync('src/pages/estimates/EstimateDetailPanel.tsx', 'utf8');

test('shared workspace keeps the list mounted in panel mode and hides it when expanded', () => {
  assert.match(detailWorkspaceSource, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(22rem,2fr\)\]/);
  assert.match(detailWorkspaceSource, /expanded \? 'hidden' : 'hidden [^']*lg:block'/);
  assert.match(detailWorkspaceSource, /overflow-y-auto overscroll-contain/);
});

test('clients, jobs, and estimates use distinct URL-owned workspace state', () => {
  assert.match(crmSource, /recordParam: 'client'.*tabParam: 'clientTab'/);
  assert.match(jobsSource, /recordParam: 'job'.*tabParam: 'jobTab'/);
  assert.match(estimatesSource, /recordParam: 'estimate'.*tabParam: 'estimateTab'/);
  for (const source of [crmSource, jobsSource, estimatesSource]) {
    assert.match(source, /<DetailWorkspace/);
    assert.match(source, /aria-selected=/);
  }
  assert.match(crmSource, /setDetailWorkspaceMode/);
  assert.match(jobsSource, /setDetailWorkspaceMode/);
  assert.doesNotMatch(estimatesSource, /setDetailWorkspaceMode|workspace\.mode === 'expanded'/);
});

test('job and estimate financial values remain role gated', () => {
  assert.match(jobsSource, /canViewFinancials \? <div className="text-right shrink-0">/);
  assert.match(estimatesSource, /canViewFinancials \? <th/);
  assert.match(jobPanelSource, /canViewFinancials \? <Card/);
  assert.match(estimatePanelSource, /canViewFinancials \? <Card/);
});

test('dense job and estimate editors remain available on dedicated routes', () => {
  assert.match(jobPanelSource, /to=\{`\/jobs\/\$\{job\.id\}`\}/);
  assert.match(estimatePanelSource, /to=\{`\/estimates\/\$\{estimate\.id\}`\}/);
  assert.match(estimatePanelSource, />Open Estimate <ArrowRight/);
  assert.doesNotMatch(estimatePanelSource, /Edit Work Area|Open Scope Builder/);
});