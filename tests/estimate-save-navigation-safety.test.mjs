import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isEstimateEditorDirty } from '../src/utils/estimateDirtyModel.js';

const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const builderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const guardSource = readFileSync('src/components/navigation/UnsavedChangesGuard.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const sidebarItemSource = readFileSync('src/components/layout/SidebarItem.tsx', 'utf8');

const savedEstimate = {
  title: 'Patio',
  taxRate: 13,
  workAreas: [{ id: 'area-1', name: 'Base', lineItems: [{ id: 'line-1', category: 'labour', workers: 1, quantity: 8, sellPrice: 100, total: 800 }] }],
};

test('Estimate dirty state changes only when persisted editor fields change', () => {
  const hydratedCopy = structuredClone(savedEstimate);
  assert.equal(isEstimateEditorDirty(hydratedCopy, savedEstimate), false, 'hydration or calculated rerender alone remains clean');
  hydratedCopy.workAreas[0].lineItems[0].workers = 2;
  assert.equal(isEstimateEditorDirty(hydratedCopy, savedEstimate), true, 'editing a persisted field marks the Estimate dirty');
  assert.equal(isEstimateEditorDirty(savedEstimate, savedEstimate), false, 'replacing the baseline after save clears dirty state');
});

test('top, bottom, and Save & Leave await the existing page save operation', () => {
  assert.match(workspaceSource, /onSave: \(\) => saveIfDirty\(\{ force: true, showSuccess: true \}\)/);
  assert.match(workspaceSource, /<Button onClick=\{\(\) => void save\(\)\} disabled=\{!isDirty \|\| savingEstimate\}>/);
  assert.match(workspaceSource, /persistedFormBaseline\.current = savedForm;\s*setForm\(savedForm\)/);

  assert.match(builderSource, /onSave: persistWorkArea/);
  assert.ok((builderSource.match(/onClick=\{\(\) => void persistWorkArea\(\)\}/g) ?? []).length >= 2, 'top and bottom save share persistWorkArea');
  assert.match(builderSource, /disabled=\{!isDirty \|\| savingWorkArea\}>\{savingWorkArea \? 'Saving\.\.\.' : 'Save Changes'\}/);
});

test('internal navigation presents all three unsaved-change outcomes', () => {
  assert.match(guardSource, /title="Unsaved changes"/);
  assert.match(guardSource, /Keep Editing/);
  assert.match(guardSource, /Leave Without Saving/);
  assert.match(guardSource, /Save & Leave/);
  assert.match(guardSource, /const saved = await onSave\(\);\s*if \(!saved\) return;/, 'failed Save & Leave must not navigate');
  assert.match(guardSource, /if \(!isDirty\) \{\s*navigate\(destination\);/, 'clean navigation must not warn');
  assert.match(builderSource, /requestNavigation\(`\/estimates\/\$\{estimate\.id\}\?tab=work-areas`\)/, 'Back uses the guard');
});

test('sidebar and browser protections are active only through the shared dirty guard', () => {
  assert.match(sidebarItemSource, /requestAppNavigation\(item\.to\)/);
  assert.match(sidebarSource, /navigateGuarded\('\/home'\)/);
  assert.match(sidebarSource, /navigateGuarded\(path\)/);
  assert.match(guardSource, /if \(!isDirty\) return;\s*\n\s*const handleBeforeUnload/);
  assert.match(guardSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/);
  assert.match(guardSource, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/);
  assert.match(guardSource, /document\.addEventListener\('click', handleInternalLink, true\)/);
});
