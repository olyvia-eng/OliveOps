import type { SubcontractorCatalogItem } from '../../types';

export type SubcontractorFormValue = Pick<SubcontractorCatalogItem, 'name' | 'contactName' | 'email' | 'phone' | 'trade' | 'unit' | 'defaultUnitCost' | 'notes'>;

export const emptySubcontractorFormValue = (): SubcontractorFormValue => ({
  name: '',
  trade: '',
  contactName: '',
  email: '',
  phone: '',
  unit: 'job',
  defaultUnitCost: 0,
  notes: '',
});

export const validateSubcontractorForm = (value: SubcontractorFormValue) => {
  if (!value.name.trim() || !value.unit.trim() || !Number.isFinite(value.defaultUnitCost) || value.defaultUnitCost < 0) {
    return 'Enter a company name, unit, and default cost of zero or greater.';
  }
  return null;
};

export const normalizeSubcontractorForm = (value: SubcontractorFormValue): SubcontractorFormValue => ({
  name: value.name.trim(),
  trade: value.trade?.trim() ?? '',
  contactName: value.contactName?.trim() ?? '',
  email: value.email?.trim() ?? '',
  phone: value.phone?.trim() ?? '',
  unit: value.unit.trim(),
  defaultUnitCost: Math.max(0, Number(value.defaultUnitCost || 0)),
  notes: value.notes.trim(),
});