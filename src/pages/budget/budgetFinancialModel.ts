import type { BudgetDivision, BudgetDivisionPlanningItem, EquipmentAsset } from '../../types';
import { calculateAnnualEquipmentCost, calculateEquipmentCostBreakdown, resolveEquipmentClassification } from '../../utils/equipmentPricing';
import { calculateDivisionLabourShare, isLabourAllocatedToDivision } from './divisionLabourPlanningModel';
import { overheadAllocatedAmount } from './overheadAllocationModel.js';

type PlanningItem = Partial<BudgetDivisionPlanningItem> & Pick<BudgetDivisionPlanningItem, 'id' | 'budgetId' | 'divisionId' | 'category'>;

export interface BudgetFinancialInput {
  divisions: BudgetDivision[];
  planningItems: PlanningItem[];
  equipmentAssets?: EquipmentAsset[];
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

export interface EquipmentCostComposition {
  maintenance: number;
  fuel: number;
  insurance: number;
  replacementReserve: number;
  paymentsOther: number;
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
  equipmentCostComposition: EquipmentCostComposition;
  plannedBillableHours: number;
  revenuePerHour: number | null;
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

const itemAnnualCost = (item: PlanningItem, equipmentAsset?: EquipmentAsset) => {
  if (item.category === 'equipment') return calculateAnnualEquipmentCost({ ...item, costType: equipmentAsset?.costType ?? item.costType });
  if (item.plannedAmount !== undefined) return finiteNonNegative(item.plannedAmount);
  return finiteNonNegative(item.unitCost ?? item.rate) * finiteNonNegative(item.plannedQuantity ?? 1);
};

const equipmentMonths = (item: PlanningItem, divisionId: string) => item.equipmentDivisionAllocations?.find((allocation) => allocation.divisionId === divisionId)?.months
  ?? (item.divisionId === divisionId ? item.allocationMonths ?? 12 : 0);

const equipmentShare = (item: PlanningItem, divisionId: string, equipmentAsset?: EquipmentAsset) => itemAnnualCost(item, equipmentAsset) * finiteNonNegative(equipmentMonths(item, divisionId)) / 12;

const allocatedEquipmentComponent = (item: PlanningItem, divisionId: string, value: number | undefined) => (
  finiteNonNegative(value) * finiteNonNegative(equipmentMonths(item, divisionId)) / 12
);

const equipmentComposition = (items: PlanningItem[], equipmentById: Map<string, EquipmentAsset>, divisionId: string, total: number): EquipmentCostComposition => {
  const directEquipment = items.filter((item) => item.category === 'equipment' && resolveEquipmentClassification(item, equipmentById.get(item.equipmentId ?? '')) !== 'overhead');
  const maintenance = directEquipment.reduce((sum, item) => sum + allocatedEquipmentComponent(item, divisionId, item.yearlyMaintenanceCost), 0);
  const fuel = directEquipment.reduce((sum, item) => sum + allocatedEquipmentComponent(item, divisionId, item.yearlyFuelCost), 0);
  const insurance = directEquipment.reduce((sum, item) => sum + allocatedEquipmentComponent(item, divisionId, item.yearlyInsuranceCost), 0);
  const replacementReserve = directEquipment.reduce((sum, item) => {
    const costType = equipmentById.get(item.equipmentId ?? '')?.costType ?? item.costType;
    if (costType !== 'owned') return sum;
    const breakdown = calculateEquipmentCostBreakdown({
      equipmentCostType: costType,
      equipmentPayment: finiteNonNegative(item.equipmentPayment),
      equipmentPaymentFrequencyPerYear: finiteNonNegative(item.equipmentPaymentFrequencyPerYear ?? item.paymentFrequencyPerYear),
      yearlyFuelCost: finiteNonNegative(item.yearlyFuelCost),
      yearlyInsuranceCost: finiteNonNegative(item.yearlyInsuranceCost),
      yearlyMaintenanceCost: finiteNonNegative(item.yearlyMaintenanceCost),
      expectedReplacementCost: item.expectedReplacementCost,
      expectedResaleValue: item.expectedResaleValue,
      remainingUsefulMonths: item.remainingUsefulMonths,
      sellableHoursPerYear: finiteNonNegative(item.sellableHoursPerYear ?? item.utilizationHours),
      equipmentHoursPerDay: finiteNonNegative(item.equipmentHoursPerDay),
    });
    return sum + allocatedEquipmentComponent(item, divisionId, breakdown.annualReplacementReserve);
  }, 0);
  return { maintenance, fuel, insurance, replacementReserve, paymentsOther: total - maintenance - fuel - insurance - replacementReserve };
};

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
  const equipmentById = new Map((input.equipmentAssets ?? []).map((item) => [item.id, item]));
  const categoryPresent = (category: PlanningItem['category']) => items.some((item) => item.category === category && (
    category === 'labour' ? isLabourAllocatedToDivision(item, divisionId)
      : category === 'equipment' ? finiteNonNegative(equipmentMonths(item, divisionId)) > 0
        : item.divisionId === divisionId
  ));
  const missingCategories = (['labour', 'equipment', 'materials', 'subcontractors'] as const)
    .filter((category) => !categoryPresent(category));
  const isComplete = missingCategories.length === 0;
  const labourShares = items.filter((item) => item.category === 'labour')
    .map((item) => ({ item, share: calculateDivisionLabourShare(item, divisionId) }));
  const directLabourItems = items.filter((item) => item.category === 'labour')
    .map((item) => directCostDetail(item, 'labour', labourShares.find((entry) => entry.item.id === item.id)?.share.directLabourCost ?? 0))
    .filter((item) => item.amount > 0);
  const directLabour = directLabourItems.reduce((sum, item) => sum + item.amount, 0);
  const plannedBillableHours = labourShares.reduce((sum, entry) => sum + entry.share.expectedBillableHours, 0);
  const overheadLabourItems = labourShares
    .map(({ item, share }) => overheadDetail(item, 'labour', share.overheadLabourCost))
    .filter((item) => item.amount > 0);
  const directEquipmentItems = items.filter((item) => item.category === 'equipment' && resolveEquipmentClassification(item, equipmentById.get(item.equipmentId ?? '')) !== 'overhead')
    .map((item) => directCostDetail({ ...item, name: equipmentById.get(item.equipmentId ?? '')?.name ?? item.name }, 'equipment', equipmentShare(item, divisionId, equipmentById.get(item.equipmentId ?? ''))))
    .filter((item) => item.amount > 0);
  const directEquipment = directEquipmentItems.reduce((sum, item) => sum + item.amount, 0);
  const equipmentCostComposition = equipmentComposition(items, equipmentById, divisionId, directEquipment);
  const overheadEquipmentItems = items
    .filter((item) => item.category === 'equipment' && resolveEquipmentClassification(item, equipmentById.get(item.equipmentId ?? '')) === 'overhead')
    .map((item) => overheadDetail({ ...item, name: equipmentById.get(item.equipmentId ?? '')?.name ?? item.name }, 'equipment', equipmentShare(item, divisionId, equipmentById.get(item.equipmentId ?? ''))))
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
  const revenuePerHour = plannedBillableHours > 0 ? revenue / plannedBillableHours : null;
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
    equipmentCostComposition,
    plannedBillableHours,
    revenuePerHour,
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
  const equipmentCostComposition = divisions.reduce((composition, division) => ({
    maintenance: composition.maintenance + division.equipmentCostComposition.maintenance,
    fuel: composition.fuel + division.equipmentCostComposition.fuel,
    insurance: composition.insurance + division.equipmentCostComposition.insurance,
    replacementReserve: composition.replacementReserve + division.equipmentCostComposition.replacementReserve,
    paymentsOther: composition.paymentsOther + division.equipmentCostComposition.paymentsOther,
  }), { maintenance: 0, fuel: 0, insurance: 0, replacementReserve: 0, paymentsOther: 0 });
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
    equipmentCostComposition,
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