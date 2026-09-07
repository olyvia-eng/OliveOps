import type { MaterialCatalogItem, SubcontractorCatalogItem } from '../../types';

export type BillLineDraft = {
  id?: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  workAreaId: string;
  materialCatalogItemId?: string;
};

export function createCustomBillLine(): BillLineDraft;
export function createMaterialBillLine(material: MaterialCatalogItem, workAreaId?: string): BillLineDraft;
export function createSubcontractorBillLine(subcontractor: SubcontractorCatalogItem, workAreaId?: string): BillLineDraft;
export function calculateBillDraftTotals(lines: BillLineDraft[], taxRate: number): { subtotal: number; tax: number; total: number };