export const createCustomBillLine = () => ({
  description: '',
  quantity: 1,
  unit: 'ea',
  unitCost: 0,
  workAreaId: '',
});

export const createMaterialBillLine = (material, workAreaId = '') => ({
  materialCatalogItemId: material.id,
  description: material.name,
  quantity: 1,
  unit: material.unit,
  unitCost: material.defaultUnitCost,
  workAreaId,
});

export const createSubcontractorBillLine = (subcontractor, workAreaId = '') => ({
  description: subcontractor.trade || subcontractor.name,
  quantity: 1,
  unit: subcontractor.unit,
  unitCost: subcontractor.defaultUnitCost,
  workAreaId,
});

export const calculateBillDraftTotals = (lines, taxRate) => {
  const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const subtotal = money(lines.reduce((total, line) => total + Number(line.quantity || 0) * Number(line.unitCost || 0), 0));
  const normalizedTaxRate = Number.isFinite(taxRate) ? Math.min(100, Math.max(0, taxRate)) : 0;
  const tax = money(subtotal * normalizedTaxRate / 100);
  return { subtotal, tax, total: money(subtotal + tax) };
};