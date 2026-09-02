const CATEGORIES = new Set(['labour', 'equipment', 'material', 'subcontractor']);

function stableId(prefix, seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function categoryOf(value) {
  return CATEGORIES.has(value) ? value : 'labour';
}

function canonicalSourceId(line, category) {
  if (category === 'labour') return line.labourClassId ?? (!line.employeeId ? line.sourceEntityId : undefined);
  if (category === 'equipment') return line.equipmentId ?? line.sourceEntityId;
  if (category === 'material') return line.materialCatalogItemId ?? line.sourceEntityId;
  return line.subcontractorCatalogItemId ?? line.vendorId ?? line.sourceEntityId;
}

function normalizeLine(templateId, areaId, line, index) {
  const category = categoryOf(line?.category);
  const sourceEntityId = canonicalSourceId(line ?? {}, category);
  const description = typeof line?.description === 'string' ? line.description : '';
  const itemName = typeof line?.itemName === 'string' && line.itemName.trim()
    ? line.itemName
    : description || `${category.charAt(0).toUpperCase()}${category.slice(1)} item`;
  return {
    id: typeof line?.id === 'string' && line.id ? line.id : stableId('legacy-template-line', `${templateId}:${areaId}:${index}:${category}:${itemName}`),
    category,
    sourceEntityId,
    itemName,
    description,
    quantity: Math.max(0, numberOr(line?.quantity, 1)),
    unit: typeof line?.unit === 'string' && line.unit.trim() ? line.unit : category === 'labour' || category === 'equipment' ? 'hr' : 'unit',
    sortOrder: numberOr(line?.sortOrder, index),
    pricingReadiness: sourceEntityId && line?.pricingReadiness !== 'needs_review' ? 'ready' : 'needs_review',
  };
}

function normalizeArea(templateId, area, index) {
  const name = typeof area?.name === 'string' && area.name.trim() ? area.name : `Work Area ${index + 1}`;
  const id = typeof area?.id === 'string' && area.id ? area.id : stableId('legacy-template-area', `${templateId}:${index}:${name}`);
  return {
    id,
    name,
    description: typeof area?.description === 'string' ? area.description : '',
    sortOrder: numberOr(area?.sortOrder, index),
    lineItems: (Array.isArray(area?.lineItems) ? area.lineItems : []).map((line, lineIndex) => normalizeLine(templateId, id, line, lineIndex)),
  };
}

export function normalizeEstimateTemplate(template) {
  const templateId = typeof template?.id === 'string' ? template.id : 'new-template';
  let workAreas = Array.isArray(template?.workAreas) && template.workAreas.length
    ? template.workAreas.map((area, index) => normalizeArea(templateId, area, index))
    : [];
  if (!workAreas.length && Array.isArray(template?.lineItems) && template.lineItems.length) {
    workAreas = [normalizeArea(templateId, {
      name: 'General',
      description: '',
      sortOrder: 0,
      lineItems: template.lineItems,
    }, 0)];
  }
  return {
    id: templateId,
    schemaVersion: 2,
    name: typeof template?.name === 'string' ? template.name : '',
    description: typeof template?.description === 'string' ? template.description : '',
    proposalNotes: typeof template?.proposalNotes === 'string' ? template.proposalNotes : typeof template?.notes === 'string' ? template.notes : '',
    workAreas: workAreas.sort((left, right) => left.sortOrder - right.sortOrder).map((area, index) => ({
      ...area,
      sortOrder: index,
      lineItems: area.lineItems.sort((left, right) => left.sortOrder - right.sortOrder).map((line, lineIndex) => ({ ...line, sortOrder: lineIndex })),
    })),
    createdAt: typeof template?.createdAt === 'string' ? template.createdAt : '',
    updatedAt: typeof template?.updatedAt === 'string' ? template.updatedAt : typeof template?.createdAt === 'string' ? template.createdAt : '',
    legacyTaxRate: typeof template?.taxRate === 'number' && Number.isFinite(template.taxRate) ? template.taxRate : undefined,
  };
}

export function templateWritePayload(template) {
  const normalized = normalizeEstimateTemplate(template);
  return {
    id: normalized.id,
    schemaVersion: 2,
    name: normalized.name.trim(),
    description: normalized.description,
    proposalNotes: normalized.proposalNotes,
    workAreas: normalized.workAreas,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

export function createTemplateEstimateScope(template, generateId) {
  const normalized = normalizeEstimateTemplate(template);
  return normalized.workAreas.map((area, areaIndex) => ({
    id: generateId(),
    sourceTemplateWorkAreaId: area.id,
    name: area.name,
    description: area.description,
    sortOrder: areaIndex,
    lineItems: area.lineItems.map((line, lineIndex) => ({
      id: generateId(),
      sourceTemplateLineItemId: line.id,
      category: line.category,
      sourceEntityId: line.sourceEntityId,
      itemName: line.itemName,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      sortOrder: lineIndex,
      pricingReadiness: line.pricingReadiness === 'ready' ? 'priced' : 'needs_review',
    })),
  }));
}
