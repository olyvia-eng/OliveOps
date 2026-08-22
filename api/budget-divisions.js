import { requireSession } from './_lib/session.js';
import {
  createBudgetDivisionForBusiness,
  deleteBudgetDivisionForBusiness,
  getBudgetDivisionForBusiness,
  getBudgetForBusiness,
  listBudgetDivisionsForBudget,
  updateBudgetDivisionForBusiness,
} from './_lib/authRepo.js';
import { listDivisionPlanningItems } from './_lib/budgetDivisionPlanning.js';

const STATUSES = new Set(['active', 'archived']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateRecoveryPolicy(policy) {
  if (policy === undefined || policy === null) return null;
  if (policy.version !== 2 || !policy.allocation || typeof policy.allocation !== 'object') return 'Overhead recovery policy is invalid.';
  const fields = ['labourPercent', 'equipmentPercent', 'materialsPercent', 'subcontractorsPercent'];
  if (fields.some((field) => typeof policy.allocation[field] !== 'number' || !Number.isFinite(policy.allocation[field]) || policy.allocation[field] < 0 || policy.allocation[field] > 100)) return 'Overhead recovery percentages must be between 0 and 100.';
  const total = fields.reduce((sum, field) => sum + policy.allocation[field], 0);
  return Math.abs(total - 100) < 0.001 ? null : 'Overhead recovery percentages must total 100%.';
}

function validateDivision(division) {
  if (!nonEmptyString(division.id)) return 'Division id is required.';
  if (!nonEmptyString(division.budgetId)) return 'Budget id is required.';
  if (!nonEmptyString(division.name)) return 'Division name is required.';
  if (division.costCode !== undefined && typeof division.costCode !== 'string') return 'Division cost code is invalid.';
  if (division.description !== undefined && typeof division.description !== 'string') return 'Division description is invalid.';
  if (typeof division.revenueTarget !== 'number' || !Number.isFinite(division.revenueTarget) || division.revenueTarget < 0) {
    return 'Revenue target must be zero or greater.';
  }
  if (!STATUSES.has(division.status)) return 'Division status is invalid.';
  if (!Number.isFinite(division.sortOrder) || division.sortOrder < 0) return 'Division sort order is invalid.';
  const recoveryError = validateRecoveryPolicy(division.overheadRecoveryPolicy);
  if (recoveryError) return recoveryError;
  return null;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res, req.method === 'GET' ? undefined : ['owner', 'admin'], 'budget-divisions');
  if (!session) return;

  const budgetId = typeof req.query?.budgetId === 'string' ? req.query.budgetId : req.body?.data?.budgetId;
  if (!nonEmptyString(budgetId)) return res.status(400).json({ ok: false, error: 'Budget id is required.' });

  try {
    const budget = await getBudgetForBusiness(session.businessId, budgetId);
    if (!budget) return res.status(404).json({ ok: false, error: 'Budget not found.' });

    if (req.method === 'GET') {
      const divisionId = typeof req.query?.id === 'string' ? req.query.id : '';
      if (!divisionId) {
        const divisions = await listBudgetDivisionsForBudget(session.businessId, budgetId);
        return res.status(200).json({ ok: true, divisions });
      }
      const division = await getBudgetDivisionForBusiness(session.businessId, budgetId, divisionId);
      return division
        ? res.status(200).json({ ok: true, division })
        : res.status(404).json({ ok: false, error: 'Budget Division not found.' });
    }

    const divisionId = req.method === 'POST' ? req.body?.data?.id : req.query?.id;
    if (!nonEmptyString(divisionId)) return res.status(400).json({ ok: false, error: 'Division id is required.' });

    const existing = req.method === 'POST'
      ? null
      : await getBudgetDivisionForBusiness(session.businessId, budgetId, divisionId);
    if (req.method !== 'POST' && !existing) {
      return res.status(404).json({ ok: false, error: 'Budget Division not found.' });
    }

    if (req.method === 'DELETE') {
      const planningItems = await listDivisionPlanningItems({ businessId: session.businessId, budgetId, divisionId });
      if (planningItems.length > 0) return res.status(409).json({ ok: false, error: 'Archive this Division instead; it has planning items.' });
      await deleteBudgetDivisionForBusiness(session.businessId, budgetId, divisionId);
      return res.status(200).json({ ok: true });
    }

    const now = new Date().toISOString();
    const data = req.body?.data ?? {};
    const division = {
      ...existing,
      ...data,
      id: divisionId,
      budgetId,
      name: typeof data.name === 'string' ? data.name.trim() : existing?.name,
      costCode: typeof data.costCode === 'string' ? data.costCode.trim() : existing?.costCode ?? '',
      description: typeof data.description === 'string' ? data.description.trim() : existing?.description ?? '',
      revenueTarget: data.revenueTarget ?? existing?.revenueTarget ?? 0,
      status: data.status ?? existing?.status ?? 'active',
      sortOrder: data.sortOrder ?? existing?.sortOrder ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const validationError = validateDivision(division);
    if (validationError) return res.status(400).json({ ok: false, error: validationError });

    const siblings = await listBudgetDivisionsForBudget(session.businessId, budgetId);
    const duplicate = siblings.find((item) => item.id !== divisionId && item.name.trim().toLowerCase() === division.name.toLowerCase());
    if (duplicate) return res.status(409).json({ ok: false, error: 'A Division with this name already exists in this Budget.' });

    const persisted = req.method === 'POST'
      ? await createBudgetDivisionForBusiness({ businessId: session.businessId, division })
      : await updateBudgetDivisionForBusiness({ businessId: session.businessId, division });
    return res.status(200).json({ ok: true, division: persisted });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not save Budget Division.' });
  }
}