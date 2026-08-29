import type { BudgetDivision, BudgetDivisionPlanningItem } from '../../types';
import { calculateDivisionLabourShare, isLabourAllocatedToDivision } from './divisionLabourPlanningModel';
import { overheadAllocatedAmount } from './overheadAllocationModel.js';

type PlanningItem = Partial<BudgetDivisionPlanningItem> & Pick<BudgetDivisionPlanningItem, 'id' | 'budgetId' | 'divisionId' | 'category'>;

export interface BudgetFinancialInput {
  divisions: BudgetDivision[];
  planningItems: PlanningItem[];
}

export type OverheadDetailCategory = 'labour' | 'equipment' | 'other';
export type DirectCostDetailCategory = 'labour' | 'equipment' | 'materials' | 'subcontractors';

export interface OverheadDetailItem {
  itemId: string;
  name: string;
  category: OverheadDetailCategory;
  amount: number;
}

export interface DirectCostDetailItem {
  itemId: string;
  name: string;
  category: DirectCostDetailCategory;
  amount: number;
}

export interface DivisionFinancials {
  divisionId: string;
  divisionName: string;
  revenue: number;
  directLabour: number;
  directEquipment: number;
  materials: number;
  subcontractors: number;
  directCostItems: DirectCostDetailItem[];
  totalDirectCosts: number;
  grossProfit: number | null;
  grossMargin: number | null;
  overheadLabour: number;
  overheadEquipment: number;
  allocatedOverhead: number;
  overheadItems: OverheadDetailItem[];
  totalOverhead: number;
  operatingProfit: number | null;
  operatingMargin: number | null;
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

const overheadItemName = (item: PlanningItem, category: OverheadDetailCategory) => (
  item.name?.trim()
  || item.description?.trim()
  || (item.legacyBudgetItemId ? 'Legacy overhead item' : category === 'labour' ? 'Overhead labour' : category === 'equipment' ? 'Overhead equipment' : 'Other overhead')
);

const overheadDetail = (item: PlanningItem, category: OverheadDetailCategory, amount: number): OverheadDetailItem => ({
  itemId: item.id,
  name: overheadItemName(item, category),
  category,
  amount,
});

const directCostDetail = (item: PlanningItem, category: DirectCostDetailCategory, amount: number): DirectCostDetailItem => ({
  itemId: item.id,
  name: item.name?.trim() || item.description?.trim() || (item.legacyBudgetItemId ? 'Legacy budget item' : category === 'labour' ? 'Labour' : category === 'equipment' ? 'Equipment' : category === 'materials' ? 'Material' : 'Subcontractor'),
  category,
  amount,
});

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
  const directLabourItems = items.filter((item) => item.category === 'labour')
    .map((item) => directCostDetail(item, 'labour', calculateDivisionLabourShare(item, divisionId).directLabourCost))
    .filter((item) => item.amount > 0);
  const directLabour = directLabourItems.reduce((sum, item) => sum + item.amount, 0);
  const overheadLabourItems = items
    .filter((item) => item.category === 'labour')
    .map((item) => overheadDetail(item, 'labour', calculateDivisionLabourShare(item, divisionId).overheadLabourCost))
    .filter((item) => item.amount > 0);
  const directEquipmentItems = items.filter((item) => item.category === 'equipment' && item.classification !== 'overhead')
    .map((item) => directCostDetail(item, 'equipment', equipmentShare(item, divisionId)))
    .filter((item) => item.amount > 0);
  const directEquipment = directEquipmentItems.reduce((sum, item) => sum + item.amount, 0);
  const overheadEquipmentItems = items
    .filter((item) => item.category === 'equipment' && item.classification === 'overhead')
    .map((item) => overheadDetail(item, 'equipment', equipmentShare(item, divisionId)))
    .filter((item) => item.amount > 0);
  const materialItems = items.filter((item) => item.category === 'materials')
    .map((item) => directCostDetail(item, 'materials', localItemCost(item, divisionId)))
    .filter((item) => item.amount > 0);
  const materials = materialItems.reduce((sum, item) => sum + item.amount, 0);
  const subcontractorItems = items.filter((item) => item.category === 'subcontractors')
    .map((item) => directCostDetail(item, 'subcontractors', localItemCost(item, divisionId)))
    .filter((item) => item.amount > 0);
  const subcontractors = subcontractorItems.reduce((sum, item) => sum + item.amount, 0);
  const directCostItems = [...directLabourItems, ...directEquipmentItems, ...materialItems, ...subcontractorItems];
  const otherOverheadItems = items
    .filter((item) => item.category === 'overhead')
    .map((item) => overheadDetail(item, 'other', overheadAllocatedAmount(item, divisionId)))
    .filter((item) => item.amount > 0);
  const overheadItems = [...overheadLabourItems, ...overheadEquipmentItems, ...otherOverheadItems];
  const overheadLabour = overheadLabourItems.reduce((sum, item) => sum + item.amount, 0);
  const overheadEquipment = overheadEquipmentItems.reduce((sum, item) => sum + item.amount, 0);
  const allocatedOverhead = otherOverheadItems.reduce((sum, item) => sum + item.amount, 0);
  const revenue = finiteNonNegative(division?.revenueTarget);
  const totalDirectCosts = directLabour + directEquipment + materials + subcontractors;
  const grossProfit = isComplete ? revenue - totalDirectCosts : null;
  const grossMargin = grossProfit !== null && revenue > 0 ? grossProfit / revenue * 100 : null;
  const totalOverhead = overheadItems.reduce((sum, item) => sum + item.amount, 0);
  const operatingProfit = grossProfit === null ? null : grossProfit - totalOverhead;
  const operatingMargin = operatingProfit !== null && revenue > 0
    ? operatingProfit / revenue * 100
    : null;

