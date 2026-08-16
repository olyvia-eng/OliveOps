import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('src/pages/budget/DivisionWorkspacePage.tsx', 'utf8');
const planner = readFileSync('src/components/budget/DivisionPlanningTab.tsx', 'utf8');
const importer = readFileSync('src/components/budget/BudgetPlanImportDialog.tsx', 'utf8');
const store = readFileSync('src/store/index.ts', 'utf8');

test('all four Division planning tabs provide intentional Add and Import empty states', () => {
  assert.match(workspace, /category=\{activeTab\}/);
  assert.match(planner, /No labour planned yet/);
  assert.match(planner, /No equipment planned yet/);
  assert.match(planner, /No materials planned yet/);
  assert.match(planner, /No subcontractors planned yet/);
  assert.match(planner, /Add \{settings\.singular\}/);
  assert.match(planner, /Import from Previous Budget/);
});

test('planning tabs retain Add and Import actions after items exist and support independent ordering', () => {
  assert.match(planner, /items\.length === 0[\s\S]*actions[\s\S]*items\.length/);
  assert.match(planner, /draggable=\{canEdit\}/);
  assert.match(planner, /onDragStart/);
  assert.match(planner, /reorderBudgetDivisionPlanningItems/);
  assert.match(planner, /Move \$\{item\.name \?\? item\.description\} earlier/);
  assert.match(planner, /Move \$\{item\.name \?\? item\.description\} later/);
});

test('import dialog exposes Budget and Division selectors, preview selection, duplicates, and destination confirmation', () => {
  assert.match(importer, /Copy \$\{labelByCategory\[category\]\.toLowerCase\(\)\} planning items from/);
  assert.match(importer, /Source Division/);
  assert.match(importer, /Destination/);
  assert.match(importer, /→ \{division\.name\}/);
  assert.match(importer, /Select All/);
  assert.match(importer, /Clear All/);
  assert.match(importer, /Already added/);
  assert.match(importer, /Import to \{division\.name\}/);
  assert.match(importer, /Import \{selected\.size\} Item/);
});

test('successful imports merge authoritative records without refreshing the browser', () => {
  assert.match(store, /importBudgetDivisionPlanningItems/);
  assert.match(store, /payload\.items/);
  assert.match(store, /budgetDivisionPlanningItems:/);
  assert.doesNotMatch(importer, /window\.location|location\.reload/);
});

test('Labour form separates classification, billable capacity, overtime, and Division allocation', () => {
  assert.match(planner, /Labour Classification/);
  assert.match(planner, /Billable Labour/);
  assert.match(planner, /Overhead Labour/);
  assert.match(planner, /Expected Billable %/);
  assert.match(planner, /draft\.labourClassification !== 'overhead'/);
  assert.match(planner, /Planned Overtime Hours \/ Year/);
  assert.match(planner, /Overtime Multiplier/);
  assert.match(planner, /Expected Billable Hours/);
  assert.match(planner, /Direct Cost \/ Billable Hour/);
  assert.match(planner, /Included in overhead pool; no billable charge-out rate/);
  assert.match(planner, /activeDivisions\.map/);
  assert.match(planner, /Allocate Employee Cost Across Divisions/);
  assert.match(planner, /Remaining:/);
  assert.match(planner, /over allocation/);
  assert.match(planner, /!labourAllocationValid \|\| !labourInputsValid/);
});

test('Labour plan table stays compact while showing recovery and allocation summaries', () => {
  assert.match(planner, /Annual Cost/);
  assert.match(planner, /directCostPerBillableHour/);
  assert.match(planner, /allocationNames/);
  assert.match(planner, /overhead pool/);
  assert.doesNotMatch(planner, /overhead recovery|target margin|sell rate/i);
});
