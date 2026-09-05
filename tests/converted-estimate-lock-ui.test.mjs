import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dataSource = readFileSync('api/data.js', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const builderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const jobsSource = readFileSync('src/pages/jobs/JobsPage.tsx', 'utf8');
const jobDetailSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');

test('generic API locks converted Estimate edits and deletion', () => {
  assert.match(dataSource, /entity === 'estimates' && existing\.status === 'converted'/);
  assert.match(dataSource, /Converted estimates are read-only\./);
  assert.match(dataSource, /Converted estimates cannot be deleted\./);
});

test('converted Jobs cannot be deleted through the generic API', () => {
  assert.match(dataSource, /entity === 'jobs' && existing\.sourceEstimateId/);
  assert.match(dataSource, /Jobs created from sold estimates cannot be deleted\./);
});

test('converted Estimate UI is read-only while preserving the linked Job action', () => {
  assert.match(workspaceSource, /const isConverted = form\.status === 'converted'/);
  assert.match(workspaceSource, /<fieldset disabled=\{isConverted\}/);
  assert.match(workspaceSource, /Converted Estimate/);
  assert.match(workspaceSource, /Open Job/);
  assert.match(builderSource, /const isReadOnly = estimate\.status === 'converted'/);
  assert.match(builderSource, /disabled=\{isReadOnly\}/);
  assert.match(builderSource, /This Work Area is part of the converted Estimate and is read-only/);
});

test('converted Job deletion stays guarded and contract editing is absent from the full Job page', () => {
  assert.match(jobsSource, /!job\.sourceEstimateId \? <Button/);
  assert.match(jobsSource, /setConfirmDelete\(job\.id\)/);
  assert.match(jobsSource, /navigate\(`\/jobs\/\$\{job\.id\}\?tab=info`\)/);
  assert.match(jobDetailSource, /Changes here update the Job only\. The sold Estimate remains unchanged\./);
  assert.match(jobDetailSource, /Contract Total/);
  assert.doesNotMatch(jobDetailSource, /<Input label="Contract Value \(\$\)"/);
});