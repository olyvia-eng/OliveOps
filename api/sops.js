import { requireSession } from './_lib/session.js';
import { getEmployeeForBusiness, getFileForBusiness } from './_lib/authRepo.js';
import { documentFromFileRecord } from './_lib/documentContent.js';
import {
  archiveSopForBusiness,
  createSopDraftForBusiness,
  duplicateSopForBusiness,
  getSopDefinitionForBusiness,
  getSopVersionForBusiness,
  listSopDefinitionsForBusiness,
  listSopVersionsForBusiness,
  publishSopVersionForBusiness,
  reactivateSopForBusiness,
  updateSopDraftForBusiness,
} from './_lib/sopRepo.js';

const ADMIN_ROLES = new Set(['owner', 'admin']);
const parseBody = (req) => {
  if (typeof req.body !== 'string') return req.body ?? {};
  try { return JSON.parse(req.body); } catch { return null; }
};
const actorFrom = (session) => ({ id: session.id, name: session.name, email: session.email });
const isEmployeeVisible = (definition) => definition?.status === 'published' && definition.active === true && Number(definition.currentVersion) > 0;

const defaultDeps = {
  requireSession, getEmployeeForBusiness, getFileForBusiness, archiveSopForBusiness, createSopDraftForBusiness,
  duplicateSopForBusiness, getSopDefinitionForBusiness, getSopVersionForBusiness,
  listSopDefinitionsForBusiness, listSopVersionsForBusiness, publishSopVersionForBusiness,
  reactivateSopForBusiness, updateSopDraftForBusiness,
};

function errorResponse(res, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return res.status(status).json({ ok: false, error: status === 500 ? 'SOP request could not be completed.' : error.message, fields: error?.fields });
}

export function createSopsHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  return async function sopsHandler(req, res) {
    const session = await deps.requireSession(req, res);
    if (!session) return;
    const action = typeof req.query?.action === 'string' ? req.query.action : 'list';
    const isAdmin = ADMIN_ROLES.has(session.role);
    const body = req.method === 'POST' || req.method === 'PATCH' ? parseBody(req) : {};
    if (body === null) return res.status(400).json({ ok: false, error: 'Invalid JSON request body.' });

    try {
      if (req.method === 'GET' && action === 'list') {
        if (!isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const definitions = await deps.listSopDefinitionsForBusiness(session.businessId);
        return res.status(200).json({ ok: true, definitions });
      }
      if (req.method === 'GET' && action === 'detail') {
        if (!isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });
        const sopId = String(req.query?.sopId ?? '');
        const definition = await deps.getSopDefinitionForBusiness(session.businessId, sopId);
        if (!definition) return res.status(404).json({ ok: false, error: 'SOP was not found.' });
        const versions = await deps.listSopVersionsForBusiness(session.businessId, sopId);
        return res.status(200).json({ ok: true, definition, versions });
      }

      if (action === 'my-list' || action === 'my-detail') {
        const employee = session.employeeId ? await deps.getEmployeeForBusiness(session.businessId, session.employeeId) : null;
        if (!employee || employee.active === false || employee.userId !== session.id) {
          return res.status(403).json({ ok: false, error: 'An active linked employee profile is required.' });
        }
        if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
        if (action === 'my-list') {
          const definitions = (await deps.listSopDefinitionsForBusiness(session.businessId)).filter(isEmployeeVisible);
          const sops = (await Promise.all(definitions.map((item) => deps.getSopVersionForBusiness(session.businessId, item.id, item.currentVersion))))
            .filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
          return res.status(200).json({ ok: true, sops });
        }
        const sopId = String(req.query?.sopId ?? '');
        const definition = await deps.getSopDefinitionForBusiness(session.businessId, sopId);
        if (!isEmployeeVisible(definition)) return res.status(404).json({ ok: false, error: 'SOP was not found.' });
        const sop = await deps.getSopVersionForBusiness(session.businessId, sopId, definition.currentVersion);
        return sop ? res.status(200).json({ ok: true, sop }) : res.status(404).json({ ok: false, error: 'SOP was not found.' });
      }

      if (req.method !== 'POST' && req.method !== 'PATCH') {
        res.setHeader('Allow', 'GET, POST, PATCH');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }
      if (!isAdmin) return res.status(403).json({ ok: false, error: 'Forbidden' });
      const actor = actorFrom(session);
      if (action === 'create') {
        const definition = await deps.createSopDraftForBusiness({ businessId: session.businessId, actor, input: body.sop, requestId: body.requestId });
        return res.status(201).json({ ok: true, definition });
      }
      if (action === 'update-draft') {
        const requested = body.sop ?? {};
        const document = requested.contentMode === 'document' && requested.document?.fileId
          ? documentFromFileRecord(await deps.getFileForBusiness(session.businessId, requested.document.fileId), { entityType: 'sop', entityId: body.sopId })
          : null;
        if (requested.contentMode === 'document' && requested.document?.fileId && !document) return res.status(409).json({ ok: false, error: 'The PDF upload is not ready or does not belong to this SOP.' });
        const definition = await deps.updateSopDraftForBusiness({ businessId: session.businessId, sopId: body.sopId, actor, input: { ...requested, document } });
        return definition ? res.status(200).json({ ok: true, definition }) : res.status(404).json({ ok: false, error: 'SOP was not found.' });
      }
      if (action === 'publish') {
        const definition = await deps.getSopDefinitionForBusiness(session.businessId, body.sopId);
        const document = definition?.contentMode === 'document' && definition.document?.fileId
          ? documentFromFileRecord(await deps.getFileForBusiness(session.businessId, definition.document.fileId), { entityType: 'sop', entityId: body.sopId })
          : null;
        const version = await deps.publishSopVersionForBusiness({ businessId: session.businessId, sopId: body.sopId, actor, requestId: body.requestId, document });
        return version ? res.status(200).json({ ok: true, version }) : res.status(404).json({ ok: false, error: 'SOP was not found.' });
      }
      if (action === 'duplicate') {
        const definition = await deps.duplicateSopForBusiness({ businessId: session.businessId, sopId: body.sopId, actor, requestId: body.requestId });
        return definition ? res.status(201).json({ ok: true, definition }) : res.status(404).json({ ok: false, error: 'SOP was not found.' });
      }
      if (action === 'archive' || action === 'reactivate') {
        const mutation = action === 'archive' ? deps.archiveSopForBusiness : deps.reactivateSopForBusiness;
        const definition = await mutation({ businessId: session.businessId, sopId: body.sopId, actor });
        return definition ? res.status(200).json({ ok: true, definition }) : res.status(404).json({ ok: false, error: 'SOP was not found.' });
      }
      return res.status(400).json({ ok: false, error: 'Unsupported SOP action.' });
    } catch (error) {
      return errorResponse(res, error);
    }
  };
}

export default createSopsHandler();