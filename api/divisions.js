import { SCHEDULE_COLOUR_PALETTE } from '../src/config/scheduleColours.js';
import { requireSession } from './_lib/session.js';
import { getDivisionForBusiness, listDivisionsForBusiness, normalizeDivisionName, saveDivisionForBusiness } from './_lib/schedulingConfig.js';

const allowedColours = new Set(SCHEDULE_COLOUR_PALETTE.map((colour) => colour.value));

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const session = await requireSession(req, res, req.method === 'GET' ? undefined : ['owner', 'admin'], 'divisions');
  if (!session) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true, divisions: await listDivisionsForBusiness(session.businessId) });
    const id = req.method === 'POST' ? req.body?.id : req.query.id;
    if (typeof id !== 'string' || !id) return res.status(400).json({ ok: false, error: 'Division id is required.' });
    const existing = req.method === 'PATCH' ? await getDivisionForBusiness(session.businessId, id) : null;
    if (req.method === 'PATCH' && !existing) return res.status(404).json({ ok: false, error: 'Division not found.' });
    const next = { ...existing, ...req.body, id };
    const name = typeof next.name === 'string' ? next.name.trim() : '';
    const normalizedName = normalizeDivisionName(name);
    if (!name || !normalizedName || !allowedColours.has(next.colour)) return res.status(400).json({ ok: false, error: 'Division name and an approved colour are required.' });
    const duplicate = (await listDivisionsForBusiness(session.businessId)).find((division) => division.id !== id && division.normalizedName === normalizedName);
    if (duplicate) return res.status(409).json({ ok: false, error: 'A division with this name already exists.' });
    const division = await saveDivisionForBusiness({
      businessId: session.businessId,
      division: { id, name, normalizedName, colour: next.colour, active: next.active !== false, sortOrder: Math.max(0, Number(next.sortOrder) || 0) },
    });
    return res.status(200).json({ ok: true, division });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not save division.' });
  }
}