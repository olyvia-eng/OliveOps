import { randomUUID } from 'node:crypto';
import {
  createAuditEventForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getFileForBusiness,
  getJobForBusiness, getMaterialCatalogItemForBusiness, getSubcontractorCatalogItemForBusiness,
  listEmployeesForBusiness, listEquipmentAssetsForBusiness, listLabourClassesForBusiness,
  listMaterialCatalogItemsForBusiness, listSubcontractorCatalogItemsForBusiness, listTimeCorrectionsForBusiness,
  listTimeEntriesForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { calculateJobBill, calculateJobCostAnalysis } from '../src/utils/jobCostingModel.js';
import { resolveWorkType } from '../src/utils/workTypeModel.js';
import {
  deleteJobCostRecordForBusiness, getJobCostRecordForBusiness, getVendorForBusiness, listJobCostRecordsForBusiness,
  listVendorsForBusiness, putJobCostRecordForBusiness, putVendorForBusiness,
} from './_lib/jobCostRepo.js';

const ROLES = ['owner', 'admin'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(['equipment', 'vendor', 'subcontractor']);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const dateValue = (value, label, optional = false) => {
  const result = text(value);
  if (!result && optional) return undefined;
  if (!DATE_PATTERN.test(result)) throw new Error(`${label} is invalid.`);
  return result;
};

function workAreas(job) {
  return new Set((job.operationalWorkAreas ?? []).map((area) => area.id));
}

function validateWorkArea(job, workAreaId) {
  const id = text(workAreaId);
  if (id && !workAreas(job).has(id)) throw new Error('Work Area must belong to this Job.');
  return id || undefined;
}

function findEstimateMaterial(job, snapshotId) {
  for (const area of job.originalEstimateSnapshot?.workAreas ?? []) {
    for (const [lineIndex, line] of (area.lineItems ?? []).entries()) {
      const id = line.id || `legacy:${area.id}:${lineIndex}`;
      if (id === snapshotId) return line.category === 'material' ? { area, line, id } : null;
    }
  }
  return null;
}

function validateBillDates(body) {
  const invoiceDate = dateValue(body.invoiceDate, 'Invoice date');
  const dueDate = dateValue(body.dueDate, 'Due date', true);
  if (dueDate && dueDate < invoiceDate) throw new Error('Due date cannot be before the invoice date.');
  return { invoiceDate, dueDate };
}

async function validateAttachment(deps, session, fileId, jobId, billId) {
  if (!fileId) return undefined;
  const file = await deps.getFileForBusiness(session.businessId, fileId);
  if (!file || file.uploadStatus !== 'uploaded' || file.entityType !== 'job-cost-bill' || file.entityId !== billId || file.jobId !== jobId) throw new Error('Bill attachment is invalid or incomplete.');
  return file.id;
}

async function audit(deps, session, action, metadata) {
  await deps.createAuditEventForBusiness({ businessId: session.businessId, auditEvent: { id: deps.randomUUID(), action, actorUserId: session.id, actorName: session.name, actorEmail: session.email ?? '', metadata, createdAt: deps.now() } });
}

export function createJobAnalysisHandler(overrides = {}) {
  const deps = {
    requireSession, getJobForBusiness, getEmployeeForBusiness, getEquipmentAssetForBusiness, getMaterialCatalogItemForBusiness,
    getSubcontractorCatalogItemForBusiness, getFileForBusiness, listEmployeesForBusiness, listEquipmentAssetsForBusiness,
    listMaterialCatalogItemsForBusiness, listSubcontractorCatalogItemsForBusiness, listLabourClassesForBusiness,
    listTimeEntriesForBusiness, listTimeCorrectionsForBusiness, listJobCostRecordsForBusiness, getJobCostRecordForBusiness,
    putJobCostRecordForBusiness, deleteJobCostRecordForBusiness, listVendorsForBusiness, getVendorForBusiness,
    putVendorForBusiness, createAuditEventForBusiness, randomUUID, now: () => new Date().toISOString(), ...overrides,
  };
  return async function handler(req, res) {
    const session = await deps.requireSession(req, res, ROLES, 'jobs');
    if (!session) return;
    const jobId = text(req.query?.jobId ?? req.body?.jobId);
    if (!jobId) return res.status(400).json({ ok: false, error: 'Job id is required.' });
    const job = await deps.getJobForBusiness(session.businessId, jobId);
    if (!job || resolveWorkType(job) !== 'project') return res.status(404).json({ ok: false, error: 'Project Job not found.' });
    try {
      if (req.method === 'GET') {
        const scopeWorkAreaId = text(req.query?.scopeWorkAreaId) || 'entire-job';
        if (!['entire-job', 'unallocated'].includes(scopeWorkAreaId)) validateWorkArea(job, scopeWorkAreaId);
        const [records, employees, labourClasses, timeEntries, timeCorrections, vendors, equipment, materials, subcontractors] = await Promise.all([
          deps.listJobCostRecordsForBusiness(session.businessId, job.id), deps.listEmployeesForBusiness(session.businessId),
          deps.listLabourClassesForBusiness(session.businessId), deps.listTimeEntriesForBusiness(session.businessId),
          deps.listTimeCorrectionsForBusiness(session.businessId), deps.listVendorsForBusiness(session.businessId),
          deps.listEquipmentAssetsForBusiness(session.businessId), deps.listMaterialCatalogItemsForBusiness(session.businessId),
          deps.listSubcontractorCatalogItemsForBusiness(session.businessId),
        ]);
        const analysis = calculateJobCostAnalysis({ job, employees, labourClasses, timeEntries, timeCorrections, ...records, scopeWorkAreaId });
        analysis.workAreaBreakdown = (job.operationalWorkAreas ?? []).map((area) => {
          const scoped = calculateJobCostAnalysis({ job, employees, labourClasses, timeEntries, timeCorrections, ...records, scopeWorkAreaId: area.id });
          return { workAreaId: area.id, workAreaName: area.name, estimatedHours: scoped.labour.estimated.hours, actualHours: scoped.labour.actual.hours, estimatedCost: scoped.summary.estimatedTotalCost, actualCost: scoped.summary.actualCostToDate, variance: scoped.summary.remainingEstimatedCost };
        });
        const entireJobAnalysis = scopeWorkAreaId === 'entire-job' ? analysis : calculateJobCostAnalysis({ job, employees, labourClasses, timeEntries, timeCorrections, ...records });
        const estimateMaterials = entireJobAnalysis.materialComparisons.filter((line) => line.estimateMaterialSnapshotId);
        return res.status(200).json({ ok: true, analysis, references: { vendors, equipment, materials, subcontractors, estimateMaterials, workAreas: job.operationalWorkAreas ?? [] } });
      }

      const action = text(req.query?.action ?? req.body?.action);
      if (req.method === 'POST' && action === 'vendor') {
        const name = text(req.body?.name);
        if (!name) return res.status(400).json({ ok: false, error: 'Vendor name is required.' });
        const now = deps.now();
        const vendor = { id: deps.randomUUID(), name, contactName: text(req.body.contactName), email: text(req.body.email), phone: text(req.body.phone), active: true, createdAt: now, updatedAt: now };
        await deps.putVendorForBusiness({ businessId: session.businessId, vendor, create: true });
        await audit(deps, session, 'job_cost.vendor_created', { jobId, vendorId: vendor.id });
        return res.status(201).json({ ok: true, vendor });
      }

      const recordType = text(req.body?.recordType);
      if (!TYPES.has(recordType)) return res.status(400).json({ ok: false, error: 'Job cost record type is invalid.' });
      const id = text(req.body?.id) || deps.randomUUID();
      const existing = text(req.body?.id) ? await deps.getJobCostRecordForBusiness(session.businessId, jobId, recordType, id) : null;
      if (req.method === 'DELETE') {
        if (!existing) return res.status(404).json({ ok: false, error: 'Job cost record not found.' });
        const result = await deps.deleteJobCostRecordForBusiness({ businessId: session.businessId, jobId, type: recordType, id, expectedRevision: Number(req.body.revision) });
        if (!result.ok) return res.status(409).json({ ok: false, error: 'Job cost record changed since it was opened.' });
        await audit(deps, session, 'job_cost.deleted', { jobId, recordType, recordId: id });
        return res.status(200).json({ ok: true });
      }
      if (!['POST', 'PATCH'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed.' });
      if (req.method === 'PATCH' && (!existing || Number(req.body.revision) !== existing.revision)) return res.status(409).json({ ok: false, error: 'Job cost record changed since it was opened.' });
      const now = deps.now();
      let record;
      if (recordType === 'equipment') {
        const equipmentId = text(req.body.equipmentId);
        const equipment = await deps.getEquipmentAssetForBusiness(session.businessId, equipmentId);
        if (!equipment) throw new Error('Equipment must belong to this business.');
        const quantity = Number(req.body.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Equipment hours or quantity must be greater than zero.');
        const unitCostSnapshot = Number(equipment.costRateHourly ?? equipment.hourlyCost);
        if (!Number.isFinite(unitCostSnapshot) || unitCostSnapshot < 0) throw new Error('Equipment cost rate is unavailable.');
        record = { id, jobId, recordType, equipmentId, equipmentNameSnapshot: equipment.name, date: dateValue(req.body.date, 'Usage date'), quantity, unit: text(req.body.unit) || 'hr', unitCostSnapshot, workAreaId: validateWorkArea(job, req.body.workAreaId), notes: text(req.body.notes), cost: Math.round((quantity * unitCostSnapshot + Number.EPSILON) * 100) / 100 };
      } else {
        const dates = validateBillDates(req.body);
        const vendor = recordType === 'vendor' ? await deps.getVendorForBusiness(session.businessId, text(req.body.vendorId)) : null;
        const subcontractor = recordType === 'subcontractor' ? await deps.getSubcontractorCatalogItemForBusiness(session.businessId, text(req.body.subcontractorId)) : null;
        if (recordType === 'vendor' && !vendor) throw new Error('Vendor must belong to this business.');
        if (recordType === 'subcontractor' && !subcontractor) throw new Error('Subcontractor must belong to this business.');
        const lineItems = [];
        for (const line of Array.isArray(req.body.lineItems) ? req.body.lineItems : []) {
          const estimateMaterialSnapshotId = text(line.estimateMaterialSnapshotId) || undefined;
          const materialCatalogItemId = text(line.materialCatalogItemId) || undefined;
          const workAreaId = validateWorkArea(job, line.workAreaId);
          if (estimateMaterialSnapshotId) {
            if (recordType !== 'vendor') throw new Error('Estimate materials can only be added to Vendor Bills.');
            const estimateMaterial = findEstimateMaterial(job, estimateMaterialSnapshotId);
            if (!estimateMaterial) throw new Error('Estimate material must belong to this Job accepted Estimate.');
            if (workAreaId !== estimateMaterial.area.id) throw new Error('Estimate material Work Area must match the accepted Estimate.');
            if (materialCatalogItemId && materialCatalogItemId !== estimateMaterial.line.materialCatalogItemId) throw new Error('Estimate material Catalog reference must match the accepted Estimate.');
          }
          if (materialCatalogItemId && !await deps.getMaterialCatalogItemForBusiness(session.businessId, materialCatalogItemId)) throw new Error('Material must belong to this business.');
          lineItems.push({ id: text(line.id) || deps.randomUUID(), description: text(line.description), estimateMaterialSnapshotId, materialCatalogItemId, quantity: Number(line.quantity), unit: text(line.unit) || 'ea', unitCost: Number(line.unitCost), workAreaId });
        }
        record = calculateJobBill({ id, jobId, recordType, vendorId: vendor?.id, vendorNameSnapshot: vendor?.name, subcontractorId: subcontractor?.id, subcontractorNameSnapshot: subcontractor?.name, invoiceNumber: text(req.body.invoiceNumber), ...dates, description: text(req.body.description), notes: text(req.body.notes), taxRate: Number(req.body.taxRate ?? 0), lineItems }, recordType);
        record.attachmentFileId = await validateAttachment(deps, session, text(req.body.attachmentFileId) || existing?.attachmentFileId, jobId, id);
        record.accountingIntegration = existing?.accountingIntegration;
      }
      record = { ...record, createdByUserId: existing?.createdByUserId ?? session.id, createdAt: existing?.createdAt ?? now, updatedByUserId: session.id, updatedAt: now, revision: (existing?.revision ?? 0) + 1 };
      const result = await deps.putJobCostRecordForBusiness({ businessId: session.businessId, record, expectedRevision: existing?.revision });
      if (!result.ok) return res.status(409).json({ ok: false, error: 'Job cost record changed since it was opened.' });
      await audit(deps, session, existing ? 'job_cost.updated' : 'job_cost.created', { jobId, recordType, recordId: id });
      return res.status(existing ? 200 : 201).json({ ok: true, record });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Job Analysis operation failed.' });
    }
  };
}

export default createJobAnalysisHandler();