import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBillDraftTotals, createCustomBillLine, createEstimateMaterialBillLine, createMaterialBillLine, createSubcontractorBillLine } from '../src/components/jobs/jobBillLineModel.js';

test('Material Catalog selection creates an editable actual-cost snapshot without mutating the Catalog', () => {
  const material = { id: 'material-a', name: 'Interlock Paver', unit: 'sq ft', defaultUnitCost: 4.5, notes: '', createdAt: '', updatedAt: '' };
  const line = createMaterialBillLine(material, 'patio');

  assert.deepEqual(line, { materialCatalogItemId: 'material-a', description: 'Interlock Paver', quantity: 1, unit: 'sq ft', unitCost: 4.5, workAreaId: 'patio' });
  line.quantity = 500;
  line.unitCost = 4.72;
  assert.equal(material.defaultUnitCost, 4.5);
  assert.deepEqual(calculateBillDraftTotals([line], 13), { subtotal: 2360, tax: 306.8, total: 2666.8 });
});

test('custom bill lines remain unlinked and editable', () => {
  const line = createCustomBillLine();
  assert.equal(line.materialCatalogItemId, undefined);
  assert.equal(line.quantity, 1);
  assert.equal(line.unit, 'ea');
});

test('accepted Estimate selection retains exact snapshot lineage and editable actual defaults', () => {
  const line = createEstimateMaterialBillLine({ estimateMaterialSnapshotId: 'estimate-line-a', materialCatalogItemId: 'material-a', description: 'Pavers', remainingQuantity: -5, unit: 'sq ft', estimatedUnitCost: 4.5, workAreaId: 'patio' });
  assert.deepEqual(line, { estimateMaterialSnapshotId: 'estimate-line-a', materialCatalogItemId: 'material-a', description: 'Pavers', quantity: 0, unit: 'sq ft', unitCost: 4.5, workAreaId: 'patio' });
  line.quantity = 20;
  line.unitCost = 4.72;
  assert.equal(calculateBillDraftTotals([line], 0).total, 94.4);
});

test('Subcontractor Catalog selection snapshots default direct cost without changing the Catalog', () => {
  const subcontractor = { id: 'sub-a', name: 'Stoneworks Ltd', trade: 'Masonry', unit: 'day', defaultUnitCost: 900, notes: '', createdAt: '', updatedAt: '' };
  const line = createSubcontractorBillLine(subcontractor);
  line.unitCost = 975;
  assert.deepEqual({ description: line.description, unit: line.unit, originalCost: subcontractor.defaultUnitCost, actualCost: line.unitCost }, { description: 'Masonry', unit: 'day', originalCost: 900, actualCost: 975 });
});
