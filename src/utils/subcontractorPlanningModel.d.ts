export interface SubcontractorPlanningAssumptions {
  category?: string;
  rate?: number;
  unitCost?: number;
  plannedQuantity?: number;
  plannedAmount?: number;
}

export function subcontractorPlannedQuantity(item: SubcontractorPlanningAssumptions): number;
export function subcontractorCostPerUnit(item: SubcontractorPlanningAssumptions): number;
export function calculateAnnualSubcontractorCost(item: SubcontractorPlanningAssumptions): number;
export function normalizeSubcontractorPlanAssumptions<T extends SubcontractorPlanningAssumptions>(item: T): T & Required<Pick<SubcontractorPlanningAssumptions, 'rate' | 'plannedQuantity' | 'plannedAmount'>>;