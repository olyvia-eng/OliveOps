import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const pricingSource = readFileSync('src/components/budget/BudgetPricingAnalysis.tsx', 'utf8');

const budget = {
  id: 'budget-2027', targetMarginPct: 20,
};
const divisions = [{ id: 'hardscape', budgetId: budget.id, name: 'Hardscaping', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 50, equipmentPercent: 30, materialsPercent: 20, subcontractorsPercent: 0 } } }];
const planningItems = [
  { id: 'ryan', budgetId: budget.id, divisionId: 'hardscape', category: 'labour', employeeId: 'employee-ryan', name: 'Ryan', compType: 'hourly', hourlyRate: 30, plannedHours: 2000, expectedBillablePct: 80, payrollBurdenPct: 20, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 2000 }] },
  { id: 'bobcat', budgetId: budget.id, divisionId: 'hardscape', category: 'equipment', equipmentId: 'equipment-bobcat', name: 'Bobcat E50', plannedAmount: 52000, sellableHoursPerYear: 1200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12, sellableHours: 1200 }] },
  { id: 'gravel', budgetId: budget.id, divisionId: 'hardscape', category: 'materials', materialCatalogItemId: 'material-gravel', name: 'A Gravel', unit: 'tonne', unitCost: 28, plannedQuantity: 100 },
  { id: 'concrete', budgetId: budget.id, divisionId: 'hardscape', category: 'subcontractors', name: 'Concrete Co', unit: 'hr', rate: 100, plannedQuantity: 50 },
  { id: 'shared-overhead', budgetId: budget.id, divisionId: 'hardscape', category: 'overhead', name: 'Office', plannedAmount: 100000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 100 }] },
];

test('Budget Analysis creates one Average Labour row and resolves its Division approval', () => {
  const rows = buildBudgetPricingRows({
    budget,
    divisions,
    planningItems,
    budgetRates: [{ id: 'rate-average-labour', budgetId: budget.id, budgetItemId: 'average-labour:hardscape', divisionId: 'hardscape', pricingVersion: 2, category: 'labour', defaultSellPrice: 80 }],
  });

  assert.equal(rows.length, 4);
  assert.equal(rows.some((row) => row.item.employeeId), false);
  const labour = rows.find((row) => row.item.id === 'average-labour:hardscape');
  assert.equal(labour.item.name, 'Average Labour');
  assert.equal(labour.costRate, 45);
  assert.equal(labour.billableHours, 1600);
  assert.equal(labour.overheadPerUnit, 31.25);
  assert.equal(labour.recommendedRate, 95.3125);
  assert.equal(labour.calculatedRate, 95.3125);
  assert.equal(labour.pricingAvailable, true);
  assert.equal(labour.approvedRate, 80);
  assert.equal(labour.pricingStatus, 'approved');

  const equipment = rows.find((row) => row.item.id === 'bobcat');
  assert.ok(Math.abs(equipment.costRate - 43.3333333333) < 0.000001);
  assert.equal(equipment.overheadPerUnit, 25);
  assert.ok(Math.abs(equipment.recommendedRate - 85.4166666667) < 0.000001);
});

