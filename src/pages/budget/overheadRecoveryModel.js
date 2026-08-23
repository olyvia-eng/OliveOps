import { overheadAllocatedAmount } from './overheadAllocationModel.js';

const CATEGORIES = ['labour', 'equipment', 'materials', 'subcontractors'];

const nonNegative = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const annualLabour = (item) => {
  const hours = nonNegative(item.plannedHours);
  const regular = item.compType === 'salaried' ? nonNegative(item.annualSalary) : nonNegative(item.hourlyRate) * hours;
  const overtime = item.compType === 'salaried' ? 0 : nonNegative(item.hourlyRate) * nonNegative(item.overtimeHours) * Math.max(1, nonNegative(item.overtimeMultiplier) || 1.5);
  const burden = (regular + overtime) * (nonNegative(item.payrollBurdenPct ?? item.labourBurdenPct) / 100);
  return regular + overtime + burden + nonNegative(item.benefitsExtraCost) + nonNegative(item.bonus);
};

const labourShare = (item, divisionId) => {
  const allocation = item.divisionAllocations?.find((value) => value.divisionId === divisionId);
  if (allocation?.hours !== undefined && nonNegative(item.plannedHours) > 0) return nonNegative(allocation.hours) / nonNegative(item.plannedHours);
  if (allocation?.percentage !== undefined) return nonNegative(allocation.percentage) / 100;
  return item.divisionId === divisionId ? 1 : 0;
};

const billableLabourHours = (item) => item.labourClassification === 'overhead'
  ? 0
  : nonNegative(item.plannedHours) * Math.min(100, nonNegative(item.expectedBillablePct)) / 100;

const equipmentAnnualCost = (item) => item.plannedAmount !== undefined
  ? nonNegative(item.plannedAmount)
  : nonNegative(item.equipmentPayment) * nonNegative(item.equipmentPaymentFrequencyPerYear ?? item.paymentFrequencyPerYear ?? 1)
    + nonNegative(item.yearlyFuelCost)
    + nonNegative(item.yearlyInsuranceCost)
    + nonNegative(item.yearlyMaintenanceCost);

const equipmentMonths = (item, divisionId) => item.equipmentDivisionAllocations?.find((value) => value.divisionId === divisionId)?.months
  ?? (item.divisionId === divisionId ? item.allocationMonths ?? 12 : 0);

const equipmentHours = (item, divisionId) => nonNegative(item.equipmentDivisionAllocations?.find((value) => value.divisionId === divisionId)?.sellableHours);

const plannedCost = (item) => nonNegative(item.category === 'materials' ? item.unitCost : item.rate) * nonNegative(item.plannedQuantity);

export const emptyRecoveryAllocation = () => ({ labourPercent: 0, equipmentPercent: 0, materialsPercent: 0, subcontractorsPercent: 0 });

export const recoveryAllocationTotal = (allocation) => CATEGORIES.reduce((sum, category) => sum + nonNegative(allocation?.[`${category}Percent`]), 0);

export const recoveryAllocationIsValid = (allocation) => Math.abs(recoveryAllocationTotal(allocation) - 100) < 0.001;

const buildScope = ({ label, totalOverhead, policy, denominators }) => {
  const allocation = policy?.version === 2 ? policy.allocation : emptyRecoveryAllocation();
  const allocationTotal = recoveryAllocationTotal(allocation);
  const configured = policy?.version === 2;
  const valid = configured && recoveryAllocationIsValid(allocation);
  const pools = Object.fromEntries(CATEGORIES.map((category) => [category, totalOverhead * nonNegative(allocation[`${category}Percent`]) / 100]));
  const rates = { labour: 0, equipment: 0, materials: 0, subcontractors: 0 };
  const warnings = [];
  let recoverableAmount = 0;

  if (valid) {
    for (const category of CATEGORIES) {
      if (pools[category] > 0 && denominators[category] <= 0) {
        const denominatorLabel = category === 'labour' ? 'billable labour hours' : category === 'equipment' ? 'sellable equipment hours' : `planned ${category === 'materials' ? 'material' : 'subcontractor'} cost`;
        warnings.push(`${label} assigns $${pools[category].toFixed(2)} to ${category} recovery, but no ${denominatorLabel} are planned.`);
        continue;
      }
      if (denominators[category] > 0) {
        rates[category] = pools[category] / denominators[category];
        recoverableAmount += pools[category];
      }
    }
  }

  return {
    totalOverhead,
    configured,
    valid,
    allocation,
    allocationTotal,
    pools,
    denominators,
    rates,
    recoverableAmount,
    unrecoverableAmount: Math.max(0, totalOverhead - recoverableAmount),
    warnings,
  };
};

export function buildOverheadRecoveryModel({ budget, divisions, planningItems }) {
  const uniqueItems = [...new Map(planningItems.filter((item) => item.budgetId === budget.id).map((item) => [item.id, item])).values()];
  const divisionScopes = {};

  for (const division of divisions.filter((item) => item.budgetId === budget.id && item.status === 'active')) {
    const overheadLabour = uniqueItems.filter((item) => item.category === 'labour' && item.labourClassification === 'overhead').reduce((sum, item) => sum + annualLabour(item) * labourShare(item, division.id), 0);
    const overheadEquipment = uniqueItems.filter((item) => item.category === 'equipment' && item.classification === 'overhead').reduce((sum, item) => sum + equipmentAnnualCost(item) * nonNegative(equipmentMonths(item, division.id)) / 12, 0);
    const overheadItems = uniqueItems.filter((item) => item.category === 'overhead').reduce((sum, item) => sum + overheadAllocatedAmount(item, division.id), 0);
    const denominators = {
      labour: uniqueItems.filter((item) => item.category === 'labour').reduce((sum, item) => sum + billableLabourHours(item) * labourShare(item, division.id), 0),
      equipment: uniqueItems.filter((item) => item.category === 'equipment' && item.classification !== 'overhead').reduce((sum, item) => sum + equipmentHours(item, division.id), 0),
      materials: uniqueItems.filter((item) => item.category === 'materials' && item.divisionId === division.id).reduce((sum, item) => sum + plannedCost(item), 0),
      subcontractors: uniqueItems.filter((item) => item.category === 'subcontractors' && item.divisionId === division.id).reduce((sum, item) => sum + plannedCost(item), 0),
    };
    divisionScopes[division.id] = buildScope({
      label: `${division.name} Division Overhead`,
      totalOverhead: overheadLabour + overheadEquipment + overheadItems,
      policy: division.overheadRecoveryPolicy,
      denominators,
    });
  }

  return { divisions: divisionScopes };
}

export function recoveryPerUnit(scope, category, directCostPerUnit) {
  if (!scope?.valid) return 0;
  if (category === 'materials' || category === 'subcontractors') return nonNegative(directCostPerUnit) * nonNegative(scope.rates[category]);
  return nonNegative(scope.rates[category]);
}

export function grossMarginRate(recoveredCostPerUnit, targetMarginPct) {
  const cost = nonNegative(recoveredCostPerUnit);
  const margin = Math.min(99, nonNegative(targetMarginPct));
  return cost > 0 ? cost / (1 - margin / 100) : 0;
}