import { requireSession } from './_lib/session.js';
import { getBusinessProfile, getEmployeeForBusiness, listEmployeesForBusiness } from './_lib/authRepo.js';
import { getFileForBusiness } from './_lib/authRepo.js';
import { documentFromFileRecord } from './_lib/documentContent.js';
import { calculateTrainingCompliance } from './_lib/trainingModel.js';
import {
  changeTrainingAssignmentDueDate,
  completeTrainingAssignmentForBusiness,
  createTrainingAssignmentForBusiness,
  createTrainingDraftForBusiness,
  getTrainingAssignmentForBusiness,
  getTrainingDefinitionForBusiness,
  getTrainingVersionForBusiness,
  listTrainingAssignmentsForBusiness,
  listTrainingCompletionsForBusiness,
  listTrainingDefinitionsForBusiness,
  listTrainingVersionsForBusiness,
  presentTrainingAssignments,
  publishTrainingVersionForBusiness,
  requireTrainingVersionForAssignment,
  revokeTrainingAssignmentForBusiness,
  setTrainingActiveForBusiness,
  startTrainingDraftForBusiness,
  updateTrainingDraftForBusiness,
} from './_lib/trainingRepo.js';

const ADMIN_ROLES = new Set(['owner', 'admin']);
const parseBody = (req) => {
  if (typeof req.body !== 'string') return req.body ?? {};
  try { return JSON.parse(req.body); } catch { return null; }
};

const defaultDeps = {
  requireSession, getBusinessProfile, getEmployeeForBusiness, listEmployeesForBusiness, getFileForBusiness,
  changeTrainingAssignmentDueDate, completeTrainingAssignmentForBusiness, createTrainingAssignmentForBusiness,
  createTrainingDraftForBusiness, getTrainingAssignmentForBusiness, getTrainingDefinitionForBusiness,
  getTrainingVersionForBusiness, listTrainingAssignmentsForBusiness, listTrainingCompletionsForBusiness,
  listTrainingDefinitionsForBusiness, listTrainingVersionsForBusiness, presentTrainingAssignments,
  publishTrainingVersionForBusiness, requireTrainingVersionForAssignment, revokeTrainingAssignmentForBusiness,
  setTrainingActiveForBusiness, startTrainingDraftForBusiness, updateTrainingDraftForBusiness,
};

function actorFrom(session) {
  return { id: session.id, name: session.name, email: session.email };
}

function errorResponse(res, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return res.status(status).json({ ok: false, error: status === 500 ? 'Training request could not be completed.' : error.message, code: error?.code, fields: error?.fields });
}

