import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const categoriesPage = readFileSync('src/pages/settings/UnbillableTimeCategoriesPage.tsx', 'utf8');
const publicProposalPage = readFileSync('src/pages/public/PublicProposalPage.tsx', 'utf8');
const pdfRenderer = readFileSync('src/utils/estimateProposalPdf.js', 'utf8');
const proposalBrand = readFileSync('src/utils/proposalBrand.js', 'utf8');

test('Unbillable Time Categories hides sorting controls while preserving internal ordering', () => {
  assert.doesNotMatch(categoriesPage, /label="Sort Order"/);
  assert.doesNotMatch(categoriesPage, />Sort<\/th>/);
  assert.match(categoriesPage, /a\.sortOrder - b\.sortOrder/);
  assert.match(categoriesPage, /sortOrder: categories\.reduce/);
});

test('customer proposal uses the OliveOps palette and rounded document hierarchy', () => {
  assert.match(publicProposalPage, /rounded-2xl border border-brand-100 bg-white/);
  assert.match(publicProposalPage, /bg-accent-700/);
  assert.match(publicProposalPage, /border-accent-200 bg-accent-50/);
  assert.match(publicProposalPage, />Work Areas</);

  assert.match(pdfRenderer, /import \{ PROPOSAL_BRAND \} from '\.\/proposalBrand\.js'/);
  assert.match(proposalBrand, /accentStrong:[^\n]+\/\/ accent-700/);
  assert.match(proposalBrand, /neutral:[^\n]+\/\/ brand-50/);
  assert.match(pdfRenderer, /doc\.roundedRect\(24, 18, PAGE_WIDTH - 48, 92, 8, 8, 'FD'\)/);
});