import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('src/pages/estimates/ServiceEstimateWorkspacePage.tsx', 'utf8');
const pricingEditor = readFileSync('src/components/estimates/EstimateLinePricingEditor.tsx', 'utf8');
const inputs = readFileSync('src/components/ui/index.tsx', 'utf8');
const numberInput = readFileSync('src/utils/numberInput.ts', 'utf8');

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
  assert.equal((workspace.match(/editServiceUsage estimatedVisits=/g) ?? []).length, 2);
  assert.match(workspace, /title="Add Resource"/);
  assert.match(workspace, /title="Edit Resource"/);
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
  assert.match(pricingEditor, />Reset to calculated</);
  assert.match(pricingEditor, /applyEstimateLineSnapshotPricing/);
  assert.match(pricingEditor, /normalizeEstimateCustomSellPrice/);
  assert.match(workspace, /line\.estimateCustomSellPrice != null/);
});

test('Service Sell Price uses two-decimal currency input without raw floating-point display', () => {
  assert.match(pricingEditor, /aria-label="Sell Price" type="number" min=\{0\} currency/);
  assert.match(inputs, /currency \? formatCurrencyInputValue\(rawValue\)/);
  assert.match(numberInput, /numericValue\.toFixed\(2\)/);
  assert.match(pricingEditor, /value=\{normalizedCustomSellPrice \?\? pricing\.calculatedSellPrice\}/);
});

test('Service pricing hierarchy avoids a duplicate Estimate Price summary', () => {
  assert.match(pricingEditor, /editServiceUsage \? <div><Input label=\{`Sell Price \/ \$\{lineItem\.unit\}`\}/);
  assert.match(pricingEditor, /!editServiceUsage \? <div className="border-t[^>]*><p[^>]*>Estimate Price<\/p>/);
  assert.match(pricingEditor, /Effective margin \{pricing\.effectiveMarginPct\.toFixed\(2\)\}%/);
});

test('Service usage explanation uses canonical quantity and visit application logic', () => {
  assert.match(pricingEditor, /calculateServiceResourceUsage\(\{ \.\.\.lineItem, quantity, costScope \}, estimatedVisits\)/);
  assert.match(pricingEditor, /\{formatNumericDisplayValue\(usage\.quantity\)\} \{lineItem\.unit\}\/visit × \{formatNumericDisplayValue\(usage\.applicationCount\)\} visits = \{formatNumericDisplayValue\(usage\.totalQuantity\)\} total \{lineItem\.unit\}/);
  assert.match(workspace, /estimatedVisits=\{resolveServiceEstimatedVisits\(pricingService \?\? \{\}\)\}/);
});

test('Service table preserves quantity, unit, Applied, edit, and delete affordances', () => {
  assert.match(workspace, /<td>\{line\.quantity\}<\/td><td>\{line\.unit\}<\/td>/);
  assert.match(workspace, /line\.costScope === 'per_visit' \? 'Per visit' : 'Once'/);
  assert.match(workspace, /openPricing\(line\.id\)/);
  assert.match(workspace, /lineItems: lines\.filter\(\(item\) => item\.id !== line\.id\)/);
});

test('contract pricing distinguishes the recommendation from the customer override', () => {
  assert.match(workspace, /label="Recommended contract total" type="number" currency/);
  assert.match(workspace, /Calculated from resources, overhead and profit/);
  assert.match(workspace, /label="Customer contract total" type="number" min=\{0\} currency/);
  assert.match(workspace, /What you will charge the customer for this service/);
  assert.match(workspace, /Recommended \{formatCurrency\(recommendedContractTotal\)\}/);
  assert.match(workspace, />Reset to recommended<\/button>/);
  assert.match(workspace, /customContractPrice: roundServiceMoney\(next\) === roundServiceMoney\(recommendedContractTotal\) \? null : next/);
  assert.match(workspace, /const recommendedContractTotal = economics\.calculatedServiceValue/);
});