test('Average Labour is weighted by allocated billable hours and excludes overhead employees', () => {
  const twoDivisions = [
    divisions[0],
    { id: 'snow', budgetId: budget.id, name: 'Snow', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } },
  ];
  const items = [
    { id: 'senior', budgetId: budget.id, category: 'labour', name: 'Senior', compType: 'hourly', hourlyRate: 40, plannedHours: 1000, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 750 }, { divisionId: 'snow', hours: 250 }] },
    { id: 'junior', budgetId: budget.id, category: 'labour', name: 'Junior', compType: 'hourly', hourlyRate: 20, plannedHours: 3000, expectedBillablePct: 50, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 1500 }, { divisionId: 'snow', hours: 1500 }] },
    { id: 'manager', budgetId: budget.id, category: 'labour', name: 'Manager', compType: 'salaried', annualSalary: 60000, plannedHours: 2000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', hours: 1000 }, { divisionId: 'snow', hours: 1000 }] },
    { id: 'office', budgetId: budget.id, category: 'overhead', plannedAmount: 20000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 50 }, { divisionId: 'snow', percentage: 50 }] },
    { id: 'loader', budgetId: budget.id, category: 'equipment', equipmentId: 'loader', name: 'Loader', plannedAmount: 48000, sellableHoursPerYear: 1200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 6, sellableHours: 600 }, { divisionId: 'snow', months: 6, sellableHours: 600 }] },
  ];
  const rows = buildBudgetPricingRows({ budget, divisions: twoDivisions, planningItems: items, budgetRates: [] });
  const hardscape = rows.find((row) => row.item.id === 'average-labour:hardscape');
  assert.equal(rows.filter((row) => row.aggregateLabour).length, 2);
  assert.equal(rows.some((row) => ['senior', 'junior', 'manager'].includes(row.item.id)), false);
  assert.equal(hardscape.billableHours, 1500);
  assert.equal(hardscape.annualCost, 60000);
  assert.equal(hardscape.costRate, 40);
  assert.equal(hardscape.contributors.length, 2);
  assert.equal(hardscape.overheadPool, 20000);
  assert.ok(Math.abs(hardscape.overheadPerUnit - (20000 / 1500)) < 0.000001);
  assert.equal(rows.filter((row) => row.item.id === 'loader').length, 2);
});

test('Average Labour remains unavailable with zero planned billable hours', () => {
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [{ id: 'manager', budgetId: budget.id, category: 'labour', compType: 'salaried', annualSalary: 60000, plannedHours: 2000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', hours: 2000 }] }], budgetRates: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].billableHours, 0);
  assert.equal(rows[0].costRate, 0);
  assert.equal(rows[0].recommendedRate, 0);
  assert.equal(rows[0].pricingAvailable, false);
  assert.equal(rows[0].pricingStatus, 'unavailable');
});

test('Budget Analysis leaves recommendations unavailable when pricing units are missing', () => {
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [{ id: 'idle', budgetId: budget.id, divisionId: 'hardscape', category: 'equipment', equipmentId: 'idle', name: 'Idle Equipment', plannedAmount: 10000, sellableHoursPerYear: 0 }], budgetRates: [] });
  assert.equal(rows[0].costRate, 0);
  assert.equal(rows[0].recommendedRate, 0);
  assert.equal(rows[0].pricingStatus, 'unavailable');
});

test('Pricing uses four client-side tabs and defaults to Labour', () => {
  assert.match(pricingSource, /type PricingTab = 'labour' \| 'equipment' \| 'materials' \| 'subcontractors'/);
  assert.match(pricingSource, /useState<PricingTab>\('labour'\)/);
  assert.match(pricingSource, /role="tablist" aria-label="Pricing category"/);
  assert.match(pricingSource, /role="tab" aria-selected=\{activePricingTab === tab\.key\}/);
  assert.match(pricingSource, /onClick=\{\(\) => setActivePricingTab\(tab\.key\)\}/);
  assert.match(pricingSource, /const activeRows = rows\.filter\(\(row\) => row\.type === activeTab\.rowType\)/);
  for (const label of ['Labour', 'Equipment', 'Materials', 'Subcontractors']) assert.match(pricingSource, new RegExp(`label: '${label}'`));
});

test('Pricing uses contractor-facing labels and renders no approval workflow', () => {
  for (const label of ['Labour Cost', 'Labour Rate', 'Equipment Cost', 'Equipment Rate', 'Material Cost', 'Material Rate', 'Subcontractor Cost', 'Subcontractor Rate']) assert.match(pricingSource, new RegExp(label));
  assert.match(pricingSource, />Target Net Profit</);
  assert.match(pricingSource, />Pricing<\/h2>/);
  assert.match(pricingSource, /Review Budget-calculated rates by Division/);
  for (const removed of ['Approved Rate', 'Saved ✓', 'Custom rate', 'Not approved', 'Using recommended rate', 'addBudgetRate', 'updateBudgetRate']) assert.doesNotMatch(pricingSource, new RegExp(removed));
});

