const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function formatJobPlanRateInput(value) {
  return Math.max(0, finite(value)).toFixed(2);
}

export function jobLineWorkers(line) {
  return line?.category === 'labour' ? Math.max(1, Math.floor(finite(line.workers, 1))) : 1;
}

export function jobLineHoursPerWorker(line) {
  if (line?.category !== 'labour') return 0;
  const workers = jobLineWorkers(line);
  return Math.max(0, finite(line.hoursPerWorker, finite(line.quantity) / workers));
}

export function jobLinePlannedQuantity(line) {
  return line?.category === 'labour'
    ? jobLineWorkers(line) * jobLineHoursPerWorker(line)
    : Math.max(0, finite(line?.quantity));
}

export function jobLinePlannedTotal(line) {
  return jobLinePlannedQuantity(line) * Math.max(0, finite(line?.unitCost));
}

export function loadJobWorkAreaDraft(workArea) {
  return {
    name: String(workArea?.name ?? ''),
    description: String(workArea?.description ?? ''),
    status: workArea?.status ?? 'not_started',
    lineItems: (Array.isArray(workArea?.lineItems) ? workArea.lineItems : []).map((line) => ({
      ...line,
      quantity: jobLinePlannedQuantity(line),
      ...(line.category === 'labour' ? { workers: jobLineWorkers(line), hoursPerWorker: jobLineHoursPerWorker(line) } : {}),
    })),
  };
}

export function jobWorkAreaDraftTotals(draft) {
  const lines = Array.isArray(draft?.lineItems) ? draft.lineItems : [];
  return {
    plannedCost: lines.reduce((sum, line) => sum + jobLinePlannedTotal(line), 0),
    soldRevenue: lines.reduce((sum, line) => sum + Math.max(0, finite(line.contractRevenue, finite(line.total))), 0),
  };
}