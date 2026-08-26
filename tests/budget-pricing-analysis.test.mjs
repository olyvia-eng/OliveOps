import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const pricingSource = readFileSync('src/components/budget/BudgetPricingAnalysis.tsx', 'utf8');

const budget = {
  id: 'budget-2027', targetMarginPct: 20,
};
const divisions = [{ id: 'hardscape', budgetId: budget.id, name: 'Hardscaping', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 50, equipmentPercent: 30, materialsPercent: 20, subcontractorsPercent: 0 } } }];
const labourClasses = [{ id: 'labourer', name: 'Labourer', active: true, customRates: {} }];
const employees = [{ id: 'employee-ryan', name: 'Ryan', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 30, payrollBurdenPct: 20 }];
const planningItems = [
  { id: 'ryan', budgetId: budget.id, divisionId: 'hardscape', category: 'labour', employeeId: 'employee-ryan', name: 'Ryan', compType: 'hourly', hourlyRate: 30, plannedHours: 2000, expectedBillablePct: 80, payrollBurdenPct: 20, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 2000 }] },
  { id: 'bobcat', budgetId: budget.id, divisionId: 'hardscape', category: 'equipment', equipmentId: 'equipment-bobcat', name: 'Bobcat E50', plannedAmount: 52000, sellableHoursPerYear: 1200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 12, sellableHours: 1200 }] },
  { id: 'gravel', budgetId: budget.id, divisionId: 'hardscape', category: 'materials', materialCatalogItemId: 'material-gravel', name: 'A Gravel', unit: 'tonne', unitCost: 28, plannedQuantity: 100 },
  { id: 'concrete', budgetId: budget.id, divisionId: 'hardscape', category: 'subcontractors', name: 'Concrete Co', unit: 'hr', rate: 100, plannedQuantity: 50 },
  { id: 'shared-overhead', budgetId: budget.id, divisionId: 'hardscape', category: 'overhead', name: 'Office', plannedAmount: 100000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 100 }] },
];

test('Budget Analysis creates Labour Class rows without Average or Employee pricing rows', () => {
  const rows = buildBudgetPricingRows({
    budget,
    divisions,
    planningItems,
    budgetRates: [],
    employees,
    labourClasses,
  });

  assert.equal(rows.length, 4);
  const labour = rows.find((row) => row.item.labourClassId === 'labourer');
  assert.equal(labour.item.name, 'Labourer');
  assert.equal(labour.costRate, 45);
  assert.equal(labour.billableHours, 1600);
  assert.equal(labour.overheadPerUnit, 31.25);
  assert.equal(labour.recommendedRate, 95.3125);
  assert.equal(labour.calculatedRate, 95.3125);
  assert.equal(labour.pricingAvailable, true);
  assert.equal(labour.estimateRate, labour.calculatedRate);
  assert.equal(rows.some((row) => row.item.name === 'Average Labour'), false);
  assert.equal(rows.some((row) => row.item.employeeId === 'employee-ryan'), false);

  const equipment = rows.find((row) => row.item.id === 'bobcat');
  assert.ok(Math.abs(equipment.costRate - 43.3333333333) < 0.000001);
  assert.equal(equipment.overheadPerUnit, 25);
  assert.ok(Math.abs(equipment.recommendedRate - 85.4166666667) < 0.000001);
});