test('overhead and final rates disclose actual source values and margin formula', () => {
  for (const label of ['Labour Overhead Pool', 'Billable Labour Hours', 'Equipment Recovery Pool', 'Annual Equipment Cost', 'Material Recovery Pool', 'Annual Material Cost', 'Subcontractor Recovery Pool', 'Annual Subcontractor Cost']) assert.match(pricingSource, new RegExp(label));
  assert.match(pricingSource, /row\.overheadPool/);
  assert.match(pricingSource, /row\.recoveryDenominator/);
  assert.match(pricingSource, /row\.recoveryRate/);
  assert.match(pricingSource, /Division Overhead:/);
  assert.match(pricingSource, /Allocation:/);
  assert.match(pricingSource, /Overhead Recovery:/);
  assert.match(pricingSource, /Breakeven Rate:/);
  assert.match(pricingSource, /Cost After OH Recovery:/);
  assert.match(pricingSource, /÷ \(1 - \{formatTargetMarginPercent\(row\.targetMarginPct\)\}\)/);
  assert.doesNotMatch(pricingSource, /targetMarginPct\.toFixed\(0\)/);
  assert.match(pricingSource, /× \(1 \+ \{\(\(row\.recoveryRate \?\? 0\) \* 100\)\.toFixed\(2\)\}%\)/);
  assert.doesNotMatch(pricingSource, /\* 1\.2|× 1\.20/);
});

test('materials and subcontractors use Division planned-cost recovery bases', () => {
  const scopedBudget = { id: 'cost-recovery', targetMarginPct: 20 };
  const scopedDivisions = [{ id: 'division', budgetId: scopedBudget.id, name: 'Division', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 0, equipmentPercent: 0, materialsPercent: 60, subcontractorsPercent: 40 } } }];
  const scopedItems = [
    { id: 'material', budgetId: scopedBudget.id, divisionId: 'division', category: 'materials', name: 'Stone', unit: 'tonne', unitCost: 10, plannedQuantity: 200 },
    { id: 'sub', budgetId: scopedBudget.id, divisionId: 'division', category: 'subcontractors', name: 'Hauling', unit: 'hr', rate: 100, plannedQuantity: 5 },
    { id: 'overhead', budgetId: scopedBudget.id, category: 'overhead', plannedAmount: 10000, overheadDivisionAllocations: [{ divisionId: 'division', percentage: 100 }] },
  ];
  const rows = buildBudgetPricingRows({ budget: scopedBudget, divisions: scopedDivisions, planningItems: scopedItems, budgetRates: [] });
  const material = rows.find((row) => row.item.id === 'material');
  const subcontractor = rows.find((row) => row.item.id === 'sub');
  assert.deepEqual([material.overheadPool, material.recoveryDenominator, material.recoveryRate, material.overheadPerUnit], [6000, 2000, 3, 30]);
  assert.deepEqual([subcontractor.overheadPool, subcontractor.recoveryDenominator, subcontractor.recoveryRate, subcontractor.overheadPerUnit], [4000, 500, 8, 800]);
  assert.equal(material.recommendedRate, 50);
  assert.equal(subcontractor.recommendedRate, 1125);
});

