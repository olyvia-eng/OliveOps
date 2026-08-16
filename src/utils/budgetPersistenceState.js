function timestamp(value) {
  const parsed = Date.parse(typeof value === 'string' ? value : '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function mergeBudgetSnapshotsModel(current, incoming, idsAtRequestStart) {
  const currentById = new Map(current.map((record) => [record.id, record]));
  const incomingIds = new Set(incoming.map((record) => record.id));
  const merged = incoming.map((record) => {
    const local = currentById.get(record.id);
    if (!local) return record;
    return timestamp(local.updatedAt) >= timestamp(record.updatedAt) ? local : record;
  });

  for (const local of current) {
    if (!incomingIds.has(local.id) && !idsAtRequestStart.has(local.id)) merged.push(local);
  }
  return merged;
}

export function shouldApplyBudgetResponseModel(responseSequence, latestSequence) {
  return responseSequence === latestSequence;
}