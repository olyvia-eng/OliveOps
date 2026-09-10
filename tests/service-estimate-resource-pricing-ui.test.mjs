import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('src/pages/estimates/ServiceEstimateWorkspacePage.tsx', 'utf8');
const pricingEditor = readFileSync('src/components/estimates/EstimateLinePricingEditor.tsx', 'utf8');

test('selecting a Service resource creates a draft and only Add Resource mutates line items', () => {
  assert.match(workspace, /const \[resourceDraft, setResourceDraft\]/);
  assert.match(workspace, /onClick=\{\(\) => selectCatalogItem\(item\)\}/);
  assert.match(workspace, /setResourceDraft\(\{ serviceId: catalogService\.id, line \}\)/);
  assert.match(workspace, /saveLabel="Add Resource"/);
  assert.match(workspace, /lineItems: \[\.\.\.\(service\.lineItems \?\? \[\]\), line as ServiceEstimateLineItem\]/);
  assert.match(workspace, /onClose=\{\(\) => \{ setResourceDraft\(null\); setCatalogServiceId\(null\); \}\}/);
  assert.doesNotMatch(workspace, /onClick=\{\(\) => addCatalogItem\(item\)\}/);
});

test('Service add and edit reuse shared usage and pricing controls', () => {
  assert.match(workspace, /editServiceUsage title="Add Resource"/);
  assert.match(workspace, /editServiceUsage title="Edit Resource"/);
  assert.match(workspace, /title="Edit resource"/);
  assert.match(pricingEditor, /aria-label="Hours \/ Qty"/);
  assert.match(pricingEditor, /aria-label="Applied"/);
  assert.match(pricingEditor, /value="per_visit">Per visit/);
  assert.match(pricingEditor, /value="service_period">Once/);
  assert.match(pricingEditor, /aria-label="Profit margin"/);
  assert.match(pricingEditor, /aria-label="Sell Price"/);
});

test('Service pricing displays canonical economics and explicit custom-price state', () => {
  assert.match(pricingEditor, />Direct Cost</);
  assert.match(pricingEditor, />Breakeven</);
  assert.match(pricingEditor, />Calculated Price</);
  assert.match(pricingEditor, />Sell Price</);
  assert.match(pricingEditor, />Custom price</);
  assert.match(pricingEditor, />Reset to Calculated Price</);
  assert.match(pricingEditor, /applyEstimateLineSnapshotPricing/);
  assert.match(workspace, /line\.estimateCustomSellPrice != null/);
});

test('Service table preserves quantity, unit, Applied, edit, and delete affordances', () => {
  assert.match(workspace, /<td>\{line\.quantity\}<\/td><td>\{line\.unit\}<\/td>/);
  assert.match(workspace, /line\.costScope === 'per_visit' \? 'Per visit' : 'Once'/);
  assert.match(workspace, /openPricing\(line\.id\)/);
  assert.match(workspace, /lineItems: lines\.filter\(\(item\) => item\.id !== line\.id\)/);
});