test('Labour Class cost is weighted by allocated billable hours and excludes overhead employees', () => {
  const twoDivisions = [
    divisions[0],
    { id: 'snow', budgetId: budget.id, name: 'Snow', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } },
  ];
  const items = [
    { id: 'senior', budgetId: budget.id, category: 'labour', employeeId: 'senior', name: 'Senior', compType: 'hourly', hourlyRate: 40, plannedHours: 1000, expectedBillablePct: 100, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 750 }, { divisionId: 'snow', hours: 250 }] },
    { id: 'junior', budgetId: budget.id, category: 'labour', employeeId: 'junior', name: 'Junior', compType: 'hourly', hourlyRate: 20, plannedHours: 3000, expectedBillablePct: 50, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 1500 }, { divisionId: 'snow', hours: 1500 }] },
    { id: 'manager', budgetId: budget.id, category: 'labour', employeeId: 'manager', name: 'Manager', compType: 'salaried', annualSalary: 60000, plannedHours: 2000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', hours: 1000 }, { divisionId: 'snow', hours: 1000 }] },
    { id: 'office', budgetId: budget.id, category: 'overhead', plannedAmount: 20000, overheadDivisionAllocations: [{ divisionId: 'hardscape', percentage: 50 }, { divisionId: 'snow', percentage: 50 }] },
    { id: 'loader', budgetId: budget.id, category: 'equipment', equipmentId: 'loader', name: 'Loader', plannedAmount: 48000, sellableHoursPerYear: 1200, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'hardscape', months: 6, sellableHours: 600 }, { divisionId: 'snow', months: 6, sellableHours: 600 }] },
  ];
  const classEmployees = [
    { id: 'senior', name: 'Senior', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 40, payrollBurdenPct: 0 },
    { id: 'junior', name: 'Junior', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 20, payrollBurdenPct: 0 },
    { id: 'manager', name: 'Manager', labourClassId: 'labourer', compensationType: 'salary', hourlyRate: 60000, payrollBurdenPct: 0 },
  ];
  const rows = buildBudgetPricingRows({ budget, divisions: twoDivisions, planningItems: items, budgetRates: [], employees: classEmployees, labourClasses });
  const hardscape = rows.find((row) => row.item.labourClassId === 'labourer' && row.divisionId === 'hardscape');
  assert.equal(rows.filter((row) => row.labourClassPricing).length, 2);
  assert.equal(rows.some((row) => ['senior', 'junior', 'manager'].includes(row.item.id)), false);
  assert.equal(hardscape.billableHours, 1500);
  assert.equal(hardscape.annualCost, 60000);
  assert.equal(hardscape.costRate, 40);
  assert.equal(hardscape.contributors.length, 2);
  assert.equal(hardscape.overheadPool, 20000);
  assert.ok(Math.abs(hardscape.overheadPerUnit - (20000 / 1500)) < 0.000001);
  assert.equal(rows.filter((row) => row.item.id === 'loader').length, 2);
});

test('Labour Class pricing is omitted when no productive Employee plan exists', () => {
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [{ id: 'manager', employeeId: 'manager', budgetId: budget.id, category: 'labour', compType: 'salaried', annualSalary: 60000, plannedHours: 2000, labourClassification: 'overhead', divisionAllocations: [{ divisionId: 'hardscape', hours: 2000 }] }], budgetRates: [], employees: [{ id: 'manager', labourClassId: 'labourer' }], labourClasses });
  assert.equal(rows.length, 0);
});

test('Budget Analysis leaves recommendations unavailable when pricing units are missing', () => {
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [{ id: 'idle', budgetId: budget.id, divisionId: 'hardscape', category: 'equipment', equipmentId: 'idle', name: 'Idle Equipment', plannedAmount: 10000, sellableHoursPerYear: 0 }], budgetRates: [] });
  assert.equal(rows[0].costRate, 0);
  assert.equal(rows[0].recommendedRate, 0);
  assert.equal(rows[0].pricingStatus, 'unavailable');
});

