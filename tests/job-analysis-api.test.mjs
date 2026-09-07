import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobAnalysisHandler } from '../api/job-analysis.js';

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const job = { id: 'job-a', workType: 'project', operationalWorkAreas: [{ id: 'area-a', name: 'Front', lineItems: [] }], originalEstimateSnapshot: { subtotal: 1000, workAreas: [] } };
const baseDeps = (overrides = {}) => ({
  requireSession: async () => ({ id: 'user-a', name: 'Admin', businessId: 'biz-a', role: 'admin' }),
  getJobForBusiness: async (businessId, id) => businessId === 'biz-a' && id === 'job-a' ? job : null,
  listJobCostRecordsForBusiness: async () => ({ equipmentUsage: [], vendorBills: [], subcontractorBills: [] }),
  listEmployeesForBusiness: async () => [], listLabourClassesForBusiness: async () => [], listTimeEntriesForBusiness: async () => [], listTimeCorrectionsForBusiness: async () => [],
  listVendorsForBusiness: async () => [], listEquipmentAssetsForBusiness: async () => [], listMaterialCatalogItemsForBusiness: async () => [], listSubcontractorCatalogItemsForBusiness: async () => [],
  createAuditEventForBusiness: async () => ({ ok: true }), randomUUID: () => 'new-id', now: () => '2026-09-01T00:00:00.000Z',
  ...overrides,
});

test('Job Analysis read loads every source through the authenticated tenant', async () => {
  const businesses = [];
  const tenantList = async (businessId) => { businesses.push(businessId); return []; };
  const handler = createJobAnalysisHandler(baseDeps({ listEmployeesForBusiness: tenantList, listLabourClassesForBusiness: tenantList, listTimeEntriesForBusiness: tenantList, listTimeCorrectionsForBusiness: tenantList, listVendorsForBusiness: tenantList, listEquipmentAssetsForBusiness: tenantList, listMaterialCatalogItemsForBusiness: tenantList, listSubcontractorCatalogItemsForBusiness: tenantList }));
  const res = response(); await handler({ method: 'GET', query: { jobId: 'job-a' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.analysis.summary.actualCostToDate, 0); assert.equal(res.body.analysis.workAreaBreakdown[0].workAreaName, 'Front'); assert.deepEqual([...new Set(businesses)], ['biz-a']);
  const foreign = response(); await handler({ method: 'GET', query: { jobId: 'foreign' } }, foreign); assert.equal(foreign.statusCode, 404);
});

test('Vendor Bill ignores client totals and validates Work Area and vendor ownership', async () => {
  let saved;
  const handler = createJobAnalysisHandler(baseDeps({
    getVendorForBusiness: async (businessId, id) => businessId === 'biz-a' && id === 'vendor-a' ? { id, name: 'Supply Co' } : null,
    getMaterialCatalogItemForBusiness: async () => null, getFileForBusiness: async () => null,
    getJobCostRecordForBusiness: async () => null,
    putJobCostRecordForBusiness: async (input) => { saved = input.record; return { ok: true }; },
  }));
  const res = response(); await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'vendor', vendorId: 'vendor-a', invoiceDate: '2026-09-01', subtotal: 1, total: 1, taxRate: 10, lineItems: [{ description: 'Stone', quantity: 2, unitCost: 25, workAreaId: 'area-a' }] } }, res);
  assert.equal(res.statusCode, 201); assert.equal(saved.subtotal, 50); assert.equal(saved.total, 55); assert.equal(saved.vendorNameSnapshot, 'Supply Co'); assert.equal(saved.revision, 1);
  const wrongArea = response(); await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'vendor', vendorId: 'vendor-a', invoiceDate: '2026-09-01', lineItems: [{ quantity: 1, unitCost: 1, workAreaId: 'foreign-area' }] } }, wrongArea); assert.equal(wrongArea.statusCode, 400); assert.match(wrongArea.body.error, /Work Area/);
  const foreignVendor = response(); await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'vendor', vendorId: 'foreign', invoiceDate: '2026-09-01', lineItems: [{ quantity: 1, unitCost: 1 }] } }, foreignVendor); assert.equal(foreignVendor.statusCode, 400);
});

