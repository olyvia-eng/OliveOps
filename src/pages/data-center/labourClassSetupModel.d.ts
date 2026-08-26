import type { BudgetDivisionPlanningItem, Employee, LabourClass } from '../../types';

export type LabourClassSetupGroup = { key: string; id: string | null; name: string };
export type LabourClassSetupDraft = {
  classes: LabourClassSetupGroup[];
  assignments: Record<string, string | null>;
};

export function normalizeLabourClassName(value: unknown): string;
export function suggestLabourClassName(employee: Employee): string | null;
export function shouldOfferLabourClassSetup(input: {
  employees?: Employee[];
  labourClasses?: LabourClass[];
  planningItems?: BudgetDivisionPlanningItem[];
}): boolean;
export function buildLabourClassSetupDraft(input: {
  employees?: Employee[];
  labourClasses?: LabourClass[];
}): LabourClassSetupDraft;
export function mergeLabourClassSetupGroups(classes: LabourClassSetupGroup[]): LabourClassSetupGroup[];