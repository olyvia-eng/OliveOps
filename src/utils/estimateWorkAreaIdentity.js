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
