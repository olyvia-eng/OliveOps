import type { EquipmentClassification, EquipmentCostType } from '../../types';

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
});

export const validateEquipmentInfoForm = (value: EquipmentInfoFormValue) => (
  value.description.trim() ? null : 'Equipment name is required.'
);

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
});
