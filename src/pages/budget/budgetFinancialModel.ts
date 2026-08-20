import type { BudgetDivision, BudgetDivisionPlanningItem, BudgetItem } from '../../types';
import { calculateDivisionLabourShare, isLabourAllocatedToDivision } from './divisionLabourPlanningModel';

type PlanningItem = Partial<BudgetDivisionPlanningItem> & Pick<BudgetDivisionPlanningItem, 'id' | 'budgetId' | 'divisionId' | 'category'>;

export interface BudgetFinancialInput {
  divisions: BudgetDivision[];
  planningItems: PlanningItem[];
  companyOverheadItems?: BudgetItem[];
}

export interface DivisionFinancials {
  divisionId: string;
  divisionName: string;
  revenue: number;
  directLabour: number;
  directEquipment: number;
  materials: number;
  subcontractors: number;
  totalDirectCosts: number;
  grossProfit: number | null;
  grossMargin: number | null;
  overheadLabour: number;
  overheadEquipment: number;
  divisionOverhead: number;
  allocatedCompanyOverhead: null;
  totalOverheadBeforeCompany: number;
  operatingProfitBeforeCompanyOverhead: number | null;
  operatingMarginBeforeCompanyOverhead: number | null;
  isComplete: boolean;
  missingCategories: string[];
}

const finiteNonNegative = (value: number | undefined) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
);

const itemAnnualCost = (item: PlanningItem) => {
  if (item.plannedAmount !== undefined) return finiteNonNegative(item.plannedAmount);
  if (item.category === 'equipment') {
    return finiteNonNegative(item.equipmentPayment) * finiteNonNegative(item.equipmentPaymentFrequencyPerYear ?? item.paymentFrequencyPerYear ?? 1)
      + finiteNonNegative(item.yearlyFuelCost)
      + finiteNonNegative(item.yearlyInsuranceCost)
      + finiteNonNegative(item.yearlyMaintenanceCost);
  }
  return finiteNonNegative(item.unitCost ?? item.rate) * finiteNonNegative(item.plannedQuantity ?? 1);
};

const equipmentMonths = (item: PlanningItem, divisionId: string) => item.equipmentDivisionAllocations?.find((allocation) => allocation.divisionId === divisionId)?.months
  ?? (item.divisionId === divisionId ? item.allocationMonths ?? 12 : 0);

const equipmentShare = (item: PlanningItem, divisionId: string) => itemAnnualCost(item) * finiteNonNegative(equipmentMonths(item, divisionId)) / 12;

const localItemCost = (item: PlanningItem, divisionId: string) => item.divisionId === divisionId ? itemAnnualCost(item) : 0;