export function createTrainingHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  return async function trainingHandler(req, res) {
    const session = await deps.requireSession(req, res);
    if (!session) return;
    const action = typeof req.query?.action === 'string' ? req.query.action : 'list';
    const isAdmin = ADMIN_ROLES.has(session.role);
    const body = req.method === 'POST' || req.method === 'PATCH' ? parseBody(req) : {};
    if (body === null) return res.status(400).json({ ok: false, error: 'Invalid JSON request body.' });

    try {
      const profile = await deps.getBusinessProfile(session.businessId);
      const timeZone = profile?.timezone;
      if (req.method === 'GET' && action === 'list') {
        if (!isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const [definitions, rawAssignments] = await Promise.all([deps.listTrainingDefinitionsForBusiness(session.businessId), deps.listTrainingAssignmentsForBusiness(session.businessId)]);
        const assignments = deps.presentTrainingAssignments(rawAssignments, { timeZone });
        return res.status(200).json({ ok: true, definitions, assignments });
      }
      if (req.method === 'GET' && action === 'detail') {
        if (!isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const trainingId = String(req.query?.trainingId ?? '');
        const definition = await deps.getTrainingDefinitionForBusiness(session.businessId, trainingId);
        if (!definition) return res.status(404).json({ ok: false, error: 'Training was not found.' });
        const [versions, allAssignments, completions] = await Promise.all([deps.listTrainingVersionsForBusiness(session.businessId, trainingId), deps.listTrainingAssignmentsForBusiness(session.businessId), deps.listTrainingCompletionsForBusiness(session.businessId)]);
        return res.status(200).json({ ok: true, definition, versions, assignments: deps.presentTrainingAssignments(allAssignments.filter((item) => item.trainingId === trainingId), { timeZone }), completions: completions.filter((item) => item.trainingId === trainingId) });
      }
      if (req.method === 'GET' && action === 'employee-profile') {
        if (!isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const employeeId = String(req.query?.employeeId ?? '');
        const employee = await deps.getEmployeeForBusiness(session.businessId, employeeId);
        if (!employee) return res.status(404).json({ ok: false, error: 'Employee was not found.' });
        const [allAssignments, allCompletions] = await Promise.all([deps.listTrainingAssignmentsForBusiness(session.businessId), deps.listTrainingCompletionsForBusiness(session.businessId)]);
        const assignments = deps.presentTrainingAssignments(allAssignments.filter((item) => item.employeeId === employeeId), { timeZone });
        return res.status(200).json({ ok: true, assignments, completions: allCompletions.filter((item) => item.employeeId === employeeId), compliance: calculateTrainingCompliance(assignments) });
      }

      const employee = session.employeeId ? await deps.getEmployeeForBusiness(session.businessId, session.employeeId) : null;
      if (['my-list', 'my-detail', 'my-history', 'complete'].includes(action) && (!employee || employee.active === false || employee.userId !== session.id)) {
        return res.status(403).json({ ok: false, error: 'An active linked employee profile is required.' });
      }
      if (req.method === 'GET' && action === 'my-list') {
        const allAssignments = await deps.listTrainingAssignmentsForBusiness(session.businessId);
        const assignments = deps.presentTrainingAssignments(allAssignments.filter((item) => item.employeeId === employee.id && !item.revokedAt), { timeZone });
        return res.status(200).json({ ok: true, assignments, attentionCount: assignments.filter((item) => item.presentationStatus === 'overdue' || item.presentationStatus === 'due_soon').length });
      }
      if (req.method === 'GET' && action === 'my-detail') {
        const assignment = await deps.getTrainingAssignmentForBusiness(session.businessId, String(req.query?.assignmentId ?? ''));
        if (!assignment || assignment.employeeId !== employee.id) return res.status(404).json({ ok: false, error: 'Training assignment was not found.' });
        if (assignment.revokedAt) return res.status(409).json({ ok: false, error: 'This training assignment has been revoked. Refresh your Hub.', code: 'stale_assignment' });
        const version = await deps.getTrainingVersionForBusiness(session.businessId, assignment.trainingId, assignment.assignedVersion);
        return res.status(200).json({ ok: true, assignment: deps.presentTrainingAssignments([assignment], { timeZone })[0], version });
      }
      if (req.method === 'GET' && action === 'my-history') {
        const completions = await deps.listTrainingCompletionsForBusiness(session.businessId);
        return res.status(200).json({ ok: true, completions: completions.filter((item) => item.employeeId === employee.id).sort((a, b) => b.completedAt.localeCompare(a.completedAt)) });
      }

      if (req.method !== 'POST' && req.method !== 'PATCH') {
        res.setHeader('Allow', 'GET, POST, PATCH');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }
      if (action === 'complete') {
        const result = await deps.completeTrainingAssignmentForBusiness({ businessId: session.businessId, employee, assignmentId: body.assignmentId, submissionId: body.submissionId, checklistResponses: body.checklistResponses, acknowledged: body.acknowledged, timeZone });
        return res.status(200).json({ ok: true, ...result });
      }
      if (!isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });
      const actor = actorFrom(session);
      if (action === 'create') {
        const definition = await deps.createTrainingDraftForBusiness({ businessId: session.businessId, actor, input: body.training, requestId: body.requestId });
        return res.status(201).json({ ok: true, definition });
      }
      if (action === 'update-draft') {
        const requested = body.training ?? {};
        const document = requested.contentMode === 'document' && requested.document?.fileId
          ? documentFromFileRecord(await deps.getFileForBusiness(session.businessId, requested.document.fileId), { entityType: 'training', entityId: body.trainingId })
          : null;
        if (requested.contentMode === 'document' && requested.document?.fileId && !document) return res.status(409).json({ ok: false, error: 'The PDF upload is not ready or does not belong to this Training.' });
        const definition = await deps.updateTrainingDraftForBusiness({ businessId: session.businessId, trainingId: body.trainingId, actor, input: { ...requested, document } });
        return definition ? res.status(200).json({ ok: true, definition }) : res.status(404).json({ ok: false, error: 'Training was not found.' });
      }
      if (action === 'start-draft') {
        const definition = await deps.startTrainingDraftForBusiness({ businessId: session.businessId, trainingId: body.trainingId, actor });
        return definition ? res.status(200).json({ ok: true, definition }) : res.status(404).json({ ok: false, error: 'Training was not found.' });
      }
      if (action === 'publish') {
        const definition = await deps.getTrainingDefinitionForBusiness(session.businessId, body.trainingId);
        const document = definition?.contentMode === 'document' && definition.document?.fileId
          ? documentFromFileRecord(await deps.getFileForBusiness(session.businessId, definition.document.fileId), { entityType: 'training', entityId: body.trainingId })
          : null;
        const version = await deps.publishTrainingVersionForBusiness({ businessId: session.businessId, trainingId: body.trainingId, actor, requestId: body.requestId, document });
        if (!version) return res.status(404).json({ ok: false, error: 'Training was not found.' });
        const selected = new Set(Array.isArray(body.requireEmployeeIds) ? body.requireEmployeeIds.filter((id) => typeof id === 'string') : []);
        if (selected.size > 0) {
          const assignments = await deps.listTrainingAssignmentsForBusiness(session.businessId);
          await Promise.all(assignments.filter((item) => item.trainingId === body.trainingId && selected.has(item.employeeId) && !item.revokedAt).map((item) => deps.requireTrainingVersionForAssignment({ businessId: session.businessId, assignmentId: item.id, version: version.version, actor, dueDate: body.dueDate })));
        }
        return res.status(200).json({ ok: true, version });
      }
      if (action === 'assign') {
        const employees = await deps.listEmployeesForBusiness(session.businessId);
        const requestedIds = Array.isArray(body.employeeIds) ? [...new Set(body.employeeIds.filter((id) => typeof id === 'string'))] : [];
        const selected = body.allActive === true ? employees.filter((item) => item.active) : employees.filter((item) => item.active && requestedIds.includes(item.id));
        if (selected.length === 0) return res.status(400).json({ ok: false, error: 'Select at least one active employee.' });
        const assignments = await Promise.all(selected.map((item, index) => deps.createTrainingAssignmentForBusiness({ businessId: session.businessId, actor, employee: item, trainingId: body.trainingId, initialDueDate: body.initialDueDate, requestId: body.requestId ? `${body.requestId}-${index}` : undefined })));
        return res.status(200).json({ ok: true, assignments });
      }
      if (action === 'revoke') {
        const assignment = await deps.revokeTrainingAssignmentForBusiness({ businessId: session.businessId, assignmentId: body.assignmentId, actor });
        return assignment ? res.status(200).json({ ok: true, assignment }) : res.status(404).json({ ok: false, error: 'Assignment was not found.' });
      }
      if (action === 'change-due-date') {
        const assignment = await deps.changeTrainingAssignmentDueDate({ businessId: session.businessId, assignmentId: body.assignmentId, dueDate: body.dueDate, actor });
        return assignment ? res.status(200).json({ ok: true, assignment }) : res.status(404).json({ ok: false, error: 'Assignment was not found.' });
      }
      if (action === 'set-active') {
        const definition = await deps.setTrainingActiveForBusiness({ businessId: session.businessId, trainingId: body.trainingId, active: body.active, actor });
        return definition ? res.status(200).json({ ok: true, definition }) : res.status(404).json({ ok: false, error: 'Training was not found.' });
      }
      return res.status(400).json({ ok: false, error: 'Unsupported training action.' });
    } catch (error) {
      return errorResponse(res, error);
    }
  };
}

export default createTrainingHandler();