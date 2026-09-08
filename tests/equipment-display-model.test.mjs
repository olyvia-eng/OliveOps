import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBudgetEquipmentName } from '../src/utils/equipmentDisplayModel.js';

test('catalog-linked equipment resolves its tenant-scoped catalog name', () => {
  assert.equal(resolveBudgetEquipmentName(
    { equipmentId: 'asset-a' },
    [{ id: 'asset-a', name: 'CAT 259D' }],
  ), 'CAT 259D');
});

test('Budget-created and imported equipment retain their saved display names', () => {
  assert.equal(resolveBudgetEquipmentName({ equipmentId: 'asset-a', description: 'Budget Loader' }, [{ id: 'asset-a', name: 'Renamed Loader' }]), 'Budget Loader');
  assert.equal(resolveBudgetEquipmentName({ equipmentId: 'asset-a', name: 'Imported Loader' }, [{ id: 'asset-a', name: 'Catalog Loader' }]), 'Imported Loader');
});

test('legacy equipment without a resolvable name uses a clear fallback', () => {
  assert.equal(resolveBudgetEquipmentName({ equipmentId: 'missing-asset' }, []), 'Unnamed equipment');
  assert.equal(resolveBudgetEquipmentName({}, []), 'Unnamed equipment');
});

test('an unrelated catalog asset cannot resolve another equipment id', () => {
  assert.equal(resolveBudgetEquipmentName(
    { equipmentId: 'foreign-asset' },
    [{ id: 'tenant-asset', name: 'Tenant Equipment' }],
  ), 'Unnamed equipment');
});