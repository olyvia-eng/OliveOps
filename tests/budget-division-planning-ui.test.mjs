import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('src/pages/budget/DivisionWorkspacePage.tsx', 'utf8');
const planner = readFileSync('src/components/budget/DivisionPlanningTab.tsx', 'utf8');
const analysis = readFileSync('src/components/budget/BudgetPricingAnalysis.tsx', 'utf8');
const importer = readFileSync('src/components/budget/BudgetPlanImportDialog.tsx', 'utf8');
const budgetPage = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
const store = readFileSync('src/store/index.ts', 'utf8');
const subcontractorCatalog = readFileSync('src/pages/data-center/SubcontractorsCatalogSection.tsx', 'utf8');
const subcontractorFields = readFileSync('src/components/catalog/SubcontractorFormFields.tsx', 'utf8');
const subcontractorFormModel = readFileSync('src/components/catalog/subcontractorFormModel.ts', 'utf8');

test('all four Division planning tabs provide intentional Add and Import empty states', () => {
  assert.match(workspace, /category=\{activeTab\}/);
  assert.match(planner, /No labour planned yet/);
  assert.match(planner, /No equipment planned yet/);
  assert.match(planner, /No materials planned yet/);
  assert.match(planner, /No subcontractors planned yet/);
  assert.match(planner, /Add \{settings\.singular\}/);
  assert.match(planner, /Import from Previous Budget/);
});

test('planning tabs retain Add and Import actions and allow every category to be reordered', () => {
  assert.match(planner, /items\.length === 0[\s\S]*actions[\s\S]*items\.length/);
  assert.match(planner, /draggable=\{canEdit\}/);
  assert.match(planner, />Order<\/th>/);
  assert.match(planner, /onDragStart/);
  assert.match(planner, /reorderBudgetDivisionPlanningItems/);
  assert.match(planner, /category === 'labour' \|\| category === 'equipment'/);
  assert.match(planner, /Move \$\{displayName\} earlier/);
  assert.match(planner, /Move \$\{displayName\} later/);
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
  assert.match(importer, /subcontractorPlannedQuantity\(item\).*subcontractorCostPerUnit\(item\).*Annual Cost.*calculateAnnualSubcontractorCost\(item\)/s);
});

test('successful imports merge authoritative records without refreshing the browser', () => {
  assert.match(store, /importBudgetDivisionPlanningItems/);
  assert.match(store, /payload\.items/);
  assert.match(store, /budgetDivisionPlanningItems:/);
  assert.doesNotMatch(importer, /window\.location|location\.reload/);
});

test('Labour form separates field allocation, billable capacity, overtime, and Division allocation', () => {
  assert.match(planner, /Labour Allocation/);
  assert.match(planner, /Expected Billable %/);
  assert.match(planner, /Field-Producing %/);
  assert.match(planner, /Overhead %/);
  assert.match(planner, /100 - draftLabour\.fieldProducingPct/);
  assert.doesNotMatch(planner, /name="labour-classification"/);
  assert.match(planner, /Planned Overtime Hours \/ Year/);
  assert.match(planner, /Overtime Multiplier/);
  assert.match(planner, /Expected Billable Hours/);
  assert.match(planner, /Direct Cost \/ Billable Hour/);
  assert.match(planner, /Included in overhead pool; no billable charge-out rate/);
  assert.match(planner, /activeDivisions\.map/);
  assert.match(planner, /Allocate Employee Cost Across Divisions/);
  assert.match(planner, /Split Evenly/);
  assert.match(planner, /\?\.hours \?\? 0/);
  assert.match(planner, />hours<\/span>/);
  assert.match(planner, /Current Division/);
  assert.match(planner, /Remaining:/);
  assert.match(planner, /over allocation/);
  assert.match(planner, /!labourAllocationValid \|\| !labourInputsValid/);
});

test('Labour plan table shows only the selected Division share and prevents duplicate employees', () => {
  assert.match(planner, /Annual Cost/);
  assert.match(planner, /directCostPerBillableHour/);
  assert.match(planner, /isLabourAllocatedToDivision\(item, division\.id\)/);
  assert.match(planner, /calculateDivisionLabourShare\(item, division\.id\)/);
  assert.match(planner, /Allocation: \{labourShare\.hours\} hours to \{division\.name\}/);
  assert.match(planner, /Already in Budget/);
  assert.match(planner, /Edit Allocation/);
  assert.match(planner, /overhead pool/);
  assert.doesNotMatch(planner, /OverheadRecoveryEditor/);
  assert.match(analysis, /Overhead Recovery/);
  assert.match(analysis, /<OverheadRecoveryEditor/);
});

