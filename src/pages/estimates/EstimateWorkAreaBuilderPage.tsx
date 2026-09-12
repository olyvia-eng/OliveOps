import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GripVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, DecimalTextInput, EmptyState, Input, Modal, PageHeader, TextArea } from '../../components/ui';
import EstimateLinePricingEditor from '../../components/estimates/EstimateLinePricingEditor';
import { useUnsavedChangesGuard } from '../../components/navigation/UnsavedChangesGuard';
import RichTextEditor from '../../components/rich-text/RichTextEditor';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { formatCurrency, generateId, statusColor } from '../../utils';
import {
  applyEstimatePricingToLineItem,
  applyEstimateLineItemCostOverride,
  calculateEstimateLineItem,
  computeWorkAreaCategorySellTotals,
  computeWorkAreaEstimatedCost,
  computeWorkAreaSubtotal,
  createEmptyEstimateLineItem,
  flattenWorkAreaLineItems,
  getEstimateLinePricingEconomics,
  normalizeEstimateWorkAreas,
  reorderEstimateLineItemsWithinCategory,
} from '../../utils/estimateModel';
import { formatTargetMarginPercent } from '../budget/budgetAnalysisSummaryModel.js';
import { formatNumericDisplayValue, normalizeNumericInput } from '../../utils/numberInput';
import { proposalScopeRichText, richTextToPlainText } from '../../utils/richText';
import { isEstimateEditorDirty, serializeEstimateEditorState } from '../../utils/estimateDirtyModel.js';
import type { Estimate, EstimateLineItem, EstimatePricingCatalog, EstimatePricingCatalogItem, LineItemCategory } from '../../types';
import type { RichTextDocument } from '../../types/richText';
import {
  WORK_AREA_CATEGORY_ADD_LABEL as CATEGORY_ADD_LABEL,
  WORK_AREA_CATEGORY_LABEL as CATEGORY_LABEL,
  WORK_AREA_CATEGORY_ORDER as CATEGORY_ORDER,
} from '../../components/work-areas/workAreaCategories';
import WorkAreaResourceSection from '../../components/work-areas/WorkAreaResourceSection';

interface Props {
  currentUserRole: string;
}

type WorkAreaBuilderForm = {
  name: string;
  description: string;
  scopeRichText: RichTextDocument;
  lineItems: EstimateLineItem[];
};

type CatalogCandidate = {
  key: string;
  category: LineItemCategory;
  displayName: string;
  description: string;
  unit: string;
  priceText: string;
  pricingItem?: EstimatePricingCatalogItem;
  disabledReason?: string;
  alreadyAdded: boolean;
  searchText: string;
};

const loadWorkAreaForm = (workArea: ReturnType<typeof normalizeEstimateWorkAreas>[number]): WorkAreaBuilderForm => ({
  name: workArea.name,
  description: workArea.description,
  scopeRichText: proposalScopeRichText(workArea.scopeRichText, workArea.description),
  lineItems: workArea.lineItems,
});

const createWorkAreaPayload = (estimate: Estimate, workAreas: ReturnType<typeof normalizeEstimateWorkAreas>) => {
  const normalizedWorkAreas = workAreas.map((area, index) => ({
    ...area,
    name: area.name.trim() || `Work Area ${index + 1}`,
    sortOrder: index,
  }));

  return {
    proposalNumber: estimate.proposalNumber?.trim() || '',
    title: estimate.title.trim(),
    customerId: estimate.customerId,
    pricingBudgetId: estimate.pricingBudgetId,
    divisionId: estimate.divisionId,
    propertyLabel: estimate.propertyLabel,
    propertyAddressSnapshot: estimate.propertyAddressSnapshot,
    convertedToJobId: estimate.convertedToJobId,
    convertedAt: estimate.convertedAt,
    description: estimate.description ?? '',
    workAreas: normalizedWorkAreas,
    status: estimate.status,
    lineItems: flattenWorkAreaLineItems(normalizedWorkAreas),
    taxRate: estimate.taxRate,
    notes: estimate.notes ?? '',
    validUntil: estimate.validUntil,
    sentAt: estimate.sentAt,
    templateId: estimate.templateId,
  };
};

