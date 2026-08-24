import {
  approveTimeOffRequestForBusiness,
  cancelTimeOffRequestForBusiness,
  createTimeOffRequestForBusiness,
  denyTimeOffRequestForBusiness,
  generateId,
  getTimeOffCreationIdempotency,
  getTimeOffRequestForBusiness,
  listEmployeesForBusiness,
  listApprovedTimeOffOverlappingForBusiness,
  listTimeOffRequestsForBusiness,
  listUsersForBusiness,
} from './authRepo.js';
import { requireSession } from './session.js';
import {
  dateRangesOverlap,
  isCalendarDate,
  normalizeTimeOffCreationInput,
  safeEmployeeTimeOffRequest,
  timeOffPayloadFingerprint,
  validateTimeOffCreationInput,
} from './timeOff.js';

const nowIso = () => new Date().toISOString();
const isOwnerOrAdmin = (session) => session.role === 'owner' || session.role === 'admin';

function resolveActiveSessionEmployee(session, employees) {
  return employees.find((employee) => employee.active && employee.userId === session.id)
    ?? employees.find((employee) => employee.active && employee.id === session.employeeId)
    ?? null;
}

function adminResponse(request, employees, users) {
  const employee = employees.find((item) => item.id === request.employeeId);
  const reviewer = users.find((item) => item.id === request.reviewedByUserId);
  return {
    ...request,
    employeeName: employee?.name ?? 'Unknown employee',
    reviewedByName: reviewer?.name ?? undefined,
  };
}

