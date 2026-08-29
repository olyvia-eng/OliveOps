import type { EquipmentClassification, EquipmentCostType, EquipmentRentalUnit } from '../../types';

export interface EquipmentInfoFormValue {
  description: string;
  costCode: string;
  equipmentCostType: EquipmentCostType;
  equipmentClassification: EquipmentClassification;
  equipmentPayment: number;
  equipmentPaymentFrequencyPerYear: number;
  yearlyFuelCost: number;
  yearlyInsuranceCost: number;
  yearlyMaintenanceCost: number;
  sellableHoursPerYear: number;
  equipmentHoursPerDay: number;
  rentalCost: number;
  rentalUnit: EquipmentRentalUnit;
}

export const emptyEquipmentInfoFormValue = (): EquipmentInfoFormValue => ({
  description: '',
  costCode: '',
  equipmentCostType: 'financed',
  equipmentClassification: 'billable',
  equipmentPayment: 0,
  equipmentPaymentFrequencyPerYear: 12,
  yearlyFuelCost: 0,
  yearlyInsuranceCost: 0,
  yearlyMaintenanceCost: 0,
  sellableHoursPerYear: 0,
  equipmentHoursPerDay: 8,
  rentalCost: 0,
  rentalUnit: 'day',
});

export const validateEquipmentInfoForm = (value: EquipmentInfoFormValue) => {
  if (!value.description.trim()) return 'Equipment name is required.';
  if (!['billable', 'overhead'].includes(value.equipmentClassification)) return 'Select a valid equipment classification.';
  if (!['owned', 'financed', 'leased', 'rental'].includes(value.equipmentCostType)) return 'Select a valid ownership / source.';
  if (value.equipmentCostType === 'rental' && !['hr', 'day', 'week', 'month'].includes(value.rentalUnit)) return 'Select a valid rental unit.';

  const numericFields = [
    ['Payment', value.equipmentPayment],
    ['Payment frequency', value.equipmentPaymentFrequencyPerYear],
    ['Yearly fuel cost', value.yearlyFuelCost],
    ['Yearly insurance cost', value.yearlyInsuranceCost],
    ['Yearly maintenance cost', value.yearlyMaintenanceCost],
    ['Rental cost', value.rentalCost],
  ] as const;
  const invalidField = numericFields.find(([, fieldValue]) => !Number.isFinite(fieldValue) || fieldValue < 0);
  return invalidField ? `${invalidField[0]} must be zero or greater.` : null;
};

export const normalizeEquipmentInfoForm = (value: EquipmentInfoFormValue): EquipmentInfoFormValue => ({
  ...value,
  description: value.description.trim(),
  costCode: value.costCode.trim(),
  equipmentPayment: value.equipmentCostType === 'owned' ? 0 : Math.max(0, Number(value.equipmentPayment || 0)),
  equipmentPaymentFrequencyPerYear: value.equipmentCostType === 'owned' ? 0 : Math.max(0, Number(value.equipmentPaymentFrequencyPerYear || 0)),
  yearlyFuelCost: Math.max(0, Number(value.yearlyFuelCost || 0)),
  yearlyInsuranceCost: Math.max(0, Number(value.yearlyInsuranceCost || 0)),
  yearlyMaintenanceCost: Math.max(0, Number(value.yearlyMaintenanceCost || 0)),
  sellableHoursPerYear: Math.max(0, Number(value.sellableHoursPerYear || 0)),
  equipmentHoursPerDay: Math.max(0, Number(value.equipmentHoursPerDay || 0)),
  rentalCost: Math.max(0, Number(value.rentalCost || 0)),
});
