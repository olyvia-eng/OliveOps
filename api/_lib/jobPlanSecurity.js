const CONVERTED_JOB_PROTECTED_FIELDS = new Set([
  'estimateId',
  'sourceEstimateId',
  'convertedFromEstimateAt',
  'convertedByUserId',
  'convertedByUserName',
  'pricingBudgetId',
  'divisionId',
  'originalEstimateSnapshot',
  'originalContractRevenue',
  'currentContractRevenue',
  'contractValue',
  'operationalWorkAreas',
  'planningSnapshotVersion',
  'planningRevision',
  'currentPlannedCost',
  'estimatedCost',
]);

export function validateGenericJobPatch(existingJob, patch) {
  if (!existingJob?.sourceEstimateId) return null;
  const protectedField = Object.keys(patch ?? {}).find((field) => CONVERTED_JOB_PROTECTED_FIELDS.has(field));
  return protectedField
    ? `Converted Job ${protectedField} must be changed through the Job planning workflow.`
    : null;
}