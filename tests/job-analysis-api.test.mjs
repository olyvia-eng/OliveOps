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