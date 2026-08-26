import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBudgetLabourPricingDiagnostics, buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';

const pricingSource = readFileSync('src/components/budget/BudgetPricingAnalysis.tsx', 'utf8');
const labourPlannerSource = readFileSync('src/components/budget/DivisionPlanningTab.tsx', 'utf8');

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

test('Snow Removal employee plans group into weighted Labour Class pricing rows', () => {
  const snowBudget = { id: 'budget-snow', targetMarginPct: 20 };
  const snowDivisions = [{ id: 'snow', budgetId: snowBudget.id, name: 'Snow Removal', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 100, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 } } }];
  const snowClasses = [{ id: 'labourer', name: 'Labourer', active: true, customRates: {} }, { id: 'foreman', name: 'Foreman', active: true, customRates: {} }];
  const snowEmployees = [
    { id: 'john', name: 'John Smith', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 20, payrollBurdenPct: 0 },
    { id: 'mike', name: 'Mike White', labourClassId: 'labourer', compensationType: 'hourly', hourlyRate: 40, payrollBurdenPct: 0 },
    { id: 'matt', name: 'Matt Jones', labourClassId: 'foreman', compensationType: 'hourly', hourlyRate: 50, payrollBurdenPct: 0 },
  ];
  const snowPlans = snowEmployees.map((employee) => ({ id: `plan-${employee.id}`, budgetId: snowBudget.id, divisionId: 'snow', category: 'labour', employeeId: employee.id, name: employee.name, compType: 'hourly', plannedHours: 1000, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'snow', hours: 1000 }] }));

  const rows = buildBudgetPricingRows({ budget: snowBudget, divisions: snowDivisions, planningItems: snowPlans, budgetRates: [], employees: snowEmployees, labourClasses: snowClasses });
  const labourRows = rows.filter((row) => row.type === 'labour');

  assert.deepEqual(labourRows.map((row) => [row.item.name, row.divisionName, row.contributors.map((item) => item.name)]), [
    ['Foreman', 'Snow Removal', ['Matt Jones']],
    ['Labourer', 'Snow Removal', ['John Smith', 'Mike White']],
  ]);
  assert.deepEqual(labourRows.map((row) => [row.item.name, row.annualCost, row.billableHours, row.costRate]), [
    ['Foreman', 50000, 800, 62.5],
    ['Labourer', 60000, 1600, 37.5],
  ]);
});

test('planned Employees without active Labour Classes are reported instead of silently discarded', () => {
  const unassignedEmployees = [
    { id: 'john', name: 'John Smith', compensationType: 'hourly', hourlyRate: 20 },
    { id: 'mike', name: 'Mike White', labourClassId: 'missing-class', compensationType: 'hourly', hourlyRate: 30 },
  ];
  const unassignedPlans = unassignedEmployees.map((employee) => ({ id: `plan-${employee.id}`, budgetId: budget.id, category: 'labour', employeeId: employee.id, name: employee.name, compType: 'hourly', plannedHours: 1000, expectedBillablePct: 80, labourClassification: 'billable', divisionAllocations: [{ divisionId: 'hardscape', hours: 1000 }] }));
  const diagnostics = buildBudgetLabourPricingDiagnostics({ budget, divisions, planningItems: unassignedPlans, employees: unassignedEmployees, labourClasses });
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: unassignedPlans, budgetRates: [], employees: unassignedEmployees, labourClasses });

  assert.equal(diagnostics.hasPlannedLabour, true);
  assert.equal(diagnostics.plannedEmployeeCount, 2);
  assert.deepEqual(diagnostics.unassignedEmployees.map((item) => item.employeeName), ['John Smith', 'Mike White']);
  assert.equal(rows.filter((row) => row.type === 'labour').length, 0);
  assert.match(pricingSource, /Labour Classes need setup/);
  assert.match(pricingSource, /aren't.*included in Labour Class pricing/);
  assert.match(pricingSource, /Set Up Labour Classes/);
  assert.match(pricingSource, /Review Employees/);
  assert.match(pricingSource, /returnTo=.*budgets/);
});

test('no Budget labour rows remains distinct from unassigned planned labour', () => {
  const diagnostics = buildBudgetLabourPricingDiagnostics({ budget, divisions, planningItems: [], employees, labourClasses });
  assert.equal(diagnostics.hasPlannedLabour, false);
  assert.equal(diagnostics.plannedEmployeeCount, 0);
  assert.deepEqual(diagnostics.unassignedEmployees, []);
  assert.match(pricingSource, /title=\{`No \$\{activeTab\.label\.toLowerCase\(\)\} planned`\}/);
});

