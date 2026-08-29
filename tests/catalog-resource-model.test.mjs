import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ddb } from '../api/_lib/db.js';
import {
  createEquipmentAssetForBusiness,
  createSubcontractorCatalogItemForBusiness,
    getEquipmentAssetForBusiness,
  deleteSubcontractorCatalogItemForBusiness,
  getSubcontractorCatalogItemForBusiness,
  listSubcontractorCatalogItemsForBusiness,
  updateSubcontractorCatalogItemForBusiness,
  updateEquipmentAssetForBusiness,
} from '../api/_lib/authRepo.js';
import { buildBudgetPricingRows } from '../src/pages/budget/budgetPricingModel.js';
import { buildEstimatePricingCatalog } from '../api/_lib/estimatePricingCatalog.js';

const key = (pk, sk) => `${pk}|${sk}`;
const installDdb = (t) => {
  const records = new Map();
  const original = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const input = command.input ?? {};
    const type = command.constructor.name;
    if (type === 'PutCommand') { records.set(key(input.Item.PK, input.Item.SK), { ...input.Item }); return {}; }
    if (type === 'GetCommand') return { Item: records.get(key(input.Key.PK, input.Key.SK)) };
    if (type === 'DeleteCommand') { records.delete(key(input.Key.PK, input.Key.SK)); return {}; }
    if (type === 'QueryCommand') return { Items: [...records.values()].filter((item) => item.PK === input.ExpressionAttributeValues[':pk'] && item.SK.startsWith(input.ExpressionAttributeValues[':prefix'])) };
    return original(command);
  };
  t.after(() => { ddb.send = original; });
};

test('Subcontractor Catalog CRUD is tenant scoped and preserves reusable defaults', async (t) => {
  installDdb(t);
  const base = { id: 'concrete-co', name: 'Concrete Co', contactName: 'Pat', email: 'pat@example.com', phone: '555-0100', trade: 'Concrete', unit: 'job', defaultUnitCost: 1200, notes: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  await createSubcontractorCatalogItemForBusiness({ businessId: 'biz-a', subcontractorCatalogItem: base });
  assert.deepEqual((await listSubcontractorCatalogItemsForBusiness('biz-a')).map((item) => item.id), ['concrete-co']);
  assert.deepEqual(await listSubcontractorCatalogItemsForBusiness('biz-b'), []);
  assert.equal(await getSubcontractorCatalogItemForBusiness('biz-b', base.id), null);
  await updateSubcontractorCatalogItemForBusiness({ businessId: 'biz-a', subcontractorCatalogItem: { ...base, defaultUnitCost: 1400 } });
  assert.equal((await getSubcontractorCatalogItemForBusiness('biz-a', base.id)).defaultUnitCost, 1400);
  await deleteSubcontractorCatalogItemForBusiness('biz-a', base.id);
  assert.equal(await getSubcontractorCatalogItemForBusiness('biz-a', base.id), null);
});

test('rental equipment preserves its direct cost unit while legacy equipment remains hourly', () => {
  const budget = { id: 'budget', targetMarginPct: 20 };
  const divisions = [{ id: 'division', budgetId: 'budget', name: 'Division', status: 'active', overheadRecoveryPolicy: { version: 2, allocation: { labourPercent: 0, equipmentPercent: 100, materialsPercent: 0, subcontractorsPercent: 0 } } }];
  const shared = { budgetId: 'budget', divisionId: 'division', category: 'equipment', classification: 'billable', equipmentDivisionAllocations: [{ divisionId: 'division', months: 12 }] };
  const rental = { ...shared, id: 'rental', equipmentId: 'rental', name: 'Mini Excavator', costType: 'rental', rentalCost: 450, rentalUnit: 'day', plannedAmount: 450 };
  const owned = { ...shared, id: 'owned', equipmentId: 'owned', name: 'Skid Steer', costType: 'owned', plannedAmount: 12000, sellableHoursPerYear: 1000 };
  const rows = buildBudgetPricingRows({ budget, divisions, planningItems: [rental, owned], budgetRates: [] });
  assert.deepEqual(rows.map((row) => [row.item.id, row.costRate, row.unit]), [['rental', 450, 'day'], ['owned', 12, 'hr']]);
  const catalog = buildEstimatePricingCatalog({ budget: { ...budget, planningModel: 'divisions_v1' }, divisions, divisionId: 'division', planningItems: [rental, owned], budgetRates: [], equipmentAssets: [{ id: 'rental', equipmentClassification: 'billable' }, { id: 'owned', equipmentClassification: 'billable' }] });
  assert.equal(catalog.equipment.find((item) => item.sourceEntityId === 'rental').unit, 'day');
  assert.equal(catalog.equipment.find((item) => item.sourceEntityId === 'rental').costRate, 450);
});

test('Catalog UI is billable-only and Subcontractors use the shared resource flow', () => {
  const catalog = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
  const planning = readFileSync('src/components/budget/DivisionPlanningTab.tsx', 'utf8');
  assert.match(catalog, /equipmentClassification !== 'overhead'/);
  assert.match(catalog, /<SubcontractorsCatalogSection/);
  assert.match(planning, /subcontractorCatalogItemId/);
  assert.match(planning, /defaultUnitCost/);
  assert.match(planning, /Manual subcontractor/);
});

test('rental equipment cost and unit persist through create, read, and update', async (t) => {
  installDdb(t);
  const asset = { id: 'rental-excavator', name: 'Mini Excavator', type: 'Excavator', status: 'available', costType: 'rental', equipmentClassification: 'billable', serialNumber: '', hourlyCost: 0, rentalCost: 450, rentalUnit: 'day', notes: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  await createEquipmentAssetForBusiness({ businessId: 'biz-a', equipmentAsset: asset });
  assert.deepEqual((({ costType, rentalCost, rentalUnit }) => ({ costType, rentalCost, rentalUnit }))(await getEquipmentAssetForBusiness('biz-a', asset.id)), { costType: 'rental', rentalCost: 450, rentalUnit: 'day' });
  await updateEquipmentAssetForBusiness({ businessId: 'biz-a', equipmentAsset: { ...asset, rentalCost: 1700, rentalUnit: 'week' } });
  const updated = await getEquipmentAssetForBusiness('biz-a', asset.id);
  assert.deepEqual([updated.rentalCost, updated.rentalUnit], [1700, 'week']);
});