test('Pricing uses four client-side tabs and defaults to Labour', () => {
  assert.match(pricingSource, /type PricingTab = ["']labour["'] \| ["']equipment["'] \| ["']materials["'] \| ["']subcontractors["']/);
  assert.match(pricingSource, /useState<PricingTab>\(["']labour["']\)/);
  assert.match(pricingSource, /role="tablist"\s+aria-label="Pricing category"/);
  assert.match(pricingSource, /role="tab"\s+aria-selected=\{activePricingTab === tab\.key\}/);
  assert.match(pricingSource, /onClick=\{\(\) => setActivePricingTab\(tab\.key\)\}/);
  assert.match(pricingSource, /const activeRows = rows\.filter\(\(row\) => row\.type === activeTab\.rowType\)/);
  for (const label of ['Labour', 'Equipment', 'Materials', 'Subcontractors']) assert.match(pricingSource, new RegExp(`label: ["']${label}["']`));
});

test('Pricing uses contractor-facing labels and renders no approval workflow', () => {
  for (const label of ['Labour Cost', 'Equipment Cost', 'Material Cost', 'Subcontractor Cost', 'Overhead Recovery', 'Breakeven', 'Target Profit', 'Profit', 'Calculated', 'Custom', 'Estimate']) assert.match(pricingSource, new RegExp(label));
  assert.doesNotMatch(pricingSource, /Target Net Profit/);
  assert.match(pricingSource, />\s*Pricing\s*<\/h2>/);
  assert.match(pricingSource, /Review Budget-calculated pricing by Division/);
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
  assert.match(pricingSource, /Breakeven:/);
  assert.match(pricingSource, /÷ \(1 -/);
  assert.match(pricingSource, /formatTargetMarginPercent\(row\.targetMarginPct\)/);
  assert.doesNotMatch(pricingSource, /targetMarginPct\.toFixed\(0\)/);
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
    ['equipment', { category: 'equipment', plannedAmount: 0, sellableHoursPerYear: 100, classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'division', months: 12, sellableHours: 100 }] }],
    ['materials', { category: 'materials', divisionId: 'division', unitCost: 25, plannedQuantity: 0 }],
    ['subcontractors', { category: 'subcontractors', divisionId: 'division', rate: 75, plannedQuantity: 0 }],
  ];
  for (const [category, item] of cases) {
    const missingBudget = { id: `missing-${category}`, targetMarginPct: 20 };
    const division = { id: 'division', budgetId: missingBudget.id, name: 'Division', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: category === 'labour' ? 100 : 0, equipmentPercent: category === 'equipment' ? 100 : 0, materialsPercent: category === 'materials' ? 100 : 0, subcontractorsPercent: category === 'subcontractors' ? 100 : 0 } } };
    const rows = buildBudgetPricingRows({ budget: missingBudget, divisions: [division], planningItems: [{ id: category, budgetId: missingBudget.id, ...item }, { id: 'overhead', budgetId: missingBudget.id, category: 'overhead', plannedAmount: 1000, overheadDivisionAllocations: [{ divisionId: 'division', percentage: 100 }] }], budgetRates: [] });
    const row = rows.find((value) => value.item.id === category);
    assert.equal(row.recoveryUnavailable, true, category);
    assert.equal(row.recommendedRate, 0, category);
    assert.equal(row.overheadPool, 1000, category);
    assert.equal(row.recoveryDenominator, 0, category);
    assert.equal(Number.isFinite(row.recoveryRate), true, category);
    assert.equal(Number.isFinite(row.recommendedRate), true, category);
  }
  assert.match(pricingSource, /No \{terms\.missing\} is planned/);
  assert.match(pricingSource, /cannot currently be\s+recovered/);
});

test('persisted Labour Class custom rates remain readable and are not changed by tabs', () => {
  const classesWithCustomRate = [{ ...labourClasses[0], customRates: { hardscape: 62.5 } }];
  const firstRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: [], employees, labourClasses: classesWithCustomRate });
  const reloadedRender = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: [], employees, labourClasses: structuredClone(classesWithCustomRate) });

  assert.equal(firstRender.find((row) => row.item.labourClassId === 'labourer').customRate, 62.5);
  assert.equal(reloadedRender.find((row) => row.item.labourClassId === 'labourer').estimateRate, 62.5);
  assert.match(pricingSource, /onClick=\{\(\) => setActivePricingTab\(tab\.key\)\}/);
  assert.doesNotMatch(pricingSource, /defaultSellPrice|approvedRate/);
});