  return {
    divisionId,
    divisionName: division?.name ?? 'Division',
    revenue,
    directLabour,
    directEquipment,
    materials,
    subcontractors,
    directCostItems,
    totalDirectCosts,
    grossProfit,
    grossMargin,
    overheadLabour,
    overheadEquipment,
    allocatedOverhead,
    overheadItems,
    totalOverhead,
    operatingProfit,
    operatingMargin,
    isComplete,
    missingCategories,
  };
}

export function calculateBudgetFinancials(input: BudgetFinancialInput) {
  const divisions = input.divisions.filter((item) => item.status === 'active').map((division) => calculateDivisionFinancials(input, division.id));
  const total = (field: keyof DivisionFinancials) => divisions.reduce((sum, division) => sum + (typeof division[field] === 'number' ? division[field] : 0), 0);
  const revenue = total('revenue');
  const totalDirectCosts = total('totalDirectCosts');
  const isComplete = divisions.length > 0 && divisions.every((division) => division.isComplete);
  const grossProfit = isComplete ? revenue - totalDirectCosts : null;
  const grossMargin = grossProfit !== null && revenue > 0 ? grossProfit / revenue * 100 : null;
  const directCostItems = [...divisions.reduce((items, division) => {
    for (const item of division.directCostItems) {
      const key = `${item.category}:${item.itemId}`;
      const existing = items.get(key);
      items.set(key, existing ? { ...existing, amount: existing.amount + item.amount } : { ...item });
    }
    return items;
  }, new Map<string, DirectCostDetailItem>()).values()];
  const overheadItems = [...divisions.reduce((items, division) => {
    for (const item of division.overheadItems) {
      const key = `${item.category}:${item.itemId}`;
      const existing = items.get(key);
      items.set(key, existing ? { ...existing, amount: existing.amount + item.amount } : { ...item });
    }
    return items;
  }, new Map<string, OverheadDetailItem>()).values()];
  const totalOverhead = overheadItems.reduce((sum, item) => sum + item.amount, 0);
  const operatingProfit = grossProfit === null ? null : grossProfit - totalOverhead;
  const operatingMargin = operatingProfit !== null && revenue > 0 ? operatingProfit / revenue * 100 : null;

  return {
    divisions,
    revenue,
    directLabour: total('directLabour'),
    directEquipment: total('directEquipment'),
    materials: total('materials'),
    subcontractors: total('subcontractors'),
    directCostItems,
    totalDirectCosts,
    grossProfit,
    grossMargin,
    overheadLabour: total('overheadLabour'),
    overheadEquipment: total('overheadEquipment'),
    allocatedOverhead: total('allocatedOverhead'),
    overheadItems,
    totalOverhead,
    operatingProfit,
    operatingMargin,
    isComplete,
  };
}

export function calculateBudgetItemAnnualCost(item: PlanningItem) {
  return itemAnnualCost(item);
}

export type BudgetFinancials = ReturnType<typeof calculateBudgetFinancials>;