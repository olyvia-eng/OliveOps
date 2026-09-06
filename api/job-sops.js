import { requireSession } from './_lib/session.js';
import { authorizeRecordAccess } from './_lib/authorization.js';
import { getJobForBusiness } from './_lib/authRepo.js';
import { listCrewsForBusiness } from './_lib/schedulingConfig.js';
import {
  addJobSopAssociationForBusiness,
  getJobSopAssociationForBusiness,
  listJobSopAssociationsForBusiness,
  removeJobSopAssociationForBusiness,
} from './_lib/jobSopRepo.js';
import {
  getSopDefinitionForBusiness,
  getSopVersionForBusiness,
  listSopDefinitionsForBusiness,
} from './_lib/sopRepo.js';

const MANAGE_ROLES = new Set(['owner', 'admin', 'foreman']);
const isPublished = (definition) => definition?.status === 'published'
  && definition.active === true
  && Number(definition.currentVersion) > 0;

const defaultDeps = {
  requireSession,
  authorizeRecordAccess,
  getJobForBusiness,
  listCrewsForBusiness,
  addJobSopAssociationForBusiness,
  getJobSopAssociationForBusiness,
  listJobSopAssociationsForBusiness,
  removeJobSopAssociationForBusiness,
  getSopDefinitionForBusiness,
  getSopVersionForBusiness,
  listSopDefinitionsForBusiness,
};

const actorFrom = (session) => ({ id: session.id, name: session.name, email: session.email });

async function resolveAssociation(deps, businessId, association) {
  const definition = await deps.getSopDefinitionForBusiness(businessId, association.sopId);
  if (!isPublished(definition)) return null;
  const version = await deps.getSopVersionForBusiness(businessId, association.sopId, definition.currentVersion);
  if (!version) return null;
  return { ...version, association: { addedAt: association.addedAt, addedBy: association.addedBy } };
}

export function createJobSopsHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  return async function jobSopsHandler(req, res) {
    const session = await deps.requireSession(req, res);
    if (!session) return;

    const jobId = typeof req.query?.jobId === 'string' ? req.query.jobId : '';
    const job = jobId ? await deps.getJobForBusiness(session.businessId, jobId) : null;
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
    const crews = await deps.listCrewsForBusiness(session.businessId);
    if (!deps.authorizeRecordAccess(session, 'jobs', job, { crews })) {
      return res.status(404).json({ ok: false, error: 'Job not found.' });
    }

    if (req.method === 'GET') {
      if (req.query?.action === 'detail') {
        const sopId = typeof req.query?.sopId === 'string' ? req.query.sopId.trim() : '';
        const association = sopId
          ? await deps.getJobSopAssociationForBusiness(session.businessId, jobId, sopId)
          : null;
        const sop = association ? await resolveAssociation(deps, session.businessId, association) : null;
        return sop
          ? res.status(200).json({ ok: true, sop })
          : res.status(404).json({ ok: false, error: 'SOP was not found for this Job.' });
      }
      if (req.query?.action === 'available') {
        if (!MANAGE_ROLES.has(session.role)) return res.status(403).json({ ok: false, error: 'Not authorized.' });
        const [definitions, associations] = await Promise.all([
          deps.listSopDefinitionsForBusiness(session.businessId),
          deps.listJobSopAssociationsForBusiness(session.businessId, jobId),
        ]);
        const associatedIds = new Set(associations.map((item) => item.sopId));
        const sops = definitions
          .filter(isPublished)
          .map((definition) => ({
            sopId: definition.id,
            title: definition.title,
            category: definition.category,
            shortDescription: definition.shortDescription,
            currentVersion: definition.currentVersion,
            contentMode: definition.contentMode,
            associated: associatedIds.has(definition.id),
          }))
          .sort((left, right) => left.title.localeCompare(right.title));
        return res.status(200).json({ ok: true, sops });
      }

      const associations = await deps.listJobSopAssociationsForBusiness(session.businessId, jobId);
      const sops = (await Promise.all(associations.map((association) => resolveAssociation(deps, session.businessId, association))))
        .filter(Boolean)
        .sort((left, right) => left.title.localeCompare(right.title));
      return res.status(200).json({ ok: true, sops });
    }

    if (!MANAGE_ROLES.has(session.role)) return res.status(403).json({ ok: false, error: 'Not authorized.' });

    if (req.method === 'POST') {
      const sopIds = [...new Set((Array.isArray(req.body?.sopIds) ? req.body.sopIds : [])
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean))];
      if (sopIds.length === 0) return res.status(400).json({ ok: false, error: 'Select at least one SOP.' });
      const definitions = await Promise.all(sopIds.map((sopId) => deps.getSopDefinitionForBusiness(session.businessId, sopId)));
      if (definitions.some((definition) => !isPublished(definition))) {
        return res.status(400).json({ ok: false, error: 'Only active published SOPs can be added to a Job.' });
      }
      const associations = await Promise.all(sopIds.map((sopId) => deps.addJobSopAssociationForBusiness({
        businessId: session.businessId,
        jobId,
        sopId,
        actor: actorFrom(session),
      })));
      return res.status(200).json({ ok: true, associations });
    }

    if (req.method === 'DELETE') {
      const sopId = typeof req.query?.sopId === 'string' ? req.query.sopId.trim() : '';
      if (!sopId) return res.status(400).json({ ok: false, error: 'SOP ID is required.' });
      await deps.removeJobSopAssociationForBusiness({ businessId: session.businessId, jobId, sopId });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  };
}

export default createJobSopsHandler();