test('Labour pricing excludes plans from another Budget and leaves the Employee-based planner unchanged', () => {
  const foreignPlan = { ...planningItems[0], id: 'foreign-plan', budgetId: 'foreign-budget' };
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [foreignPlan], budgetRates: [], employees, labourClasses });
  const diagnostics = buildBudgetLabourPricingDiagnostics({ budget, divisions, planningItems: [foreignPlan], employees, labourClasses });
  assert.equal(rows.length, 0);
  assert.equal(diagnostics.hasPlannedLabour, false);
  assert.match(labourPlannerSource, /value=\{draft\.employeeId \?\? ''\}/);
  assert.match(labourPlannerSource, /employeeId: event\.target\.value \|\| undefined/);
  assert.match(labourPlannerSource, /Labour Class unassigned/);
  assert.doesNotMatch(labourPlannerSource, /labourClassId:\s*(?:item|employee|draft)/);
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
  for (const label of ['Labour Cost', 'Equipment Cost', 'Material Cost', 'Subcontractor Cost', 'Overhead', 'Net Profit', 'Overhead Recovery', 'Breakeven', 'Target Net Profit', 'Profit', 'Calculated', 'Custom', 'Estimate']) assert.match(pricingSource, new RegExp(label));
  assert.match(pricingSource, />\s*Pricing\s*<\/h2>/);
  assert.match(pricingSource, /Review Budget-calculated pricing by Division/);
  for (const removed of ['Approved Rate', 'Saved ✓', 'Custom rate', 'Not approved', 'Using recommended rate', 'addBudgetRate', 'updateBudgetRate']) assert.doesNotMatch(pricingSource, new RegExp(removed));
});

test('compact Pricing table has six columns and moves the full authoritative breakdown into Calculation', () => {
  assert.equal((pricingSource.match(/<th\b/g) ?? []).length, 6);
  assert.match(pricingSource, /<th[^>]*>\{itemLabel\}<\/th>[\s\S]*>Division<\/th>[\s\S]*>\{costLabel\}<\/th>[\s\S]*>Overhead<\/th>[\s\S]*>Net Profit<\/th>[\s\S]*>Estimate \{valueLabel\}<\/th>/);
  for (const itemLabel of ['Labour Class', 'Equipment', 'Material', 'Subcontractor']) assert.match(pricingSource, new RegExp(`"${itemLabel}"`));
  assert.match(pricingSource, /table-fixed/);
  assert.doesNotMatch(pricingSource, /min-w-\[1180px\]/);
  assert.match(pricingSource, />Calculation<\/span>/);
  assert.match(pricingSource, /Average Labour Cost/);
  assert.match(pricingSource, />Overhead Recovery<\/dt>/);
  for (const field of ['row.costRate', 'row.overheadPerUnit', 'row.recoveredCostPerUnit', 'row.targetMarginPct', 'row.profit', 'row.calculatedRate', 'row.customRate', 'row.estimateRate']) assert.match(pricingSource, new RegExp(field.replace('.', '\\.')));
  assert.match(pricingSource, /formatTargetMarginPercent\(row\.targetMarginPct\)/);
  assert.match(pricingSource, /\$\{formatCurrency\(row\.overheadPerUnit\)\}\/\$\{row\.unit\}/);
  assert.doesNotMatch(pricingSource, /targetMarginPct\.toFixed\(0\)/);
  assert.doesNotMatch(pricingSource, /\* 1\.2|× 1\.20/);
});

test('configured target margin is applied once with margin math and authoritative profit dollars', () => {
  const marginBudget = { id: 'margin-budget', targetMarginPct: 10 };
  const marginDivisions = [{ id: 'division', budgetId: marginBudget.id, name: 'Division', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 0, equipmentPercent: 0, materialsPercent: 100, subcontractorsPercent: 0 } } }];
  const items = [
    { id: 'material', budgetId: marginBudget.id, divisionId: 'division', category: 'materials', name: 'Material', unit: 'unit', unitCost: 25.94, plannedQuantity: 100 },
    { id: 'overhead', budgetId: marginBudget.id, category: 'overhead', plannedAmount: 300, overheadDivisionAllocations: [{ divisionId: 'division', percentage: 100 }] },
  ];
  const row = buildBudgetPricingRows({ budget: marginBudget, divisions: marginDivisions, planningItems: items, budgetRates: [] })[0];
  assert.equal(row.targetMarginPct, 10);
  assert.ok(Math.abs(row.costRate - 25.94) < 0.000001);
  assert.ok(Math.abs(row.overheadPerUnit - 3) < 0.000001);
  assert.ok(Math.abs(row.recoveredCostPerUnit - 28.94) < 0.000001);
  assert.ok(Math.abs(row.calculatedRate - (28.94 / (1 - 0.10))) < 0.000001);
  assert.ok(Math.abs(row.profit - (row.calculatedRate - row.recoveredCostPerUnit)) < 0.000001);
});

test('legacy approved sell price is not an explicit custom rate', () => {
  const legacyRate = { id: 'legacy-rate', budgetId: budget.id, budgetItemId: 'bobcat', equipmentId: 'equipment-bobcat', divisionId: 'hardscape', pricingVersion: 2, category: 'equipment', defaultSellPrice: 32.43 };
  const withoutCustom = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: [legacyRate], employees, labourClasses }).find((row) => row.item.id === 'bobcat');
  const withCustom = buildBudgetPricingRows({ budget, divisions, planningItems, budgetRates: [{ ...legacyRate, customRate: 35 }], employees, labourClasses }).find((row) => row.item.id === 'bobcat');
  assert.equal(withoutCustom.customRate, null);
  assert.equal(withoutCustom.estimateRate, withoutCustom.calculatedRate);
  assert.equal(withCustom.customRate, 35);
  assert.equal(withCustom.estimateRate, 35);
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
  assert.match(pricingSource, /Overhead cannot be recovered without planned/);
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