export default function EstimateWorkAreaBuilderPage({ currentUserRole }: Props) {
  const { id, workAreaId } = useParams<{ id: string; workAreaId: string }>();
  const navigate = useNavigate();
  const { estimates, customers, budgets, budgetDivisions, updateEstimate } = useStore();

  const estimate = estimates.find((item) => item.id === id);
  const customer = customers.find((item) => item.id === estimate?.customerId);
  const pricingBudget = budgets.find((budget) => budget.id === estimate?.pricingBudgetId);
  const estimateDivision = budgetDivisions.find((division) => division.budgetId === estimate?.pricingBudgetId && division.id === estimate?.divisionId);
  const workAreas = useMemo(() => (estimate ? normalizeEstimateWorkAreas(estimate) : []), [estimate]);
  const workArea = useMemo(() => workAreas.find((area) => area.id === workAreaId) ?? null, [workAreaId, workAreas]);

  const [form, setForm] = useState<WorkAreaBuilderForm | null>(workArea ? loadWorkAreaForm(workArea) : null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState<LineItemCategory>('labour');
  const [showCatalogSheet, setShowCatalogSheet] = useState(false);
  const [addingCandidateKey, setAddingCandidateKey] = useState<string | null>(null);
  const [estimatePricingCatalog, setEstimatePricingCatalog] = useState<EstimatePricingCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [savingWorkArea, setSavingWorkArea] = useState(false);
  const [deletingWorkArea, setDeletingWorkArea] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [expandedLineItemIds, setExpandedLineItemIds] = useState<Set<string>>(() => new Set());
  const [customItemOpen, setCustomItemOpen] = useState(false);
  const [pricingLineItemId, setPricingLineItemId] = useState<string | null>(null);
  const [pricingEditorMode, setPricingEditorMode] = useState<'profit' | 'price'>('profit');
  const [draggedLineItem, setDraggedLineItem] = useState<{ id: string; category: LineItemCategory } | null>(null);
  const [costErrors, setCostErrors] = useState<Record<string, string>>({});
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [customItemCategory, setCustomItemCategory] = useState<LineItemCategory>('labour');
  const [customItem, setCustomItem] = useState({
    category: 'labour' as LineItemCategory,
    description: '',
    quantity: 1,
    unit: 'hr',
    unitCost: 0,
    sellPrice: 0,
  });

  useEffect(() => {
    if (!workArea) {
      setForm(null);
      return;
    }
    setForm(loadWorkAreaForm(workArea));
  }, [workArea]);

  useEffect(() => {
    if (!estimate) {
      setEstimatePricingCatalog(null);
      setCatalogError('');
      return;
    }
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError('');
    void fetch(`/api/estimate-pricing-catalog?estimateId=${encodeURIComponent(estimate.id)}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; catalog?: EstimatePricingCatalog; error?: string };
        if (!response.ok || !payload.ok || !payload.catalog) throw new Error(payload.error || 'Could not load Estimate pricing.');
        setEstimatePricingCatalog(payload.catalog);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setEstimatePricingCatalog(null);
        setCatalogError(error instanceof Error ? error.message : 'Could not load Estimate pricing.');
      })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [estimate, pricingBudget?.planningModel]);

  const initialSnapshot = useMemo(() => {
    if (!workArea) return '';
    return serializeEstimateEditorState(loadWorkAreaForm(workArea));
  }, [workArea]);

  const isDirty = useMemo(() => {
    if (!form) return false;
    return initialSnapshot !== '' && isEstimateEditorDirty(form, JSON.parse(initialSnapshot) as WorkAreaBuilderForm);
  }, [form, initialSnapshot]);

  const catalogCandidates = useMemo(() => {
    const lineItems = form?.lineItems ?? [];
    if (!estimatePricingCatalog) return [];
    const alreadyAddedBudgetItemIds = new Set(lineItems.map((item) => item.sourceBudgetItemId).filter((value): value is string => Boolean(value)));
    const alreadyAddedMaterialIds = new Set(lineItems.map((item) => item.materialCatalogItemId).filter((value): value is string => Boolean(value)));
    const categoryItems: Array<[LineItemCategory, EstimatePricingCatalogItem[]]> = [
      ['labour', estimatePricingCatalog.labour],
      ['equipment', estimatePricingCatalog.equipment],
      ['material', estimatePricingCatalog.materials],
      ['subcontractor', estimatePricingCatalog.subcontractors],
    ];
    return categoryItems.flatMap(([category, items]) => items.map((item) => ({
      key: item.materialCatalogItemId ? `material:${item.materialCatalogItemId}` : `budget:${item.budgetItemId}`,
      category,
      displayName: item.name,
      description: item.description || item.costCode || CATEGORY_LABEL[category],
      unit: item.unit,
      priceText: item.pricingReadiness === 'needs_review'
        ? 'Needs review'
        : item.pricingAvailable && item.sellRate
        ? `${formatCurrency(item.sellRate)}/${item.unit}`
        : 'Unavailable',
      pricingItem: item,
      disabledReason: item.pricingAvailable || item.pricingReadiness === 'needs_review' ? undefined : item.pricingReason ?? `${CATEGORY_LABEL[category]} pricing is unavailable for ${estimateDivision?.name ?? 'this Division'}.`,
      alreadyAdded: item.materialCatalogItemId
        ? alreadyAddedMaterialIds.has(item.materialCatalogItemId) || Boolean(item.budgetItemId && alreadyAddedBudgetItemIds.has(item.budgetItemId))
        : Boolean(item.budgetItemId && alreadyAddedBudgetItemIds.has(item.budgetItemId)),
      searchText: `${item.name} ${item.description} ${item.costCode ?? ''} ${category} ${item.unit}`.toLowerCase(),
    })));
  }, [estimateDivision?.name, estimatePricingCatalog, form?.lineItems]);

  const visibleCatalogCandidates = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return catalogCandidates.filter((candidate) => {
      const matchesFilter = candidate.category === catalogCategory;
      const matchesSearch = query.length === 0 || candidate.searchText.includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [catalogCandidates, catalogCategory, catalogSearch]);

  const groupedLineItems = useMemo(() => {
    return CATEGORY_ORDER.reduce<Record<LineItemCategory, EstimateLineItem[]>>((accumulator, category) => {
      accumulator[category] = (form?.lineItems ?? [])
        .filter((item) => item.category === category)
        .slice()
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
      return accumulator;
    }, {
      labour: [],
      equipment: [],
      material: [],
      subcontractor: [],
    });
  }, [form?.lineItems]);

  const workAreaSummary = useMemo(() => {
    if (!form || !workArea) return null;
    const currentWorkArea = {
      ...workArea,
      divisionId: estimate?.divisionId,
      name: form.name,
      description: form.description,
      lineItems: form.lineItems,
    };

    return {
      estimatedCost: computeWorkAreaEstimatedCost(currentWorkArea),
      sellPrice: computeWorkAreaSubtotal(currentWorkArea),
      categorySales: computeWorkAreaCategorySellTotals(currentWorkArea),
    };
  }, [estimate?.divisionId, form, workArea]);

  const persistWorkArea = async (): Promise<boolean> => {
    if (savingWorkArea || !estimate || !workArea || !form) return false;

    setSavingWorkArea(true);
    const nextWorkAreas = workAreas.map((area) => (
      area.id === workArea.id
        ? {
            ...area,
            divisionId: estimate.divisionId,
            name: form.name.trim() || area.name,
            description: form.description,
            lineItems: form.lineItems,
          }
        : area
    ));

    const payload = createWorkAreaPayload(estimate, nextWorkAreas);
    const saved = await updateEstimate(estimate.id, payload);
    setSavingWorkArea(false);

    if (!saved) return false;

    emitAppToast({ tone: 'success', message: 'Work area saved.' });
    return true;
  };

  const { requestNavigation, guardModal } = useUnsavedChangesGuard({
    isDirty,
    isSaving: savingWorkArea,
    onSave: persistWorkArea,
  });

  if (!estimate || !workArea || !form || !workAreaSummary) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" onClick={() => navigate(id ? `/estimates/${id}?tab=work-areas` : '/estimates')}>
          <ArrowLeft size={15} /> Back to Estimate
        </Button>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Work area not found</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-brand-200">This work area was deleted, does not belong to this estimate, or is not available to your account.</p>
        </Card>
      </div>
    );
  }

  const isReadOnly = estimate.status === 'converted';

  const setLineItem = (lineItemId: string, key: keyof EstimateLineItem, value: unknown) => {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        lineItems: current.lineItems.map((item) => {
          if (item.id !== lineItemId) return item;
          return calculateEstimateLineItem({ ...item, [key]: value } as EstimateLineItem);
        }),
      };
    });
  };

  const replaceLineItem = (nextLineItem: EstimateLineItem) => {
    setForm((current) => current ? {
      ...current,
      lineItems: current.lineItems.map((item) => item.id === nextLineItem.id ? calculateEstimateLineItem(nextLineItem) : item),
    } : current);
  };

  const reorderLineItem = (category: LineItemCategory, lineItemId: string, destinationId: string) => {
    setForm((current) => {
      if (!current || lineItemId === destinationId) return current;
      const categoryIds = current.lineItems
        .filter((item) => item.category === category)
        .slice()
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((item) => item.id);
      const sourceIndex = categoryIds.indexOf(lineItemId);
      const destinationIndex = categoryIds.indexOf(destinationId);
      if (sourceIndex < 0 || destinationIndex < 0) return current;
      categoryIds.splice(destinationIndex, 0, categoryIds.splice(sourceIndex, 1)[0]);
      const result = reorderEstimateLineItemsWithinCategory(current.lineItems, category, categoryIds);
      return result.ok ? { ...current, lineItems: result.lineItems } : current;
    });
  };

  const moveLineItem = (category: LineItemCategory, lineItemId: string, direction: -1 | 1) => {
    const items = groupedLineItems[category];
    const currentIndex = items.findIndex((item) => item.id === lineItemId);
    const destination = items[currentIndex + direction];
    if (currentIndex < 0 || !destination) return;
    reorderLineItem(category, lineItemId, destination.id);
  };

  const setCostOverride = (lineItem: EstimateLineItem, rawValue: string) => {
    const normalized = normalizeNumericInput(rawValue);
    const value = normalized ? Number(normalized) : Number.NaN;
    const result = applyEstimateLineItemCostOverride(lineItem, value);
    if (!result.ok) {
      setCostErrors((current) => ({ ...current, [lineItem.id]: result.error ?? 'Enter a valid cost.' }));
      return;
    }
    setCostErrors((current) => {
      const next = { ...current };
      delete next[lineItem.id];
      return next;
    });
    replaceLineItem(result.lineItem);
  };

  const deleteLineItem = (lineItemId: string) => {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        lineItems: current.lineItems.filter((item) => item.id !== lineItemId),
      };
    });
  };

  // Adds another worker as its own separate row (rather than bumping a shared "workers" count on one
  // row), since the catalog already blocks re-adding the same Labour Class and each row's Hours/Profit
  // need to be editable independently.
  const duplicateLineItem = (lineItem: EstimateLineItem) => {
    setForm((current) => {
      if (!current) return current;
      const duplicate = calculateEstimateLineItem({
        ...lineItem,
        id: generateId(),
        workers: 1,
        sortOrder: current.lineItems.filter((item) => item.category === lineItem.category).length,
      });
      return { ...current, lineItems: [...current.lineItems, duplicate] };
    });
  };

  const handleAddFromCandidate = (candidate: CatalogCandidate) => {
    const canAdd = candidate.pricingItem?.pricingAvailable || candidate.pricingItem?.pricingReadiness === 'needs_review';
    if (candidate.alreadyAdded || !candidate.pricingItem || !canAdd || addingCandidateKey === candidate.key) return;
    const pricingItem = candidate.pricingItem;
    const applied = applyEstimatePricingToLineItem(createEmptyEstimateLineItem(candidate.category), estimate.pricingBudgetId, pricingItem);
    const nextItem = calculateEstimateLineItem({
      ...applied,
      itemName: candidate.displayName,
      description: candidate.description || applied.description,
    });

    setAddingCandidateKey(candidate.key);
    setForm((current) => current ? { ...current, lineItems: [...current.lineItems, {
      ...nextItem,
      sortOrder: current.lineItems.filter((item) => item.category === candidate.category).length,
    }] } : current);
    if (pricingItem.pricingReadiness === 'needs_review') setPricingLineItemId(nextItem.id);

    window.setTimeout(() => setAddingCandidateKey(null), 250);
  };

  const openCustomItem = (category: LineItemCategory) => {
    setCustomItemCategory(category);
    setCustomItem({
      category,
      description: '',
      quantity: 1,
      unit: category === 'labour' || category === 'equipment' ? 'hr' : 'unit',
      unitCost: 0,
      sellPrice: 0,
    });
    setCustomItemOpen(true);
  };

  const openCatalog = (category: LineItemCategory) => {
    setCatalogCategory(category);
    setCatalogSearch('');
    setShowCatalogSheet(true);
  };

  const saveCustomItem = () => {
    const nextItem = calculateEstimateLineItem({
      ...createEmptyEstimateLineItem(customItem.category),
      category: customItem.category,
      itemName: customItem.description.trim() || 'Custom Item',
      description: customItem.description.trim(),
      quantity: customItem.quantity,
      unit: customItem.unit.trim() || 'unit',
      unitCost: customItem.unitCost,
      markupPercent: 0,
      sellPrice: customItem.sellPrice,
      markup: 0,
    });

    setForm((current) => current ? {
      ...current,
      lineItems: [...current.lineItems, {
        ...nextItem,
        sortOrder: current.lineItems.filter((item) => item.category === customItem.category).length,
      }],
    } : current);
    setCustomItemOpen(false);
  };

  const handleBack = () => {
    requestNavigation(`/estimates/${estimate.id}?tab=work-areas`);
  };

  const saveAndBack = async () => {
    const saved = await persistWorkArea();
    if (saved) navigate(`/estimates/${estimate.id}?tab=work-areas`);
  };

  const handleDeleteWorkArea = async () => {
    if (savingWorkArea || deletingWorkArea) return;

    const nextWorkAreas = workAreas
      .filter((area) => area.id !== workArea.id)
      .map((area, index) => ({ ...area, sortOrder: index }));
    const payload = createWorkAreaPayload(estimate, nextWorkAreas);
    setDeletingWorkArea(true);
    const saved = await updateEstimate(estimate.id, payload);
    setDeletingWorkArea(false);

    if (!saved) return;

    emitAppToast({ tone: 'success', message: 'Work area deleted.' });
    navigate(`/estimates/${estimate.id}?tab=work-areas`);
  };

  const renderCatalogPanel = () => (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={catalogSearch}
            onChange={(event) => setCatalogSearch(event.target.value)}
            placeholder={`Search ${CATEGORY_LABEL[catalogCategory].toLowerCase()}...`}
            className="h-10 w-full rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 pl-9 pr-3 text-sm text-brand-900 dark:text-brand-50 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-500/40"
          />
        </div>

      </div>

      {catalogLoading ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-brand-300">Loading pricing from {pricingBudget?.name ?? 'the selected Budget'}...</p>
      ) : catalogError ? (
        <EmptyState title="Pricing catalog unavailable" description={catalogError} />
      ) : pricingBudget?.planningModel === 'divisions_v1' && visibleCatalogCandidates.length > 0 && visibleCatalogCandidates.every((candidate) => !candidate.pricingItem?.pricingAvailable && candidate.pricingItem?.pricingReadiness !== 'needs_review') ? (
        <div className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-800">
          {catalogCategory === 'labour'
            ? `Labour pricing is incomplete for ${estimateDivision?.name ?? 'this Division'}.`
            : `${CATEGORY_LABEL[catalogCategory]} pricing is incomplete for ${estimateDivision?.name ?? 'this Division'}.`}
        </div>
      ) : null}

      {!catalogLoading && !catalogError && visibleCatalogCandidates.length === 0 ? (
        <EmptyState
          title={catalogSearch.trim()
            ? `No ${CATEGORY_LABEL[catalogCategory].toLowerCase()} match your search`
            : pricingBudget?.planningModel === 'divisions_v1' && catalogCategory === 'labour'
              ? 'No Labour Classes configured'
            : `No ${CATEGORY_LABEL[catalogCategory].toLowerCase()} in this Budget`}
          description={catalogSearch.trim()
            ? 'Try a different search.'
            : pricingBudget?.planningModel === 'divisions_v1' && catalogCategory === 'labour'
              ? 'Set up reusable Labour Classes before adding estimated labour.'
            : `No ${CATEGORY_LABEL[catalogCategory].toLowerCase()} pricing has been added to the ${pricingBudget?.name ?? 'selected'} Budget and Division.`}
          action={catalogCategory === 'labour'
            ? <Link to="/materials/catalog?catalog=labour"><Button variant="secondary">Set up Labour Classes in Catalog</Button></Link>
            : <Button variant="secondary" onClick={() => openCustomItem(catalogCategory)}>Custom {CATEGORY_ADD_LABEL[catalogCategory]}</Button>}
        />
      ) : !catalogLoading && !catalogError ? (
        <div className={catalogCategory === 'material' ? 'space-y-1.5' : 'space-y-3'}>
          {visibleCatalogCandidates.map((candidate) => {
            const canAdd = Boolean(candidate.pricingItem?.pricingAvailable || candidate.pricingItem?.pricingReadiness === 'needs_review');
            if (candidate.category === 'material') {
              const materialStatus = candidate.pricingItem?.sourceOrigin === 'catalog_only'
                ? 'Not in selected Budget'
                : candidate.pricingItem?.sourceOrigin === 'legacy_budget_only'
                  ? 'Legacy Budget item'
                  : 'In selected Budget';
              return (
                <div key={candidate.key} className="rounded-lg border border-brand-100 bg-white px-2.5 py-2 dark:border-brand-600 dark:bg-brand-800">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <p className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-brand-50" title={candidate.displayName}>{candidate.displayName}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900 dark:text-brand-50">{candidate.priceText}</p>
                      <Button
                        size="sm"
                        variant={canAdd ? 'secondary' : 'ghost'}
                        onClick={() => {
                          if (canAdd) handleAddFromCandidate(candidate);
                        }}
                        disabled={!canAdd || candidate.alreadyAdded || addingCandidateKey === candidate.key}
                        className="h-8 px-2"
                        title={candidate.disabledReason}
                        aria-label={candidate.alreadyAdded ? `${candidate.displayName} already added` : `Add ${candidate.displayName}`}
                      >
                        {!candidate.alreadyAdded && canAdd ? <Plus size={14} /> : null} {candidate.alreadyAdded ? 'Added' : 'Add'}
                      </Button>
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-gray-500 dark:text-brand-300">
                      <span>{materialStatus}</span>
                      {candidate.pricingItem?.costRate != null ? <><span aria-hidden="true">·</span><span>Cost {formatCurrency(candidate.pricingItem.costRate)}/{candidate.unit}</span></> : null}
                    </div>
                    {candidate.pricingItem?.pricingReadiness === 'needs_review' && candidate.pricingItem.pricingReason ? <p className="col-span-2 truncate text-xs text-amber-700 dark:text-amber-300" title={candidate.pricingItem.pricingReason}>{candidate.pricingItem.pricingReason}</p> : !canAdd && candidate.disabledReason ? <p className="col-span-2 truncate text-xs text-accent-700" title={candidate.disabledReason}>{candidate.disabledReason}</p> : null}
                  </div>
                </div>
              );
            }
            return (
            <div key={candidate.key} className="rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900 dark:text-brand-50">{candidate.displayName}</p>
                    {candidate.pricingItem?.sourceOrigin === 'catalog_only' ? <span className="text-[11px] font-semibold uppercase text-gray-500 dark:text-brand-300">Not in selected Budget</span> : null}
                    {candidate.pricingItem?.sourceOrigin === 'legacy_budget_only' ? <span className="text-[11px] font-semibold uppercase text-gray-500 dark:text-brand-300">Legacy Budget item</span> : null}
                    {candidate.alreadyAdded ? <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Already added</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">{candidate.description}</p>
                  {candidate.category === 'labour' && candidate.pricingItem ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-brand-300">
                      {candidate.pricingItem.averageLabourCost != null ? <span>Weighted Labour Cost: {formatCurrency(candidate.pricingItem.averageLabourCost)}/hr</span> : null}
                      {candidate.pricingItem.breakevenRate != null ? <span>Breakeven: {formatCurrency(candidate.pricingItem.breakevenRate)}/hr</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-brand-50">{candidate.priceText}</p>
                  {candidate.pricingItem?.sourceOrigin === 'catalog_only' && candidate.pricingItem.costRate != null ? <p className="mt-0.5 text-xs text-gray-500 dark:text-brand-300">{formatCurrency(candidate.pricingItem.costRate)}/{candidate.unit} cost</p> : null}
                  <Button
                    size="sm"
                    variant={canAdd ? 'secondary' : 'ghost'}
                    onClick={() => {
                      if (canAdd) handleAddFromCandidate(candidate);
                    }}
                    disabled={!canAdd || candidate.alreadyAdded || addingCandidateKey === candidate.key}
                    className="mt-2"
                    title={candidate.disabledReason}
                  >
                    {!candidate.alreadyAdded && canAdd ? <Plus size={14} /> : null} {candidate.alreadyAdded ? 'Already added' : 'Add'}
                  </Button>
                </div>
              </div>
              {candidate.pricingItem?.pricingReadiness === 'needs_review' && candidate.pricingItem.pricingReason ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{candidate.pricingItem.pricingReason}</p> : !canAdd && candidate.disabledReason ? <p className="mt-2 text-xs text-accent-700">{candidate.disabledReason}</p> : null}
            </div>
          );})}
        </div>
      ) : null}
    </div>
  );

  const renderLineItemGroup = (category: LineItemCategory) => {
    const items = groupedLineItems[category];

    return (
      <WorkAreaResourceSection
        key={category}
        category={category}
        itemCount={items.length}
        canAdd={!isReadOnly}
        onAdd={() => openCatalog(category)}
        emptyText={`No ${CATEGORY_LABEL[category].toLowerCase()} items added yet.`}
      >
          <div className="mt-4 overflow-x-auto rounded-lg border border-brand-100 dark:border-brand-600">
            <div className={`hidden min-w-[1160px] ${category === 'labour' ? 'grid-cols-[32px_minmax(180px,1.4fr)_80px_minmax(128px,max-content)_repeat(6,minmax(112px,0.7fr))_76px]' : 'grid-cols-[32px_minmax(180px,1.4fr)_minmax(128px,max-content)_repeat(6,minmax(112px,0.7fr))_76px]'} gap-3 border-b border-brand-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-200 lg:grid`}>
              <span aria-hidden="true" /><span>Item</span>{category === 'labour' ? <><span>Workers</span><span>Hours / Worker</span></> : <span>Quantity</span>}<span className="text-right">Cost</span><span className="text-right">Breakeven</span><span className="text-right">Total Cost</span><span className="text-right">Profit</span><span className="text-right">Price</span><span className="text-right">Total Price</span><span className="text-right">Actions</span>
            </div>
            {items.map((lineItem) => {
              const isBudgetPriced = Boolean(lineItem.sourceBudgetItemId || lineItem.sourceRateId || lineItem.equipmentId || lineItem.materialCatalogItemId);
              const usesHours = category === 'labour' || (category === 'equipment' && lineItem.unit === 'hr');
              const quantityLabel = usesHours ? 'Hours' : 'Quantity';
              const isExpanded = expandedLineItemIds.has(lineItem.id);
              const economics = getEstimateLinePricingEconomics(lineItem);
              const unitPrice = (value: number | null) => value === null ? 'Not available' : `${formatCurrency(value)}/${lineItem.unit}`;
              return (
              <div key={lineItem.id} className="border-b border-brand-100 bg-brand-50/40 last:border-b-0 dark:border-brand-600 dark:bg-brand-900/20">
                <div
                  className={`grid min-w-[1160px] ${category === 'labour' ? 'grid-cols-[32px_minmax(180px,1.4fr)_80px_minmax(128px,max-content)_repeat(6,minmax(112px,0.7fr))_76px]' : 'grid-cols-[32px_minmax(180px,1.4fr)_minmax(128px,max-content)_repeat(6,minmax(112px,0.7fr))_76px]'} items-center gap-3 px-3 py-3 text-sm`}
                  onDragOver={(event) => { if (draggedLineItem?.category === category) event.preventDefault(); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedLineItem?.category === category) reorderLineItem(category, draggedLineItem.id, lineItem.id);
                    setDraggedLineItem(null);
                  }}
                >
                  <button
                    type="button"
                    draggable={!isReadOnly}
                    disabled={isReadOnly}
                    title="Drag to reorder"
                    aria-label={`Reorder ${lineItem.itemName || lineItem.description || 'item'}`}
                    onDragStart={(event) => {
                      setDraggedLineItem({ id: lineItem.id, category });
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', lineItem.id);
                    }}
                    onDragEnd={() => setDraggedLineItem(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        moveLineItem(category, lineItem.id, event.key === 'ArrowUp' ? -1 : 1);
                      }
                    }}
                    className="cursor-grab rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-accent-500/40 active:cursor-grabbing disabled:cursor-default dark:hover:bg-brand-700"
                  >
                    <GripVertical size={16} />
                  </button>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900 dark:text-brand-50" title={lineItem.itemName || lineItem.description || 'Untitled Item'}>{lineItem.itemName || lineItem.description || 'Untitled Item'}</p>
                    <p className="mt-0.5 truncate text-xs capitalize text-gray-500 dark:text-brand-300">{CATEGORY_LABEL[lineItem.category]}</p>
                  </div>
                  {category === 'labour' ? <div className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-brand-300">
                    <span aria-label={`Workers for ${lineItem.itemName || lineItem.description || 'item'}`} className="tabular-nums">{lineItem.workers ?? 1}</span>
                    {!isReadOnly ? <button
                      type="button"
                      title="Add another worker as a new row"
                      aria-label={`Add another ${lineItem.itemName || lineItem.description || 'worker'} row`}
                      onClick={() => duplicateLineItem(lineItem)}
                      className="rounded-md border border-brand-100 p-1 text-brand-600 hover:border-brand-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700"
                    ><Plus size={13} /></button> : null}
                  </div> : null}
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-brand-300">
                    <span className="sr-only">{quantityLabel}</span>
                    <DecimalTextInput
                      aria-label={`${quantityLabel} for ${lineItem.itemName || lineItem.description || 'item'}`}
                      value={lineItem.quantity}
                      disabled={isReadOnly}
                      onValueChange={(value) => setLineItem(lineItem.id, 'quantity', value)}
                      className="h-9 w-20 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50"
                    />
                    {usesHours || isBudgetPriced ? <span>{lineItem.unit}</span> : <input disabled={isReadOnly} aria-label={`Unit for ${lineItem.itemName || lineItem.description || 'item'}`} value={lineItem.unit} onChange={(event) => setLineItem(lineItem.id, 'unit', event.target.value)} className="h-9 w-16 rounded-md border border-brand-100 bg-white px-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" />}
                  </label>
                  {category === 'labour' ? <p className="text-right font-medium tabular-nums text-gray-700 dark:text-brand-100">{unitPrice(economics.cost)}</p> : <div>
                    <label className="flex items-center justify-end gap-1 text-xs text-gray-500 dark:text-brand-300">
                      <span className="sr-only">Cost for {lineItem.itemName || lineItem.description || 'item'}</span>
                      <span>$</span>
                      <input
                        aria-label={`Cost for ${lineItem.itemName || lineItem.description || 'item'}`}
                        aria-invalid={Boolean(costErrors[lineItem.id])}
                        type="text"
                        inputMode="decimal"
                        value={costDrafts[lineItem.id] ?? formatNumericDisplayValue(lineItem.unitCost)}
                        disabled={isReadOnly}
                        onChange={(event) => {
                          setCostDrafts((current) => ({ ...current, [lineItem.id]: event.target.value }));
                          setCostOverride(lineItem, event.target.value);
                        }}
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={() => setCostDrafts((current) => {
                          if (!(lineItem.id in current)) return current;
                          const next = { ...current };
                          delete next[lineItem.id];
                          return next;
                        })}
                        className="h-9 w-20 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50"
                      />
                      <span>/{lineItem.unit}</span>
                    </label>
                    {costErrors[lineItem.id] ? <p className="mt-1 text-right text-xs text-accent-700" role="alert">{costErrors[lineItem.id]}</p> : null}
                  </div>}
                  <p className="text-right font-medium tabular-nums text-gray-700 dark:text-brand-100">{unitPrice(economics.breakeven)}</p>
                  <p className="text-right font-medium tabular-nums text-gray-900 dark:text-brand-50">{formatCurrency(economics.totalCost)}</p>
                  <button type="button" disabled={isReadOnly} onClick={() => { setPricingEditorMode('profit'); setPricingLineItemId(lineItem.id); }} className="h-9 whitespace-nowrap rounded-md border border-brand-100 bg-white px-2 text-right font-semibold tabular-nums text-brand-900 hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-accent-500/40 disabled:cursor-default dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50">{economics.profitPercent === null ? 'Set profit' : formatTargetMarginPercent(economics.profitPercent)}</button>
                  <div className="flex items-center justify-end gap-1 text-right text-gray-700 dark:text-brand-100">
                    <div className="flex flex-col items-end leading-tight">
                      {lineItem.estimateCustomSellPrice !== null && lineItem.estimateCustomSellPrice !== undefined ? <span className="whitespace-nowrap text-[10px] font-semibold uppercase text-accent-700 dark:text-accent-300">Custom</span> : null}
                      <span className="whitespace-nowrap font-medium tabular-nums">{unitPrice(economics.price)}</span>
                    </div>
                    {!isReadOnly ? <button type="button" title="Edit Estimate price" aria-label={`Edit Estimate price for ${lineItem.itemName || lineItem.description || 'item'}`} onClick={() => { setPricingEditorMode('price'); setPricingLineItemId(lineItem.id); }} className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-brand-700 dark:hover:bg-brand-700"><Pencil size={13} /></button> : null}
                  </div>
                  <p className="text-right text-base font-semibold tabular-nums text-gray-900 dark:text-brand-50" aria-label="Total Price">{formatCurrency(economics.totalPrice)}</p>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" title={isExpanded ? 'Collapse item details' : 'Edit description and notes'} aria-expanded={isExpanded} onClick={() => setExpandedLineItemIds((current) => { const next = new Set(current); if (next.has(lineItem.id)) next.delete(lineItem.id); else next.add(lineItem.id); return next; })} className="rounded-md p-2 text-gray-400 hover:bg-white hover:text-brand-700 dark:hover:bg-brand-700 dark:hover:text-brand-100">
                      <Pencil size={14} />
                    </button>
                    {!isReadOnly ? <button type="button" title="Delete item" onClick={() => deleteLineItem(lineItem.id)} className="rounded-md p-2 text-gray-400 hover:bg-white hover:text-accent-700 dark:hover:bg-brand-700">
                      <Trash2 size={14} />
                    </button> : null}
                  </div>
                </div>
                {isExpanded ? <div className="grid gap-3 border-t border-brand-100 px-3 py-3 sm:grid-cols-[32px_minmax(0,1fr)_12rem] dark:border-brand-600"><span aria-hidden="true" />
                  <label className="block text-xs font-medium text-gray-600 dark:text-brand-200">Description / Notes<textarea disabled={isReadOnly} rows={2} value={lineItem.description} onChange={(event) => setLineItem(lineItem.id, 'description', event.target.value)} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm font-normal text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label>
                  {!isBudgetPriced ? <label className="block text-xs font-medium text-gray-600 dark:text-brand-200">Estimated Cost / {lineItem.unit}<DecimalTextInput disabled={isReadOnly} value={lineItem.unitCost} onValueChange={(value) => setLineItem(lineItem.id, 'unitCost', value)} className="mt-1 h-10 w-full rounded-lg border border-brand-100 bg-white px-3 text-right text-sm font-normal text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label> : <div className="space-y-1 text-xs text-gray-600 dark:text-brand-200">
                    {economics.calculatedPrice !== null ? <p>Calculated Price <span className="float-right font-semibold tabular-nums">{unitPrice(economics.calculatedPrice)}</span></p> : null}
                    {economics.calculatedPrice !== null && economics.price !== economics.calculatedPrice ? <p>Final Price <span className="float-right font-semibold tabular-nums">{unitPrice(economics.price)}</span></p> : null}
                    {economics.isBelowBreakeven ? <p className="font-medium text-amber-700 dark:text-amber-300">Price is below breakeven.</p> : null}
                  </div>}
                </div> : null}
              </div>
            );})}
          </div>
      </WorkAreaResourceSection>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-brand-300">
        <Link to="/estimates" className="hover:text-brand-700 dark:hover:text-brand-100">Estimates</Link>
        <span>/</span>
        <Link to={`/estimates/${estimate.id}?tab=work-areas`} className="hover:text-brand-700 dark:hover:text-brand-100">{estimate.title}</Link>
        <span>/</span>
        <span className="text-gray-700 dark:text-brand-100">{form.name || workArea.name}</span>
      </div>

      <PageHeader
        title={form.name || workArea.name}
        subtitle={`${customer?.name ?? 'Unknown Customer'}${estimate.proposalNumber ? ` • ${estimate.proposalNumber}` : ''}`}
        action={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={handleBack}><ArrowLeft size={15} /> Back to Estimate</Button>
            {!isReadOnly ? <Button onClick={() => void persistWorkArea()} disabled={!isDirty || savingWorkArea}>{savingWorkArea ? 'Saving...' : 'Save Changes'}</Button> : null}
          </div>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge label={estimate.status} className={statusColor[estimate.status]} />
        {pricingBudget ? <Badge label={`Pricing: ${pricingBudget.name}`} className="bg-brand-100 text-brand-700" /> : null}
        {currentUserRole === 'owner' || currentUserRole === 'admin' ? <Badge label="Analysis Enabled" className="bg-gray-100 text-gray-700" /> : null}
      </div>

      <div className="space-y-6">
          <Card className="p-4 space-y-4">
            <Input
              label="Work Area Name"
              required
              disabled={isReadOnly}
              value={form.name}
              onChange={(event) => setForm((current) => current ? { ...current, name: event.target.value } : current)}
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-brand-100">Customer-facing scope of work</label>
              <RichTextEditor
                ariaLabel="Customer-facing scope of work"
                disabled={isReadOnly}
                compact
                value={form.scopeRichText}
                onChange={(scopeRichText) => setForm((current) => current ? { ...current, scopeRichText, description: richTextToPlainText(scopeRichText) } : current)}
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-brand-300">Describe the work included in this area. This appears on the customer proposal.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-brand-300">
              <span>Estimate: {estimate.title}</span>
              {pricingBudget ? <span>• Pricing Budget: {pricingBudget.name}</span> : null}
              {estimateDivision ? <span>• Division: {estimateDivision.name}</span> : null}
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Work Area Totals</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Estimate pricing remains tied to the selected budget. Added items are stored as snapshots.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-brand-50/60 dark:bg-brand-900/20 p-3">
                <p className="text-xs text-gray-500 dark:text-brand-300">Estimated Cost</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(workAreaSummary.estimatedCost)}</p>
              </div>
              <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-brand-50/60 dark:bg-brand-900/20 p-3">
                <p className="text-xs text-gray-500 dark:text-brand-300">Sell Price</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(workAreaSummary.sellPrice)}</p>
              </div>
            </div>

            <p className="text-xs font-medium text-gray-500 dark:text-brand-300">Sell Price by Category</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 text-sm">
              {CATEGORY_ORDER.map((category) => (
                <p key={category} className="text-gray-700 dark:text-brand-100">
                  {CATEGORY_LABEL[category]} <span className="ml-2 font-semibold">{formatCurrency(workAreaSummary.categorySales[category])}</span>
                </p>
              ))}
            </div>
          </Card>

          {CATEGORY_ORDER.map(renderLineItemGroup)}

          <Card className="p-4 space-y-4">
            {!isReadOnly ? <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" onClick={() => setConfirmDeleteOpen(true)}>
                <Trash2 size={14} /> Delete Work Area
              </Button>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => void persistWorkArea()} disabled={!isDirty || savingWorkArea}>{savingWorkArea ? 'Saving...' : 'Save Changes'}</Button>
                <Button onClick={() => void saveAndBack()} disabled={savingWorkArea}>{savingWorkArea ? 'Saving...' : 'Save & Back'}</Button>
              </div>
            </div> : <p className="text-sm text-gray-500">This Work Area is part of the converted Estimate and is read-only.</p>}
          </Card>
      </div>

      {showCatalogSheet ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCatalogSheet(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-2xl bg-white dark:bg-brand-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-brand-100 dark:border-brand-600 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Add {CATEGORY_ADD_LABEL[catalogCategory]}</h2>
                <p className="text-xs text-gray-500 dark:text-brand-300">{pricingBudget?.name ?? 'Selected pricing budget'}{estimateDivision ? ` / ${estimateDivision.name}` : ''}</p>
              </div>
              <button type="button" onClick={() => setShowCatalogSheet(false)} className="rounded-lg p-2 text-gray-400 hover:bg-brand-50 hover:text-gray-700 dark:hover:bg-brand-700 dark:text-brand-300">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {renderCatalogPanel()}
            </div>
            {catalogCategory !== 'labour' ? <div className="border-t border-brand-100 dark:border-brand-600 p-4">
              <Button variant="secondary" className="w-full" onClick={() => openCustomItem(catalogCategory)}>
                <Plus size={14} /> Custom {CATEGORY_ADD_LABEL[catalogCategory]}
              </Button>
            </div> : null}
          </div>
        </div>
      ) : null}

      {pricingLineItemId ? (() => {
        const pricingLineItem = form.lineItems.find((item) => item.id === pricingLineItemId);
        return pricingLineItem ? <EstimateLinePricingEditor lineItem={pricingLineItem} initialMode={pricingEditorMode} onChange={replaceLineItem} onClose={() => setPricingLineItemId(null)} /> : null;
      })() : null}

      <Modal
        open={customItemOpen}
        onClose={() => setCustomItemOpen(false)}
        title={`Custom ${CATEGORY_ADD_LABEL[customItemCategory]}`}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCustomItemOpen(false)}>Cancel</Button>
            <Button onClick={saveCustomItem}>Add Item</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <TextArea label="Description" value={customItem.description} onChange={(event) => setCustomItem((current) => ({ ...current, description: event.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" min={0} value={customItem.quantity} onChange={(event) => setCustomItem((current) => ({ ...current, quantity: Number(event.target.value) }))} />
            <Input label="Unit" value={customItem.unit} onChange={(event) => setCustomItem((current) => ({ ...current, unit: event.target.value }))} />
          </div>
          <Input label="Rate" type="number" min={0} value={customItem.sellPrice} onChange={(event) => setCustomItem((current) => ({ ...current, sellPrice: Number(event.target.value) }))} />
          <details className="rounded-lg border border-brand-100 p-3 dark:border-brand-600"><summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-brand-100">Costing</summary><div className="mt-3"><Input label="Estimated Cost" type="number" min={0} value={customItem.unitCost} onChange={(event) => setCustomItem((current) => ({ ...current, unitCost: Number(event.target.value) }))} /></div></details>
        </div>
      </Modal>

      <Modal
        open={confirmDeleteOpen}
        onClose={() => { if (!deletingWorkArea) setConfirmDeleteOpen(false); }}
        title={`Delete "${workArea.name}"?`}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)} disabled={deletingWorkArea}>Cancel</Button>
            <Button variant="danger" onClick={handleDeleteWorkArea} disabled={deletingWorkArea}>{deletingWorkArea ? 'Deleting...' : 'Delete Work Area'}</Button>
          </>
        )}
      >
        <p className="text-sm text-gray-600 dark:text-brand-200">This will remove this Work Area and its Labour, Equipment, Materials, and Subcontractor items from this Estimate.</p>
      </Modal>
      {guardModal}
    </div>
  );
}