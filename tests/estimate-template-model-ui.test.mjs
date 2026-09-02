import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createTemplateEstimateScope,
  normalizeEstimateTemplate,
  templateWritePayload,
} from '../src/utils/estimateTemplateModel.js';

const appSource = readFileSync('src/App.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const templatesSource = readFileSync('src/pages/estimates/TemplatesPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/TemplateWorkspacePage.tsx', 'utf8');
const builderSource = readFileSync('src/pages/estimates/TemplateWorkAreaBuilderPage.tsx', 'utf8');
const categorySource = readFileSync('src/components/work-areas/workAreaCategories.ts', 'utf8');

const legacyTemplate = {
  id: 'legacy-template',
  name: 'Legacy Patio',
  description: 'Old priced scope',
  notes: 'Legacy proposal note',
  taxRate: 15,
  lineItems: [{
    category: 'material',
    materialCatalogItemId: 'material-a',
    description: 'Granular A',
    quantity: 4,
    unit: 'tonne',
    unitCost: 25,
    sellPrice: 40,
    total: 160,
  }],
  createdAt: '2025-01-01T00:00:00.000Z',
};

test('legacy priced Templates normalize to deterministic scope-only v2 records', () => {
  const first = normalizeEstimateTemplate(legacyTemplate);
  const second = normalizeEstimateTemplate(legacyTemplate);

  assert.equal(first.schemaVersion, 2);
  assert.equal(first.proposalNotes, 'Legacy proposal note');
  assert.equal(first.legacyTaxRate, 15);
  assert.equal(first.workAreas[0].name, 'General');
  assert.equal(first.workAreas[0].lineItems[0].sourceEntityId, 'material-a');
  assert.equal(first.workAreas[0].lineItems[0].itemName, 'Granular A');
  assert.equal(first.workAreas[0].id, second.workAreas[0].id);
  assert.equal(first.workAreas[0].lineItems[0].id, second.workAreas[0].lineItems[0].id);
  assert.equal('unitCost' in first.workAreas[0].lineItems[0], false);
  assert.equal('sellPrice' in first.workAreas[0].lineItems[0], false);
  assert.equal('total' in first.workAreas[0].lineItems[0], false);
});

test('Template write payload strips compatibility economics and legacy tax', () => {
  const payload = templateWritePayload(legacyTemplate);
  const serialized = JSON.stringify(payload);

  assert.equal(payload.schemaVersion, 2);
  assert.equal(serialized.includes('unitCost'), false);
  assert.equal(serialized.includes('sellPrice'), false);
  assert.equal(serialized.includes('taxRate'), false);
  assert.equal(serialized.includes('legacyTaxRate'), false);
});

test('Template application creates independent IDs and preserves provenance', () => {
  let sequence = 0;
  const scope = createTemplateEstimateScope(legacyTemplate, () => `new-${++sequence}`);
  const normalized = normalizeEstimateTemplate(legacyTemplate);

  assert.equal(scope[0].id, 'new-1');
  assert.equal(scope[0].lineItems[0].id, 'new-2');
  assert.equal(scope[0].sourceTemplateWorkAreaId, normalized.workAreas[0].id);
  assert.equal(scope[0].lineItems[0].sourceTemplateLineItemId, normalized.workAreas[0].lineItems[0].id);
  assert.equal(scope[0].lineItems[0].pricingReadiness, 'priced');
});

test('Template routes use role-aware list, workspace, and nested builder pages', () => {
  assert.match(appSource, /path="estimates\/templates" element=\{<TemplatesPage currentUserRole=\{sessionUser\.role\} \/>\}/);
  assert.match(appSource, /path="estimates\/templates\/:templateId" element=\{<TemplateWorkspacePage currentUserRole=\{sessionUser\.role\} \/>\}/);
  assert.match(appSource, /path="estimates\/templates\/:templateId\/work-areas\/:workAreaId"/);
  assert.match(templatesSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(workspaceSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(builderSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
});

test('Template workspace supports scope operations without monetary controls', () => {
  for (const label of ['Template Name', 'Default Proposal / Scope Notes', 'Add Work Area', 'Delete Work Area']) {
    assert.match(`${workspaceSource}\n${builderSource}`, new RegExp(label));
  }
  for (const label of ['Labour', 'Equipment', 'Materials', 'Subcontractors', 'Quantity', 'Unit', 'Description']) {
    assert.match(`${categorySource}\n${builderSource}`, new RegExp(label));
  }
  assert.match(builderSource, /sourceEntityId: candidate\.id/);
  assert.match(builderSource, /updateTemplate\(normalized\.id, \{ workAreas \}\)/);
  assert.doesNotMatch(builderSource, /label="(?:Cost|Price|Rate|Markup|Total|Tax)/);
  assert.doesNotMatch(builderSource, /unitCost|sellPrice|markup|taxRate/);
});

test('New Estimate supports blank and server-priced Template starting points', () => {
  assert.match(estimatesSource, />\s*Start Blank\s*</);
  assert.match(estimatesSource, />\s*Use Template\s*</);
  assert.match(estimatesSource, /await createEstimateFromTemplate\(\{/);
  assert.match(estimatesSource, /templateId: createForm\.templateId/);
  assert.match(estimatesSource, /pricingBudgetId: createForm\.pricingBudgetId/);
  assert.match(estimatesSource, /divisionId: createForm\.divisionId/);
  assert.match(estimatesSource, /: await addEstimate\(\{/);
  assert.match(estimatesSource, /navigate\(`\/estimates\/\$\{estimateId\}`\)/);
});
