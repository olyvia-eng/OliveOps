function timestamp(value) {
  const parsed = Date.parse(typeof value === 'string' ? value : '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function mergeEstimateSnapshotsModel(current, incoming, requestStartedAt) {
  const currentById = new Map(current.map((estimate) => [estimate.id, estimate]));
  const incomingIds = new Set(incoming.map((estimate) => estimate.id));
  const merged = incoming.map((estimate) => {
    const local = currentById.get(estimate.id);
    if (!local) return estimate;
    return timestamp(local.updatedAt) >= timestamp(estimate.updatedAt) ? local : estimate;
  });

  for (const local of current) {
    if (incomingIds.has(local.id)) continue;
    if (timestamp(local.createdAt) >= requestStartedAt) {
      merged.push(local);
    }
  }

  return merged;
}

export function shouldApplySequencedResponseModel(responseSequence, latestSequence) {
  return responseSequence === latestSequence;
}

export function nextEstimateUpdatedAtModel(previousUpdatedAt, now = Date.now()) {
  const previous = timestamp(previousUpdatedAt);
  return new Date(Math.max(now, previous + 1)).toISOString();
}