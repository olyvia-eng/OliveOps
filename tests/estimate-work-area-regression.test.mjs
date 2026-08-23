import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const builderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const modelSource = readFileSync('src/utils/estimateModel.ts', 'utf8');

test('new and additional work areas are persisted before becoming actionable', () => {
  assert.match(workspaceSource, /No work areas yet/);
  assert.match(workspaceSource, /form\.workAreas\.length === 0/);
  assert.match(workspaceSource, /createNewEstimateWorkArea/);
  assert.match(workspaceSource, /saved = await persistEstimateForm\(nextForm\);/);
  assert.match(workspaceSource, /saved = await persistEstimateForm\(nextForm\);\s*\} finally \{\s*saveInFlight\.current = false;\s*setSavingEstimate\(false\);\s*\}\s*if \(saved\) \{\s*navigate/);
  assert.match(workspaceSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{nextWorkArea\.id\}`\)/);
  assert.equal(workspaceSource.match(/navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{nextWorkArea\.id\}`\)/g)?.length, 1);
  assert.match(workspaceSource, /savingEstimate/);
  assert.doesNotMatch(workspaceSource, /generateId\(\)\s*;\s*const workAreaId/);
});

test('builder waits for persistence before save and delete navigation', () => {
  assert.match(builderSource, /await updateEstimate\(estimate\.id, payload\)/);
  assert.match(builderSource, /setSavingWorkArea\(true\)/);
  assert.match(builderSource, /Work area saved\./);
  assert.match(builderSource, /Work area deleted\./);
  assert.match(builderSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\?tab=work-areas`\)/);
  assert.match(builderSource, /title=\{`Delete "\$\{workArea\.name\}"\?`\}/);
  assert.match(builderSource, /deletingWorkArea \? 'Deleting\.\.\.' : 'Delete Work Area'/);
  assert.match(builderSource, /Labour, Equipment, Materials, and Subcontractor items/);
});

test('builder uses category-specific pickers without a persistent catalog or editable Division', () => {
  assert.match(builderSource, /openCatalog\(category\)/);
  assert.match(builderSource, /Add \{CATEGORY_ADD_LABEL\[category\]\}/);
  assert.match(builderSource, /candidate\.category === catalogCategory/);
  assert.match(builderSource, /Search \$\{CATEGORY_LABEL\[catalogCategory\]\.toLowerCase\(\)\}/);
  assert.match(builderSource, /candidate\.alreadyAdded \|\|/);
  assert.match(builderSource, /Custom \{CATEGORY_ADD_LABEL\[catalogCategory\]\}/);
  assert.doesNotMatch(builderSource, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
  assert.doesNotMatch(builderSource, /label="Division"/);
  assert.doesNotMatch(builderSource, /\['all', \.\.\.CATEGORY_ORDER\]/);
});

test('work-area normalization uses stable legacy IDs and does not invent a placeholder for empty estimates', () => {
  assert.match(modelSource, /export function normalizeEstimateWorkAreas/);
  assert.match(modelSource, /if \(legacyAreaNames\.length === 0 && legacyLineItems\.length === 0\) return \[\]/);
  assert.match(modelSource, /id: legacyWorkAreaId\(estimateId, JSON\.stringify\(/);
  assert.doesNotMatch(modelSource, /id: generateId\(\),\s*name: legacyAreaNames/);
  assert.match(modelSource, /export function createDefaultEstimateWorkArea/);
  assert.match(modelSource, /export function createNewEstimateWorkArea/);
});
