import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const listSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');

test('Convert to Job modals use review-first copy and clear field labels', () => {
  for (const source of [listSource, workspaceSource]) {
    assert.match(source, /title="Convert to Job"/);
    assert.match(source, /Create a job from this accepted estimate\. Review the job details below before converting\./);
    assert.match(source, /label="Job Title"/);
    assert.match(source, /label="Start Date"/);
    assert.match(source, /label="End Date"/);
    assert.match(source, /'Creating Job\.\.\.' : 'Create Job'/);
    assert.doesNotMatch(source, /Job Title Override|Start Date Override|End Date Override|Leave any field blank to use/);
  }
});

test('Convert to Job modals show Estimate and Customer summaries', () => {
  for (const source of [listSource, workspaceSource]) {
    assert.match(source, />Estimate:<\/span>/);
    assert.match(source, />Customer:<\/span>/);
  }
});

test('Convert to Job forms prefill canonical estimate details without inventing dates', () => {
  for (const source of [listSource, workspaceSource]) {
    assert.match(source, /title: estimate\.title \?\? ''/);
    assert.match(source, /startDate: estimate\.serviceStartDate\?\.slice\(0, 10\) \?\? ''/);
    assert.match(source, /endDate: estimate\.serviceEndDate\?\.slice\(0, 10\) \?\? ''/);
  }
});

test('Convert to Job modals reject an end date before the start date inline', () => {
  for (const source of [listSource, workspaceSource]) {
    assert.match(source, /convertForm\.startDate > convertForm\.endDate/);
    assert.match(source, /Start Date must be on or before End Date\./);
    assert.match(source, /max=\{convertForm\.endDate \|\| undefined\}/);
    assert.match(source, /min=\{convertForm\.startDate \|\| undefined\}/);
    assert.match(source, /role="alert">\{convertDateError\}/);
    assert.match(source, /disabled=\{!!convertingEstimateId \|\| !!convertDateError\}/);
  }
});