test('active Division equipment editor uses the shared wide equipment form and Budget-only allocation', () => {
  const sharedForm = readFileSync('src/components/equipment/EquipmentInfoForm.tsx', 'utf8');
  const equipmentBranch = planner.slice(planner.indexOf("{category === 'equipment' ?"), planner.indexOf("{category === 'materials' ?"));

  assert.match(planner, /EquipmentInfoForm/);
  assert.match(planner, /context="budget"/);
  assert.match(planner, /size=\{category === 'equipment' \? 'large' : 'wide'\}/);
  assert.match(planner, /Allocate Annual Equipment Cost/);
  assert.match(planner, /equipmentDivisionAllocations/);
  assert.match(planner, /isEquipmentAllocatedToDivision\(item, division\.id\)/);
  assert.match(planner, /equipmentMonthsForDivision/);
  assert.match(planner, /annualCost \* equipmentMonthsForDivision\(item, division\.id\)\) \/ 12/);
  assert.match(planner, /saveBudgetEquipmentPlanningItem/);
  assert.doesNotMatch(planner, /await addEquipmentAsset/);
  assert.match(planner, /Add to Budget/);
  assert.match(planner, /Save Equipment/);
  assert.match(sharedForm, /Payment Frequency \(# per year\)/);
  assert.doesNotMatch(equipmentBranch, /label="Annual payment"|label="Utilization hours"|label="Planned amount"/);
  assert.doesNotMatch(sharedForm, /Fuel Price Unit|Fuel Burned per Hour|Months Used Per Year|Budget Sell Rate/);
});

test('equipment allocation renders Division, Months, and Annual Cost without Division Sellable Hours', () => {
  const allocationBranch = planner.slice(planner.indexOf('Allocate Annual Equipment Cost'), planner.indexOf('{equipmentError'));

  assert.match(allocationBranch, /activeDivisions\.map/);
  assert.match(allocationBranch, />Division<\/span>/);
  assert.match(allocationBranch, />Months<\/span>/);
  assert.match(allocationBranch, />Annual Cost<\/span>/);
  assert.doesNotMatch(allocationBranch, /Sellable Hours|sellable equipment hours|equipment-sellable-hours/);
  assert.match(allocationBranch, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(7rem,0\.65fr\)_minmax\(8rem,0\.75fr\)\]/);
  assert.equal((allocationBranch.match(/setEquipmentDivisionMonths\(item\.id/g) ?? []).length, 1);
  assert.match(allocationBranch, /equipmentAllocationTotal} of 12 months allocated/);
  assert.match(allocationBranch, /totalEquipmentCostPerYear \* months\) \/ 12/);
});

test('editing equipment months preserves optional fields from existing allocation records', () => {
  const setter = planner.slice(planner.indexOf('const setEquipmentDivisionMonths'), planner.indexOf('const save = async'));

  assert.match(setter, /const existing = current\.equipmentDivisionAllocations\?\.find/);
  assert.match(setter, /\.\.\.existing/);
  assert.match(setter, /months: item\.id === divisionId \? value : existing\?\.months \?\? 0/);
  assert.doesNotMatch(setter, /sellableHours:/);
});

test('equipment names use one fallback resolver throughout Budget planning displays', () => {
  assert.match(planner, /resolveBudgetEquipmentName\(item, equipmentAssets\)/);
  assert.match(importer, /resolveBudgetEquipmentName\(item, equipmentAssets\)/);
  assert.match(analysis, /resolveBudgetEquipmentName\(row\.item, equipmentAssets\)/);
  assert.match(budgetPage, /resolveBudgetEquipmentName\(item, equipmentAssets\)/);
  assert.match(budgetPage, /resolveBudgetEquipmentName\(b, equipmentAssets\)/);
});

test('multi-Division equipment removal updates allocations without deleting the canonical item', () => {
  assert.match(planner, /removeEquipmentDivisionAllocation\(item, division\.id\)/);
  assert.match(planner, /Remove from this Division/);
  assert.match(planner, /updateBudgetDivisionPlanningItem\(item, \{ equipmentDivisionAllocations: nextAllocations \}\)/);
  assert.match(planner, /This is its only Division allocation/);
  assert.match(planner, /deleteBudgetDivisionPlanningItem\(item\)/);
});

test('linked Budget equipment uses one editable local draft without Catalog rehydration', () => {
  const equipmentValue = planner.slice(planner.indexOf('const equipmentFormValue'), planner.indexOf('const equipmentCostBreakdown'));
  const equipmentForm = planner.slice(planner.indexOf('<EquipmentInfoForm'), planner.indexOf('/>', planner.indexOf('<EquipmentInfoForm')) + 2);

  assert.match(equipmentValue, /description: draft\.name \?\? draft\.description/);
  assert.match(equipmentValue, /costCode: draft\.costCode/);
  assert.match(equipmentValue, /equipmentCostType: draft\.costType/);
  assert.match(equipmentValue, /equipmentClassification: draft\.classification/);
  assert.doesNotMatch(equipmentValue, /linkedEquipment\?\.(name|type|costType|equipmentClassification)/);
  assert.doesNotMatch(equipmentForm, /identityReadOnly/);
});

