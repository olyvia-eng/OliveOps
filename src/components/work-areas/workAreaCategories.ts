import type { LineItemCategory } from '../../types';

export const WORK_AREA_CATEGORY_ORDER: LineItemCategory[] = ['labour', 'equipment', 'material', 'subcontractor'];

export const WORK_AREA_CATEGORY_LABEL: Record<LineItemCategory, string> = {
  labour: 'Labour',
  equipment: 'Equipment',
  material: 'Materials',
  subcontractor: 'Subcontractors',
};

export const WORK_AREA_CATEGORY_ADD_LABEL: Record<LineItemCategory, string> = {
  labour: 'Labour',
  equipment: 'Equipment',
  material: 'Material',
  subcontractor: 'Subcontractor',
};