export function calculateDivisionFinancials(input: BudgetFinancialInput, divisionId: string): DivisionFinancials {
  const division = input.divisions.find((item) => item.id === divisionId);
  const items = [...new Map(input.planningItems.map((item) => [item.id, item])).values()];
  const categoryPresent = (category: PlanningItem['category']) => items.some((item) => item.category === category && (
    category === 'labour' ? isLabourAllocatedToDivision(item, divisionId)
      : category === 'equipment' ? finiteNonNegative(equipmentMonths(item, divisionId)) > 0
        : item.divisionId === divisionId
  ));
  const missingCategories = (['labour', 'equipment', 'materials', 'subcontractors'] as const)
    .filter((category) => !categoryPresent(category));
  const isComplete = missingCategories.length === 0;
  const directLabour = items.filter((item) => item.category === 'labour').reduce((sum, item) => sum + calculateDivisionLabourShare(item, divisionId).directLabourCost, 0);
  const overheadLabour = items.filter((item) => item.category === 'labour').reduce((sum, item) => sum + calculateDivisionLabourShare(item, divisionId).overheadLabourCost, 0);
  const directEquipment = items.filter((item) => item.category === 'equipment' && item.classification !== 'overhead').reduce((sum, item) => sum + equipmentShare(item, divisionId), 0);
  const overheadEquipment = items.filter((item) => item.category === 'equipment' && item.classification === 'overhead').reduce((sum, item) => sum + equipmentShare(item, divisionId), 0);
  const materials = items.filter((item) => item.category === 'materials').reduce((sum, item) => sum + localItemCost(item, divisionId), 0);
  const subcontractors = items.filter((item) => item.category === 'subcontractors').reduce((sum, item) => sum + localItemCost(item, divisionId), 0);
  const divisionOverhead = items.filter((item) => item.category === 'overhead').reduce((sum, item) => sum + localItemCost(item, divisionId), 0);
  const revenue = finiteNonNegative(division?.revenueTarget);
  const totalDirectCosts = directLabour + directEquipment + materials + subcontractors;
  const grossProfit = isComplete ? revenue - totalDirectCosts : null;
  const grossMargin = grossProfit !== null && revenue > 0 ? grossProfit / revenue * 100 : null;
  const totalOverheadBeforeCompany = overheadLabour + overheadEquipment + divisionOverhead;
  const operatingProfitBeforeCompanyOverhead = grossProfit === null ? null : grossProfit - totalOverheadBeforeCompany;
  const operatingMarginBeforeCompanyOverhead = operatingProfitBeforeCompanyOverhead !== null && revenue > 0
    ? operatingProfitBeforeCompanyOverhead / revenue * 100
    : null;

  return {
    divisionId,
    divisionName: division?.name ?? 'Division',
    revenue,
    directLabour,
    directEquipment,
    materials,
    subcontractors,
    totalDirectCosts,
    grossProfit,
    grossMargin,
    overheadLabour,
    overheadEquipment,
    divisionOverhead,
    allocatedCompanyOverhead: null,
    totalOverheadBeforeCompany,
    operatingProfitBeforeCompanyOverhead,
    operatingMarginBeforeCompanyOverhead,
    isComplete,
    missingCategories,
  };
}

export function calculateBudgetFinancials(input: BudgetFinancialInput) {
  const divisions = input.divisions.filter((item) => item.status === 'active').map((division) => calculateDivisionFinancials(input, division.id));
  const companyOverhead = (input.companyOverheadItems ?? []).reduce((sum, item) => sum + finiteNonNegative(item.budgeted), 0);
  const total = (field: keyof DivisionFinancials) => divisions.reduce((sum, division) => sum + (typeof division[field] === 'number' ? division[field] : 0), 0);
  const revenue = total('revenue');
  const totalDirectCosts = total('totalDirectCosts');
  const isComplete = divisions.length > 0 && divisions.every((division) => division.isComplete);
  const grossProfit = isComplete ? revenue - totalDirectCosts : null;
  const grossMargin = grossProfit !== null && revenue > 0 ? grossProfit / revenue * 100 : null;
  const totalDivisionOverhead = total('overheadLabour') + total('overheadEquipment') + total('divisionOverhead');
  const totalOverhead = totalDivisionOverhead + companyOverhead;
  const operatingProfit = grossProfit === null ? null : grossProfit - totalOverhead;
  const operatingMargin = operatingProfit !== null && revenue > 0 ? operatingProfit / revenue * 100 : null;

  return {
    divisions,
    revenue,
    directLabour: total('directLabour'),
    directEquipment: total('directEquipment'),
    materials: total('materials'),
    subcontractors: total('subcontractors'),
    totalDirectCosts,
    grossProfit,
    grossMargin,
    overheadLabour: total('overheadLabour'),
    overheadEquipment: total('overheadEquipment'),
    divisionOverhead: total('divisionOverhead'),
    companyOverhead,
    totalOverhead,
    operatingProfit,
    operatingMargin,
    isComplete,
    companyOverheadAllocated: false,
  };
}

export function calculateBudgetItemAnnualCost(item: PlanningItem) {
  return itemAnnualCost(item);
}

export type BudgetFinancials = ReturnType<typeof calculateBudgetFinancials>;