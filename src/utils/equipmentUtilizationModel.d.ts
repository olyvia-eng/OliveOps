export type EquipmentUtilizationBasis = 'annualHours' | 'operatingDays';
export type EquipmentUtilizationField = 'annualHours' | 'operatingDays' | 'hoursPerDay';

export interface EquipmentUtilizationValue {
  sellableHoursPerYear: number;
  equipmentHoursPerDay: number;
}

export interface SynchronizedEquipmentUtilization extends EquipmentUtilizationValue {
  basis: EquipmentUtilizationBasis;
  operatingDays: number;
}

export function deriveOperatingDays(sellableHoursPerYear: number, equipmentHoursPerDay: number): number;

export function synchronizeEquipmentUtilization(
  value: EquipmentUtilizationValue,
  basis: EquipmentUtilizationBasis,
  editedField: EquipmentUtilizationField,
  editedValue: number,
  operatingDays: number,
): SynchronizedEquipmentUtilization;