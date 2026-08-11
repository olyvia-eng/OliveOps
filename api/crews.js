import { SCHEDULE_COLOUR_PALETTE } from '../src/config/scheduleColours.js';
import { getEmployeeForBusiness } from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';
import { getCrewForBusiness, getDivisionForBusiness, listCrewsForBusiness, saveCrewForBusiness } from './_lib/schedulingConfig.js';

const allowedColours = new Set(SCHEDULE_COLOUR_PALETTE.map((colour) => colour.value));

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res, req.method === 'GET' ? undefined : ['owner', 'admin'], 'crews');
  if (!session) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true, crews: await listCrewsForBusiness(session.businessId) });
    const id = req.method === 'POST' ? req.body?.id : req.query.id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ ok: false, error: 'Crew id is required.' });
    const existing = req.method === 'PATCH' ? await getCrewForBusiness(session.businessId, id) : null;
    if (req.method === 'PATCH' && !existing) return res.status(404).json({ ok: false, error: 'Crew not found.' });
    const next = { ...existing, ...req.body, id };
    const name = typeof next.name === 'string' ? next.name.trim() : '';
    const memberIds = [...new Set(Array.isArray(next.memberIds) ? next.memberIds.filter((value) => typeof value === 'string' && value) : [])];
    if (!name || !allowedColours.has(next.colour)) return res.status(400).json({ ok: false, error: 'Crew name and an approved colour are required.' });
    const employeeIds = [...new Set([...memberIds, next.leadEmployeeId].filter(Boolean))];
    const employees = await Promise.all(employeeIds.map((employeeId) => getEmployeeForBusiness(session.businessId, employeeId)));
    if (employees.some((employee) => !employee)) return res.status(400).json({ ok: false, error: 'Crew employees must belong to this business.' });
    if (next.defaultDivisionId && !await getDivisionForBusiness(session.businessId, next.defaultDivisionId)) {
      return res.status(400).json({ ok: false, error: 'Crew division must belong to this business.' });
    }
    const crew = await saveCrewForBusiness({
      businessId: session.businessId,
      crew: { id, name, colour: next.colour, leadEmployeeId: next.leadEmployeeId || undefined, active: next.active !== false, defaultDivisionId: next.defaultDivisionId || undefined, memberIds },
    });
    return res.status(200).json({ ok: true, crew });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not save crew.' });
  }
}