export function createTimeOffHandler(overrides = {}) {
  const deps = {
    requireSession,
    listEmployeesForBusiness,
    listUsersForBusiness,
    listTimeOffRequestsForBusiness,
    listApprovedTimeOffOverlappingForBusiness,
    getTimeOffRequestForBusiness,
    getTimeOffCreationIdempotency,
    createTimeOffRequestForBusiness,
    cancelTimeOffRequestForBusiness,
    approveTimeOffRequestForBusiness,
    denyTimeOffRequestForBusiness,
    generateId,
    now: nowIso,
    ...overrides,
  };

  return async function handler(req, res) {
    const session = await deps.requireSession(req, res, ['owner', 'admin', 'foreman', 'crew_member']);
    if (!session) return;
    const action = typeof req.query?.action === 'string' ? req.query.action : '';

    if (req.method === 'POST' && action === 'create') {
      const employees = await deps.listEmployeesForBusiness(session.businessId);
      const employee = resolveActiveSessionEmployee(session, employees);
      if (!employee) return res.status(404).json({ ok: false, error: 'Active employee profile not found.' });
      const input = normalizeTimeOffCreationInput(req.body ?? {});
      const validationError = validateTimeOffCreationInput(input);
      if (validationError) return res.status(400).json({ ok: false, error: validationError });
      const fingerprint = timeOffPayloadFingerprint(input);
      const existingIdempotency = await deps.getTimeOffCreationIdempotency({ businessId: session.businessId, employeeId: employee.id, idempotencyKey: input.idempotencyKey });
      if (existingIdempotency) {
        if (existingIdempotency.payloadFingerprint !== fingerprint) return res.status(409).json({ ok: false, error: 'time_off_idempotency_conflict' });
        const existing = await deps.getTimeOffRequestForBusiness(session.businessId, existingIdempotency.requestId);
        return res.status(200).json({ ok: true, request: safeEmployeeTimeOffRequest(existing), replayed: true });
      }
      const submittedAt = deps.now();
      const request = { id: deps.generateId(), businessId: session.businessId, employeeId: employee.id, ...input, status: 'pending', submittedAt, createdAt: submittedAt, updatedAt: submittedAt };
      const created = await deps.createTimeOffRequestForBusiness({ businessId: session.businessId, request, payloadFingerprint: fingerprint, actor: session });
      if (!created.ok) {
        const winner = await deps.getTimeOffCreationIdempotency({ businessId: session.businessId, employeeId: employee.id, idempotencyKey: input.idempotencyKey });
        if (winner?.payloadFingerprint === fingerprint) {
          const existing = await deps.getTimeOffRequestForBusiness(session.businessId, winner.requestId);
          return res.status(200).json({ ok: true, request: safeEmployeeTimeOffRequest(existing), replayed: true });
        }
        return res.status(409).json({ ok: false, error: 'time_off_idempotency_conflict' });
      }
      const all = await deps.listTimeOffRequestsForBusiness(session.businessId);
      const overlaps = all.filter((item) => item.id !== request.id && item.employeeId === employee.id && ['pending', 'approved'].includes(item.status) && dateRangesOverlap(item.startDate, item.endDate, request.startDate, request.endDate));
      return res.status(201).json({ ok: true, request: safeEmployeeTimeOffRequest(request), replayed: false, warnings: overlaps.length ? ['This request overlaps an existing pending or approved request.'] : [] });
    }

    if (req.method === 'GET' && action === 'mine') {
      const employees = await deps.listEmployeesForBusiness(session.businessId);
      const employee = resolveActiveSessionEmployee(session, employees);
      if (!employee) return res.status(404).json({ ok: false, error: 'Active employee profile not found.' });
      const requests = (await deps.listTimeOffRequestsForBusiness(session.businessId)).filter((item) => item.employeeId === employee.id);
      return res.status(200).json({ ok: true, items: requests.map(safeEmployeeTimeOffRequest) });
    }

    if (req.method === 'GET' && action === 'schedule') {
      const startDate = typeof req.query?.startDate === 'string' ? req.query.startDate : '';
      const endDate = typeof req.query?.endDate === 'string' ? req.query.endDate : '';
      if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) {
        return res.status(400).json({ ok: false, error: 'A valid Schedule date range is required.' });
      }
      const [requests, employees] = await Promise.all([
        deps.listApprovedTimeOffOverlappingForBusiness(session.businessId, startDate, endDate),
        deps.listEmployeesForBusiness(session.businessId),
      ]);
      const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
      const items = requests
        .filter((request) => employeeById.has(request.employeeId))
        .map((request) => ({
          id: request.id,
          employeeId: request.employeeId,
          employeeName: employeeById.get(request.employeeId)?.name ?? 'Employee',
          requestType: request.requestType,
          startDate: request.startDate,
          endDate: request.endDate,
          status: 'approved',
        }));
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === 'GET' && action === 'detail') {
      const request = await deps.getTimeOffRequestForBusiness(session.businessId, req.query.id);
      if (!request) return res.status(404).json({ ok: false, error: 'Time-off request not found.' });
      if (!isOwnerOrAdmin(session)) {
        const employees = await deps.listEmployeesForBusiness(session.businessId);
        const employee = resolveActiveSessionEmployee(session, employees);
        if (!employee || request.employeeId !== employee.id) return res.status(404).json({ ok: false, error: 'Time-off request not found.' });
        return res.status(200).json({ ok: true, request: safeEmployeeTimeOffRequest(request) });
      }
      const [employees, users] = await Promise.all([deps.listEmployeesForBusiness(session.businessId), deps.listUsersForBusiness(session.businessId)]);
      return res.status(200).json({ ok: true, request: adminResponse(request, employees, users) });
    }

    if (req.method === 'GET' && action === 'list') {
      if (!isOwnerOrAdmin(session)) return res.status(403).json({ ok: false, error: 'Forbidden' });
      const [requests, employees, users] = await Promise.all([deps.listTimeOffRequestsForBusiness(session.businessId), deps.listEmployeesForBusiness(session.businessId), deps.listUsersForBusiness(session.businessId)]);
      return res.status(200).json({ ok: true, items: requests.map((request) => adminResponse(request, employees, users)) });
    }

    if (req.method === 'PATCH' && action === 'cancel') {
      const request = await deps.getTimeOffRequestForBusiness(session.businessId, req.query.id);
      if (!request) return res.status(404).json({ ok: false, error: 'Time-off request not found.' });
      const employees = await deps.listEmployeesForBusiness(session.businessId);
      const employee = resolveActiveSessionEmployee(session, employees);
      if (!employee || request.employeeId !== employee.id) return res.status(404).json({ ok: false, error: 'Time-off request not found.' });
      const transitionedAt = deps.now();
      const result = await deps.cancelTimeOffRequestForBusiness({ businessId: session.businessId, request, actor: session, transitionedAt });
      const authoritative = await deps.getTimeOffRequestForBusiness(session.businessId, request.id);
      if (!result.ok) return res.status(409).json({ ok: false, error: 'Time-off request is no longer pending.', request: safeEmployeeTimeOffRequest(authoritative) });
      return res.status(200).json({ ok: true, request: safeEmployeeTimeOffRequest({ ...request, status: 'cancelled', cancelledAt: transitionedAt, updatedAt: transitionedAt }) });
    }

    if (req.method === 'PATCH' && (action === 'approve' || action === 'deny')) {
      if (!isOwnerOrAdmin(session)) return res.status(403).json({ ok: false, error: 'Forbidden' });
      const request = await deps.getTimeOffRequestForBusiness(session.businessId, req.query.id);
      if (!request) return res.status(404).json({ ok: false, error: 'Time-off request not found.' });
      const reviewNote = typeof req.body?.reviewNote === 'string' ? req.body.reviewNote.trim() : '';
      if (reviewNote.length > 2000) return res.status(400).json({ ok: false, error: 'Review note must be 2000 characters or fewer.' });
      const transitionedAt = deps.now();
      const transition = action === 'approve' ? deps.approveTimeOffRequestForBusiness : deps.denyTimeOffRequestForBusiness;
      const result = await transition({ businessId: session.businessId, request, actor: session, reviewNote, transitionedAt });
      const authoritative = await deps.getTimeOffRequestForBusiness(session.businessId, request.id);
      if (!result.ok) return res.status(409).json({ ok: false, error: 'Time-off request has already been resolved.', request: authoritative });
      return res.status(200).json({ ok: true, request: { ...request, status: action === 'approve' ? 'approved' : 'denied', reviewedAt: transitionedAt, reviewedByUserId: session.id, reviewNote, updatedAt: transitionedAt } });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  };
}
