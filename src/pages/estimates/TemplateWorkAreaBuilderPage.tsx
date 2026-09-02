import { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, TextArea } from '../../components/ui';
import {
  WORK_AREA_CATEGORY_ADD_LABEL,
  WORK_AREA_CATEGORY_LABEL,
  WORK_AREA_CATEGORY_ORDER,
} from '../../components/work-areas/workAreaCategories';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import type { EstimateTemplateLineItem, LineItemCategory } from '../../types';
import { generateId } from '../../utils';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import { normalizeEstimateTemplate } from '../../utils/estimateTemplateModel.js';

interface Props {
  currentUserRole: string;
}

interface ResourceCandidate {
  id: string;
  name: string;
  description: string;
  unit: string;
  category: LineItemCategory;
}

export default function TemplateWorkAreaBuilderPage({ currentUserRole }: Props) {
  const { templateId, workAreaId } = useParams<{ templateId: string; workAreaId: string }>();
  const navigate = useNavigate();
  const {
    templates,
    labourClasses,
    equipmentAssets,
    materialCatalogItems,
    subcontractorCatalogItems,
    updateTemplate,
  } = useStore();
  const template = templates.find((item) => item.id === templateId);
  const normalized = useMemo(
    () => template ? normalizeEstimateTemplate(template) : null,
    [template],
  );
  const workArea = normalized?.workAreas.find((area) => area.id === workAreaId) ?? null;
  const [name, setName] = useState(workArea?.name ?? '');
  const [description, setDescription] = useState(workArea?.description ?? '');
  const [lineItems, setLineItems] = useState<EstimateTemplateLineItem[]>(workArea?.lineItems ?? []);
  const [catalogCategory, setCatalogCategory] = useState<LineItemCategory | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  const candidates = useMemo<ResourceCandidate[]>(() => [
    ...labourClasses
      .filter((item) => item.active)
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? '',
        unit: 'hr',
        category: 'labour' as const,
      })),
    ...equipmentAssets
      .filter((item) => item.status !== 'inactive' && item.equipmentClassification !== 'overhead')
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.type || item.notes || '',
        unit: 'hr',
        category: 'equipment' as const,
      })),
    ...materialCatalogItems
      .filter((item) => item.active !== false)
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.notes ?? '',
        unit: item.unit || 'unit',
        category: 'material' as const,
      })),
    ...subcontractorCatalogItems.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.trade || item.notes || '',
      unit: item.unit || 'job',
      category: 'subcontractor' as const,
    })),
  ], [equipmentAssets, labourClasses, materialCatalogItems, subcontractorCatalogItems]);

  const candidateIds = useMemo(
    () => new Set(candidates.map((item) => `${item.category}:${item.id}`)),
    [candidates],
  );
  const visibleCandidates = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return candidates.filter((item) => (
      item.category === catalogCategory
      && (!query || `${item.name} ${item.description} ${item.unit}`.toLowerCase().includes(query))
    ));
  }, [candidates, catalogCategory, catalogSearch]);

  if (!normalized || !workArea) {
    return (
      <div className="space-y-4">
        <Button
          variant="secondary"
          onClick={() => navigate(templateId ? `/estimates/templates/${templateId}?tab=work-areas` : '/estimates/templates')}
        >
          <ArrowLeft size={15} /> Back to Template
        </Button>
        <EmptyState title="Work Area not found" />
      </div>
    );
  }

  const updateLine = (lineId: string, changes: Partial<EstimateTemplateLineItem>) => {
    setLineItems((items) => items.map((item) => item.id === lineId ? { ...item, ...changes } : item));
  };

  const moveLine = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= lineItems.length) return;
    const next = [...lineItems];
    [next[index], next[target]] = [next[target], next[index]];
    setLineItems(next.map((item, sortOrder) => ({ ...item, sortOrder })));
  };

  const addCandidate = (candidate: ResourceCandidate) => {
    const alreadyAdded = lineItems.some((item) => (
      item.category === candidate.category && item.sourceEntityId === candidate.id
    ));
    if (alreadyAdded) return;
    setLineItems((items) => [...items, {
      id: generateId(),
      category: candidate.category,
      sourceEntityId: candidate.id,
      itemName: candidate.name,
      description: candidate.description,
      quantity: 1,
      unit: candidate.unit,
      sortOrder: items.length,
      pricingReadiness: 'ready',
    }]);
  };

  const addCustom = (category: LineItemCategory) => {
    setLineItems((items) => [...items, {
      id: generateId(),
      category,
      itemName: `Custom ${WORK_AREA_CATEGORY_ADD_LABEL[category]}`,
      description: '',
      quantity: 1,
      unit: category === 'labour' || category === 'equipment' ? 'hr' : 'unit',
      sortOrder: items.length,
      pricingReadiness: 'needs_review',
    }]);
    setCatalogCategory(null);
  };

  const save = async (goBack: boolean) => {
    if (!canManage || saving || !name.trim()) return;
    setSaving(true);
    const workAreas = normalized.workAreas.map((area) => area.id === workArea.id ? {
      ...area,
      name: name.trim(),
      description,
      lineItems: lineItems.map((item, sortOrder) => ({
        ...item,
        itemName: item.itemName.trim() || 'Untitled resource',
        description: item.description,
        quantity: Math.max(0, item.quantity),
        unit: item.unit.trim() || 'unit',
        sortOrder,
        pricingReadiness: item.sourceEntityId && candidateIds.has(`${item.category}:${item.sourceEntityId}`)
          ? 'ready' as const
          : 'needs_review' as const,
      })),
    } : area);
    const saved = await updateTemplate(normalized.id, { workAreas });
    setSaving(false);
    if (!saved) return;
    emitAppToast({ tone: 'success', message: 'Template Work Area saved.' });
    if (goBack) navigate(`/estimates/templates/${normalized.id}?tab=work-areas`);
  };

  const deleteWorkArea = async () => {
    setSaving(true);
    const saved = await updateTemplate(normalized.id, {
      workAreas: normalized.workAreas
        .filter((area) => area.id !== workArea.id)
        .map((area, sortOrder) => ({ ...area, sortOrder })),
    });
    setSaving(false);
    if (saved) navigate(`/estimates/templates/${normalized.id}?tab=work-areas`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={name || workArea.name}
        subtitle={normalized.name}
        action={(
          <Button
            variant="secondary"
            onClick={() => navigate(`/estimates/templates/${normalized.id}?tab=work-areas`)}
          >
            <ArrowLeft size={15} /> Back to Template
          </Button>
        )}
      />

      <fieldset disabled={!canManage} className="space-y-6">
        <Card className="space-y-4 p-4">
          <Input
            label="Work Area Name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextArea
            label="Description / Scope"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Card>

        {WORK_AREA_CATEGORY_ORDER.map((category) => {
          const items = lineItems.filter((item) => item.category === category);
          return (
            <Card key={category} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">
                    {WORK_AREA_CATEGORY_LABEL[category]}
                  </h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-brand-300">
                    {items.length} resource{items.length === 1 ? '' : 's'}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCatalogCategory(category);
                      setCatalogSearch('');
                    }}
                  >
                    <Plus size={14} /> Add {WORK_AREA_CATEGORY_ADD_LABEL[category]}
                  </Button>
                ) : null}
              </div>

              {items.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500 dark:text-brand-300">
                  No {WORK_AREA_CATEGORY_LABEL[category].toLowerCase()} added.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {items.map((line) => {
                    const absoluteIndex = lineItems.findIndex((item) => item.id === line.id);
                    const needsReview = line.pricingReadiness === 'needs_review'
                      || Boolean(line.sourceEntityId && !candidateIds.has(`${line.category}:${line.sourceEntityId}`));
                    return (
                      <div
                        key={line.id}
                        className="grid gap-3 rounded-lg border border-brand-100 p-3 dark:border-brand-600 lg:grid-cols-[minmax(180px,1fr)_110px_110px_minmax(180px,1fr)_auto]"
                      >
                        <div>
                          <Input
                            label="Resource"
                            value={line.itemName}
                            onChange={(event) => updateLine(line.id, { itemName: event.target.value })}
                          />
                          {needsReview ? (
                            <Badge label="Needs review" className="mt-2 bg-amber-100 text-amber-800" />
                          ) : null}
                        </div>
                        <Input
                          label="Quantity"
                          inputMode="decimal"
                          value={formatNumericDisplayValue(line.quantity)}
                          onChange={(event) => updateLine(line.id, {
                            quantity: parseNumericInputValue(event.target.value),
                          })}
                        />
                        <Input
                          label="Unit"
                          value={line.unit}
                          onChange={(event) => updateLine(line.id, { unit: event.target.value })}
                        />
                        <TextArea
                          label="Description"
                          value={line.description}
                          onChange={(event) => updateLine(line.id, { description: event.target.value })}
                        />
                        <div className="flex items-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Move up"
                            disabled={absoluteIndex === 0}
                            onClick={() => moveLine(absoluteIndex, -1)}
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Move down"
                            disabled={absoluteIndex === lineItems.length - 1}
                            onClick={() => moveLine(absoluteIndex, 1)}
                          >
                            <ArrowDown size={14} />
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            title="Remove resource"
                            onClick={() => setLineItems((current) => current
                              .filter((item) => item.id !== line.id)
                              .map((item, sortOrder) => ({ ...item, sortOrder })))}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}

        {canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Delete Work Area
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => void save(false)}
                disabled={saving || !name.trim()}
              >
                Save
              </Button>
              <Button onClick={() => void save(true)} disabled={saving || !name.trim()}>
                {saving ? 'Saving...' : 'Save & Back'}
              </Button>
            </div>
          </div>
        ) : null}
      </fieldset>

      <Modal
        open={Boolean(catalogCategory)}
        onClose={() => setCatalogCategory(null)}
        title={catalogCategory ? `Add ${WORK_AREA_CATEGORY_LABEL[catalogCategory]}` : 'Add Resource'}
        wide
        footer={catalogCategory ? (
          <Button variant="secondary" onClick={() => addCustom(catalogCategory)}>
            Add Custom {WORK_AREA_CATEGORY_ADD_LABEL[catalogCategory]}
          </Button>
        ) : undefined}
      >
        {catalogCategory ? (
          <div className="space-y-4">
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder={`Search ${WORK_AREA_CATEGORY_LABEL[catalogCategory].toLowerCase()}...`}
                className="h-10 w-full rounded-xl border border-brand-100 bg-white pl-9 pr-3 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50"
              />
            </div>
            {visibleCandidates.length === 0 ? (
              <EmptyState title={`No ${WORK_AREA_CATEGORY_LABEL[catalogCategory].toLowerCase()} found`} />
            ) : (
              <div className="space-y-2">
                {visibleCandidates.map((candidate) => {
                  const added = lineItems.some((line) => (
                    line.category === candidate.category && line.sourceEntityId === candidate.id
                  ));
                  return (
                    <div
                      key={`${candidate.category}:${candidate.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-brand-100 p-3 dark:border-brand-600"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 dark:text-brand-50">{candidate.name}</p>
                        <p className="mt-1 text-sm text-gray-500 dark:text-brand-200">
                          {candidate.description || candidate.unit}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={added}
                        onClick={() => addCandidate(candidate)}
                      >
                        {added ? 'Added' : 'Add'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete Work Area"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void deleteWorkArea()} disabled={saving}>Delete</Button>
          </>
        )}
      >
        <p className="text-gray-600 dark:text-brand-200">Delete this Work Area and its reusable scope?</p>
      </Modal>
    </div>
  );
}