test('zero subcontractor allocation safely applies margin with zero overhead recovery', () => {
  const scopedBudget = { id: 'zero-sub-recovery', targetMarginPct: 10 };
  const scopedDivisions = [{ id: 'division', budgetId: scopedBudget.id, name: 'Division', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } }];
  const scopedItems = [
    { id: 'sub', budgetId: scopedBudget.id, divisionId: 'division', category: 'subcontractors', name: 'Hauling', rate: 90, plannedQuantity: 0 },
    { id: 'overhead', budgetId: scopedBudget.id, category: 'overhead', plannedAmount: 10000, overheadDivisionAllocations: [{ divisionId: 'division', percentage: 100 }] },
  ];
  const row = buildBudgetPricingRows({ budget: scopedBudget, divisions: scopedDivisions, planningItems: scopedItems, budgetRates: [] }).find((value) => value.item.id === 'sub');
  assert.equal(row.overheadPool, 0);
  assert.equal(row.recoveryDenominator, 0);
  assert.equal(row.recoveryRate, 0);
  assert.equal(row.recoveryUnavailable, false);
  assert.equal(row.recommendedRate, 100);
  assert.equal(Number.isFinite(row.recommendedRate), true);
});

test('positive recovery pools with missing denominators are unavailable, not zero-overhead pricing', () => {
  const cases = [
    ['labour', { category: 'labour', compType: 'hourly', hourlyRate: 30, plannedHours: 1000, expectedBillablePct: 0, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'division', hours: 1000 }] }],
    ['equipment', { category: 'equipment', plannedAmount: 0, sellableHoursPerYear: 100, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'division', months: 12, sellableHours: 100 }] }],
    ['materials', { category: 'materials', divisionId: 'division', unitCost: 25, plannedQuantity: 0 }],
    ['subcontractors', { category: 'subcontractors', divisionId: 'division', rate: 75, plannedQuantity: 0 }],
  ];
  for (const [category, item] of cases) {
    const missingBudget = { id: `missing-${category}`, targetMarginPct: 20 };
    const division = { id: 'division', budgetId: missingBudget.id, name: 'Division', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: category === 'labour' ? 100 : 0, equipmentPercent: category === 'equipment' ? 100 : 0, materialsPercent: category === 'materials' ? 100 : 0, subcontractorsPercent: category === 'subcontractors' ? 100 : 0 } } };
    const rows = buildBudgetPricingRows({ budget: missingBudget, divisions: [division], planningItems: [{ id: category, budgetId: missingBudget.id, ...item }, { id: 'overhead', budgetId: missingBudget.id, category: 'overhead', plannedAmount: 1000, overheadDivisionAllocations: [{ divisionId: 'division', percentage: 100 }] }], budgetRates: [] });
    const row = rows.find((value) => value.item.id === category || value.aggregateLabour);
    assert.equal(row.recoveryUnavailable, true, category);
    assert.equal(row.recommendedRate, 0, category);
    assert.equal(row.overheadPool, 1000, category);
    assert.equal(row.recoveryDenominator, 0, category);
    assert.equal(Number.isFinite(row.recoveryRate), true, category);
    assert.equal(Number.isFinite(row.recommendedRate), true, category);
  }
  assert.match(pricingSource, /No \{terms\.missing\} is planned/);
  assert.match(pricingSource, /cannot currently be recovered/);
});

test('persisted approved rates remain readable but are not rendered or changed by tabs', () => {
  const persistedRates = [{ id: 'rate-average', budgetId: budget.id, budgetItemId: 'average-labour:hardscape', divisionId: 'hardscape', pricingVersion: 2, category: 'labour', defaultSellPrice: 62.5 }];
  const firstRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: persistedRates });
  const reloadedRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: structuredClone(persistedRates) });

  assert.equal(firstRender.find((row) => row.item.id === 'average-labour:hardscape').approvedRate, 62.5);
  assert.equal(reloadedRender.find((row) => row.item.id === 'average-labour:hardscape').approvedRate, 62.5);
  assert.match(pricingSource, /onClick=\{\(\) => setActivePricingTab\(tab\.key\)\}/);
  assert.doesNotMatch(pricingSource, /defaultSellPrice|approvedRate/);
});
