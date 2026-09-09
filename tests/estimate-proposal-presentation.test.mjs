import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const listPage = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspace = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const renderer = readFileSync('src/utils/estimateProposalPdf.js', 'utf8');
const proposalBrand = readFileSync('src/utils/proposalBrand.js', 'utf8');

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
  assert.match(renderer, /const ensureSpace = \(height\) =>/);
  assert.match(renderer, /heading\('Work Areas', 57\)/);
  assert.match(renderer, /const richText = \(document/);
  assert.match(renderer, /ensureSpace\(lineHeight \+ 2\)/);
  assert.match(renderer, /heading\('Payment Schedule', Math\.max/);
  assert.match(renderer, /ensureSpace\(options\.acceptance \? 150 : 142\)/);
  assert.match(renderer, /Page \$\{page\} of \$\{pageCount\}/);
  assert.match(renderer, /continuationHeader/);
  assert.match(renderer, /const customerDocumentLabel = options\.acceptance \? 'ACCEPTED' : 'PROPOSAL'/);
  assert.match(renderer, /doc\.rect\(0, 752, PAGE_WIDTH, 40, 'F'\)/);
});

test('proposal PDF uses centralized canonical Tailwind colors without active ad-hoc muddy fills', () => {
  assert.match(renderer, /import \{ PROPOSAL_BRAND \} from '\.\/proposalBrand\.js'/);
  for (const token of ['brand-900', 'brand-500', 'brand-50', 'brand-200', 'brand-100', 'accent-500', 'accent-700']) assert.match(proposalBrand, new RegExp(token));
  for (const oldLiteral of ['74, 100, 24', '107, 142, 35', '238, 244, 227', '202, 223, 162']) assert.doesNotMatch(renderer, new RegExp(oldLiteral));
});