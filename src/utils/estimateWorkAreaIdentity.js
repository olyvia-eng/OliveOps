export function createDefaultEstimateWorkAreaModel(generateId) {
  return {
    id: generateId(),
    name: 'General',
    description: '',
    sortOrder: 0,
    lineItems: [],
  };
}

export function ensureDefaultEstimateWorkAreaModel(record, generateId) {
  if (Array.isArray(record.workAreas) && record.workAreas.length > 0) return record;
  return {
    ...record,
    workAreas: [{
      ...createDefaultEstimateWorkAreaModel(generateId),
      lineItems: Array.isArray(record.lineItems) ? record.lineItems : [],
    }],
  };
}

export function legacyEstimateWorkAreaIdModel(estimateId, identity, generateId) {
  if (!estimateId) return generateId();
  const seed = `${estimateId}:${identity}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-wa-${(hash >>> 0).toString(36)}`;
}

const validDivisionId = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

const workAreaDivisionIds = (record) => [...new Set(
  (Array.isArray(record?.workAreas) ? record.workAreas : [])
    .map((area) => validDivisionId(area?.divisionId))
    .filter(Boolean)
)];

export function enforceEstimateWorkAreaDivisionModel(existingEstimate, nextEstimate) {
  const existingAreaDivisions = workAreaDivisionIds(existingEstimate);
  if (!validDivisionId(existingEstimate?.divisionId) && existingAreaDivisions.length > 1) {
    return { ok: false, error: 'Existing Work Areas have conflicting Divisions. Resolve the historical Estimate before saving.' };
  }

  const existingDivisionId = validDivisionId(existingEstimate?.divisionId) ?? existingAreaDivisions[0];
  const requestedDivisionId = validDivisionId(nextEstimate?.divisionId);
  const nextAreaDivisions = workAreaDivisionIds(nextEstimate);
  if (nextAreaDivisions.length > 1) {
    return { ok: false, error: 'All Work Areas must use the Estimate Division.' };
  }

  const divisionId = existingDivisionId ?? requestedDivisionId ?? nextAreaDivisions[0];
  if (!divisionId) return { ok: false, error: 'Estimate Division is required.' };
  if (existingDivisionId && requestedDivisionId && requestedDivisionId !== existingDivisionId) {
    return { ok: false, error: 'Estimate Division cannot be changed through a Work Area update.' };
  }
  if (nextAreaDivisions[0] && nextAreaDivisions[0] !== divisionId) {
    return { ok: false, error: 'A Work Area cannot use a different Division from its Estimate.' };
  }

  return {
    ok: true,
    estimate: {
      ...nextEstimate,
      divisionId,
      workAreas: Array.isArray(nextEstimate.workAreas)
        ? nextEstimate.workAreas.map((area) => area && typeof area === 'object' ? { ...area, divisionId } : area)
        : nextEstimate.workAreas,
    },
  };
}
