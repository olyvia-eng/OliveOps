import { isDeepStrictEqual } from 'node:util';

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

function protectedValuesMatch(left, right) {
  if (left == null && right == null) return true;
  return isDeepStrictEqual(left, right);
}

export function validateGenericJobPatch(existingJob, patch) {
  if (!existingJob?.sourceEstimateId) return null;
  const protectedField = Object.keys(patch ?? {}).find((field) => (
    CONVERTED_JOB_PROTECTED_FIELDS.has(field)
    && !protectedValuesMatch(patch[field], existingJob[field])
  ));
  return protectedField
    ? `Converted Job ${protectedField} must be changed through the Job planning workflow.`
    : null;
}