test('Vendor Bill retains tenant Material identity and snapshots an editable actual invoice cost', async () => {
  let saved;
  const catalogMaterial = { id: 'material-a', name: 'Interlock Paver', unit: 'sq ft', defaultUnitCost: 4.5 };
  const handler = createJobAnalysisHandler(baseDeps({
    getVendorForBusiness: async () => ({ id: 'vendor-a', name: 'Supply Co' }),
    getMaterialCatalogItemForBusiness: async (businessId, id) => businessId === 'biz-a' && id === catalogMaterial.id ? catalogMaterial : null,
    getFileForBusiness: async () => null,
    getJobCostRecordForBusiness: async () => null,
    putJobCostRecordForBusiness: async (input) => { saved = input.record; return { ok: true }; },
  }));
  const res = response();
  await handler({ method: 'POST', query: { jobId: 'job-a' }, body: {
    recordType: 'vendor', vendorId: 'vendor-a', invoiceDate: '2026-09-01', taxRate: 13,
    subtotal: 1, taxAmount: 1, total: 1,
    lineItems: [{ materialCatalogItemId: 'material-a', description: 'Interlock Paver', quantity: 500, unit: 'sq ft', unitCost: 4.72, lineTotal: 1, workAreaId: 'area-a' }],
  } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(saved.lineItems[0].materialCatalogItemId, 'material-a');
  assert.equal(saved.lineItems[0].description, 'Interlock Paver');
  assert.equal(saved.lineItems[0].unit, 'sq ft');
  assert.equal(saved.lineItems[0].unitCost, 4.72);
  assert.equal(saved.lineItems[0].lineTotal, 2360);
  assert.equal(saved.subtotal, 2360);
  assert.equal(saved.taxAmount, 306.8);
  assert.equal(saved.total, 2666.8);
  assert.equal(catalogMaterial.defaultUnitCost, 4.5);
});

test('Vendor Bill rejects Material Catalog IDs outside the authenticated business', async () => {
  let saveCount = 0;
  const handler = createJobAnalysisHandler(baseDeps({
    getVendorForBusiness: async () => ({ id: 'vendor-a', name: 'Supply Co' }),
    getMaterialCatalogItemForBusiness: async () => null,
    getJobCostRecordForBusiness: async () => null,
    putJobCostRecordForBusiness: async () => { saveCount += 1; return { ok: true }; },
  }));
  const res = response();
  await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'vendor', vendorId: 'vendor-a', invoiceDate: '2026-09-01', lineItems: [{ materialCatalogItemId: 'material-foreign', description: 'Foreign material', quantity: 1, unitCost: 10 }] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Material must belong to this business.');
  assert.equal(saveCount, 0);
});

test('existing ad-hoc Vendor Bill lines remain editable without a Catalog ID', async () => {
  let saved;
  const existing = { id: 'bill-a', jobId: 'job-a', recordType: 'vendor', vendorId: 'vendor-a', revision: 2, createdAt: '2026-08-01T00:00:00.000Z', createdByUserId: 'user-a' };
  const handler = createJobAnalysisHandler(baseDeps({
    getVendorForBusiness: async () => ({ id: 'vendor-a', name: 'Supply Co' }),
    getMaterialCatalogItemForBusiness: async () => null,
    getJobCostRecordForBusiness: async () => existing,
    getFileForBusiness: async () => null,
    putJobCostRecordForBusiness: async (input) => { saved = input.record; return { ok: true }; },
  }));
  const res = response();
  await handler({ method: 'PATCH', query: { jobId: 'job-a' }, body: { id: 'bill-a', revision: 2, recordType: 'vendor', vendorId: 'vendor-a', invoiceDate: '2026-09-01', lineItems: [{ description: 'Miscellaneous fasteners', quantity: 2, unit: 'box', unitCost: 12.5 }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.lineItems[0].materialCatalogItemId, undefined);
  assert.equal(saved.lineItems[0].lineTotal, 25);
  assert.equal(saved.revision, 3);
});

test('Subcontractor Bill snapshots editable actual cost from a tenant Catalog selection', async () => {
  let saved;
  const catalogSubcontractor = { id: 'sub-a', name: 'Stoneworks Ltd', unit: 'day', defaultUnitCost: 900 };
  const handler = createJobAnalysisHandler(baseDeps({
    getSubcontractorCatalogItemForBusiness: async (businessId, id) => businessId === 'biz-a' && id === catalogSubcontractor.id ? catalogSubcontractor : null,
    getMaterialCatalogItemForBusiness: async () => null,
    getFileForBusiness: async () => null,
    getJobCostRecordForBusiness: async () => null,
    putJobCostRecordForBusiness: async (input) => { saved = input.record; return { ok: true }; },
  }));
  const res = response();
  await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'subcontractor', subcontractorId: 'sub-a', invoiceDate: '2026-09-01', lineItems: [{ description: 'Masonry', quantity: 2, unit: 'day', unitCost: 975 }] } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(saved.subcontractorId, 'sub-a');
  assert.equal(saved.subcontractorNameSnapshot, 'Stoneworks Ltd');
  assert.equal(saved.lineItems[0].unitCost, 975);
  assert.equal(saved.total, 1950);
  assert.equal(catalogSubcontractor.defaultUnitCost, 900);

  const foreign = response();
  await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'subcontractor', subcontractorId: 'sub-foreign', invoiceDate: '2026-09-01', lineItems: [{ quantity: 1, unitCost: 1 }] } }, foreign);
  assert.equal(foreign.statusCode, 400);
  assert.equal(foreign.body.error, 'Subcontractor must belong to this business.');
});

test('equipment cost is derived from the asset rate and stale edits/deletes conflict', async () => {
  let saved;
  const handler = createJobAnalysisHandler(baseDeps({
    getEquipmentAssetForBusiness: async () => ({ id: 'equipment-a', name: 'Excavator', costRateHourly: 42 }),
    getJobCostRecordForBusiness: async (_businessId, _jobId, _type, id) => id === 'existing' ? { id, jobId: 'job-a', recordType: 'equipment', revision: 3 } : null,
    putJobCostRecordForBusiness: async (input) => { saved = input.record; return input.expectedRevision === 2 ? { ok: false, conflict: true } : { ok: true }; },
    deleteJobCostRecordForBusiness: async () => ({ ok: false, conflict: true }),
  }));
  const create = response(); await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'equipment', equipmentId: 'equipment-a', date: '2026-09-01', quantity: 2, cost: 1 } }, create);
  assert.equal(create.statusCode, 201); assert.equal(saved.unitCostSnapshot, 42); assert.equal(saved.cost, 84);
  const staleEdit = response(); await handler({ method: 'PATCH', query: { jobId: 'job-a' }, body: { id: 'existing', revision: 2, recordType: 'equipment' } }, staleEdit); assert.equal(staleEdit.statusCode, 409);
  const staleDelete = response(); await handler({ method: 'DELETE', query: { jobId: 'job-a' }, body: { id: 'existing', revision: 3, recordType: 'equipment' } }, staleDelete); assert.equal(staleDelete.statusCode, 409);
});

test('Bill attachments must be uploaded and linked to the same bill and Job', async () => {
  const handler = createJobAnalysisHandler(baseDeps({
    getVendorForBusiness: async () => ({ id: 'vendor-a' }), getMaterialCatalogItemForBusiness: async () => null,
    getJobCostRecordForBusiness: async () => null, putJobCostRecordForBusiness: async () => ({ ok: true }),
    getFileForBusiness: async () => ({ id: 'file-a', uploadStatus: 'uploaded', entityType: 'job-cost-bill', entityId: 'other-bill', jobId: 'job-a' }),
  }));
  const res = response(); await handler({ method: 'POST', query: { jobId: 'job-a' }, body: { recordType: 'vendor', vendorId: 'vendor-a', invoiceDate: '2026-09-01', attachmentFileId: 'file-a', lineItems: [{ quantity: 1, unitCost: 10 }] } }, res);
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /attachment/);
});