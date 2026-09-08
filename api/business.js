import { getBusinessProfile, getFileForBusiness, updateBusinessProfile } from './_lib/authRepo.js';
import { isValidTimeZone } from './_lib/businessTime.js';
import { requireSession } from './_lib/session.js';
import { BUSINESS_FEATURE_KEYS, normalizeBusinessFeatures } from '../shared/businessFeatures.js';

export default async function handler(req, res) {
  const session = await requireSession(req, res, ['owner', 'admin']);
  if (!session) return;

  if (req.method === 'GET') {
    const business = await getBusinessProfile(session.businessId);
    if (!business) return res.status(404).json({ ok: false, error: 'Business profile not found.' });
    return res.status(200).json({ ok: true, business });
  }

  if (req.method === 'PATCH') {
    const timezone = req.body?.timezone;
    if (timezone !== undefined && !isValidTimeZone(timezone)) return res.status(400).json({ ok: false, error: 'A valid IANA timezone is required.' });
    if (req.body?.features !== undefined) {
      const features = req.body.features;
      const valid = features && typeof features === 'object' && !Array.isArray(features)
        && Object.keys(features).every((key) => BUSINESS_FEATURE_KEYS.includes(key))
        && BUSINESS_FEATURE_KEYS.every((key) => typeof features[key] === 'boolean');
      if (!valid) return res.status(400).json({ ok: false, error: 'Company features are invalid.' });
    }
    const textFields = ['legalName', 'phone', 'email', 'website', 'businessAddress', 'taxLabel', 'proposalTerms'];
    const invalidField = textFields.find((field) => req.body?.[field] !== undefined && (typeof req.body[field] !== 'string' || req.body[field].length > (field === 'proposalTerms' ? 10000 : 500)));
    if (invalidField) return res.status(400).json({ ok: false, error: `${invalidField} is invalid.` });
    if (req.body?.logoFileId !== undefined) {
      if (typeof req.body.logoFileId !== 'string' || req.body.logoFileId.length > 200) return res.status(400).json({ ok: false, error: 'Company logo is invalid.' });
      if (req.body.logoFileId) {
        const logo = await getFileForBusiness(session.businessId, req.body.logoFileId);
        if (!logo || logo.entityType !== 'business-profile' || logo.entityId !== session.businessId || logo.category !== 'logo' || logo.uploadStatus !== 'uploaded') {
          return res.status(400).json({ ok: false, error: 'Company logo is invalid.' });
        }
      }
    }
    const profile = { ...(timezone !== undefined ? { timezone } : {}) };
    if (req.body?.features !== undefined) profile.features = normalizeBusinessFeatures(req.body.features);
    for (const field of textFields) if (req.body?.[field] !== undefined) profile[field] = req.body[field].trim();
    if (req.body?.logoFileId !== undefined) profile.logoFileId = req.body.logoFileId.trim();
    const business = await updateBusinessProfile({ businessId: session.businessId, profile });
    return res.status(200).json({ ok: true, business });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}