import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const listPage = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspace = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const renderer = readFileSync('src/utils/estimateProposalPdf.ts', 'utf8');

test('both Estimate proposal actions use the shared ID-only authorized PDF path', () => {
  for (const source of [listPage, workspace]) {
    assert.match(source, /fetchEstimateProposal\(estimateId\)/);
    assert.match(source, /createEstimateProposalDocument\(proposal\)\.save\(fileName\)/);
    assert.doesNotMatch(source, /new jsPDF|autoTable|Category.*Description.*Qty.*Unit.*Rate.*Line Total/);
  }
  assert.match(renderer, /fetch\(`\/api\/estimate-proposal\?estimateId=/);
  assert.doesNotMatch(renderer, /unitCost|sellPrice|estimatedCost|profit|margin|overhead|category/);
});

test('proposal renderer has guarded pagination, compact continuation headers, and per-page footer numbering', () => {
  assert.match(renderer, /const ensureSpace = \(height: number\) => \{ if \(cursorY \+ height > CONTENT_BOTTOM\) addPage\(\); \}/);
  assert.match(renderer, /ensureSpace\(32 \+ firstLines\.length \* 12\)/);
  assert.match(renderer, /ensureSpace\(104\)/);
  assert.match(renderer, /ensureSpace\(118\)/);
  assert.match(renderer, /Page \$\{page\} of \$\{pageCount\}/);
  assert.match(renderer, /drawContinuationHeader/);
});