test('active equipment planning uses the shared annual calculator with legacy field inputs', () => {
  assert.match(planner, /calculateAnnualEquipmentCost/);
  assert.doesNotMatch(planner, /item\.equipmentPayment.*item\.equipmentPaymentFrequencyPerYear/);
  assert.match(planner, /draft\.sellableHoursPerYear \?\? draft\.utilizationHours \?\? 0/);
  assert.match(planner, /plannedAmount: normalized\.equipmentCostType === 'rental' \? normalized\.rentalCost : equipmentCostBreakdown\.totalEquipmentCostPerYear/);
  assert.match(planner, /paymentFrequencyPerYear: undefined/);
  assert.match(planner, /utilizationHours: undefined/);
});

test('subcontractor planning uses assumptions to calculate Annual Cost without an editable amount', () => {
  const branch = planner.slice(planner.indexOf("{category === 'subcontractors' ?"), planner.indexOf("{category === 'overhead' ?", planner.indexOf("{category === 'subcontractors' ?")));

  assert.match(branch, /label="Subcontractor Catalog"/);
  assert.doesNotMatch(branch, /label="Cost per Unit"/);
  assert.match(branch, /label="Planned Quantity"/);
  assert.match(branch, /label="Description"/);
  assert.match(branch, /Calculated Annual Cost/);
  assert.match(branch, /subcontractorAnnualCost/);
  assert.match(branch, /subcontractor\?\.defaultUnitCost \?\? current\.rate/);
  assert.match(branch, /rate: value\.defaultUnitCost/);
  assert.match(planner, /rate: nextDraft\.rate \?\? normalizedSubcontractor\.defaultUnitCost/);
  assert.doesNotMatch(branch, /label="Rate"|label="Planned amount"|label="Planned Amount"/);
  assert.match(planner, /calculateAnnualSubcontractorCost\(item\)/);
  assert.match(planner, /subcontractorPlannedQuantity\(item\).*item\.unit.*subcontractorCostPerUnit\(item\)/s);
  assert.match(planner, /normalizeSubcontractorPlanAssumptions\(nextDraft\)/);
});

test('Catalog and Budget use one canonical Subcontractor form model', () => {
  assert.match(subcontractorCatalog, /SubcontractorFormFields/);
  assert.match(planner, /SubcontractorFormFields/);
  assert.match(subcontractorCatalog, /validateSubcontractorForm/);
  assert.match(planner, /validateSubcontractorForm/);
  for (const label of ['Company Name', 'Trade / Service', 'Contact Name', 'Email', 'Phone', 'Unit', 'Default Cost', 'Notes']) {
    assert.match(subcontractorFields, new RegExp(`label="${label.replace('/', '\\/')}"`));
  }
  assert.match(subcontractorFormModel, /normalizeSubcontractorForm/);
});

test('Material and Subcontractor Budget creation atomically creates or reuses Catalog identity', () => {
  assert.match(planner, /saveBudgetCatalogPlanningItem/);
  assert.match(store, /createCatalogItem/);
  assert.match(planner, /createCatalogItem = category === 'materials' \? !nextDraft\.materialCatalogItemId : !nextDraft\.subcontractorCatalogItemId/);
  assert.match(planner, /Create new material/);
  assert.match(planner, /Create new subcontractor/);
  assert.match(planner, /materialCatalogItemId: event\.target\.value \|\| undefined/);
  assert.match(planner, /subcontractorCatalogItemId: subcontractor\?\.id/);
  assert.match(store, /materialCatalogItems: payload\.materialCatalogItem/);
  assert.match(store, /subcontractorCatalogItems: payload\.subcontractorCatalogItem/);
});

test('Material and Subcontractor removal deletes only the Budget planning item', () => {
  const removeBranch = planner.slice(planner.indexOf('const removeItem'), planner.indexOf('const updateOverheadAllocation'));
  assert.match(removeBranch, /item\.category !== 'equipment'/);
  assert.match(removeBranch, /deleteBudgetDivisionPlanningItem\(item\)/);
  assert.doesNotMatch(removeBranch, /deleteMaterialCatalogItem|deleteSubcontractorCatalogItem/);
});

test('Budget-specific fields are excluded from canonical Catalog payloads', () => {
  const catalogSave = planner.slice(planner.indexOf('saveBudgetCatalogPlanningItem'), planner.indexOf("if (category === 'subcontractors') nextDraft"));
  assert.match(catalogSave, /defaultUnitCost/);
  assert.doesNotMatch(catalogSave, /catalogItem:[\s\S]*plannedQuantity/);
  assert.doesNotMatch(subcontractorFormModel, /plannedQuantity|plannedAmount|overheadRecovery|recommendedSellPrice|customRate/);
});
