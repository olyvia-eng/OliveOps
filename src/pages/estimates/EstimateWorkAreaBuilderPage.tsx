import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { formatCurrency, statusColor } from '../../utils';
import {
  applyBudgetRateToEstimateLineItem,
  applyEstimatePricingToLineItem,
  applyEquipmentAssetToEstimateLineItem,
  calculateEstimateLineItem,
  computeWorkAreaCategorySellTotals,
  computeWorkAreaEstimatedCost,
  computeWorkAreaSubtotal,
  createEmptyEstimateLineItem,
  flattenWorkAreaLineItems,
  getEstimateLinePricingEconomics,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import type { BudgetRate, EquipmentAsset, Estimate, EstimateLineItem, EstimatePricingCatalog, EstimatePricingCatalogItem, LineItemCategory } from '../../types';

interface Props {
  currentUserRole: string;
}

type WorkAreaBuilderForm = {
  name: string;
  description: string;
  lineItems: EstimateLineItem[];
};

type CatalogCandidate = {
  key: string;
  category: LineItemCategory;
  displayName: string;
  description: string;
  unit: string;
  priceText: string;
  rate?: BudgetRate;
  equipment?: EquipmentAsset;
  pricingItem?: EstimatePricingCatalogItem;
  disabledReason?: string;
  alreadyAdded: boolean;
  source: 'rate' | 'equipment' | 'material' | 'budget';
  searchText: string;
};

const CATEGORY_ORDER: LineItemCategory[] = ['labour', 'equipment', 'material', 'subcontractor'];

const CATEGORY_LABEL: Record<LineItemCategory, string> = {
  labour: 'Labour',
  equipment: 'Equipment',
  material: 'Materials',
  subcontractor: 'Subcontractors',
};

const CATEGORY_ADD_LABEL: Record<LineItemCategory, string> = {
  labour: 'Labour',
  equipment: 'Equipment',
  material: 'Material',
  subcontractor: 'Subcontractor',
};

const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const rateSellPrice = (rate: BudgetRate) => (
  rate.defaultSellPrice > 0
    ? rate.defaultSellPrice
    : rate.unitCost * (1 + rate.defaultMarkupPercent / 100)
);

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
  const { estimates, customers, budgets, budgetDivisions, budgetRates, equipmentAssets, materialCatalogItems, updateEstimate } = useStore();

  const estimate = estimates.find((item) => item.id === id);
  const customer = customers.find((item) => item.id === estimate?.customerId);
  const pricingBudget = budgets.find((budget) => budget.id === estimate?.pricingBudgetId);
  const estimateDivision = budgetDivisions.find((division) => division.budgetId === estimate?.pricingBudgetId && division.id === estimate?.divisionId);
  const workAreas = useMemo(() => (estimate ? normalizeEstimateWorkAreas(estimate) : []), [estimate]);
  const workArea = useMemo(() => workAreas.find((area) => area.id === workAreaId) ?? null, [workAreaId, workAreas]);

  const [form, setForm] = useState<WorkAreaBuilderForm | null>(workArea ? {
    name: workArea.name,
    description: workArea.description,
    lineItems: workArea.lineItems,
  } : null);
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
    setForm({
      name: workArea.name,
      description: workArea.description,
      lineItems: workArea.lineItems,
    });
  }, [workArea]);

  useEffect(() => {
    if (!estimate || pricingBudget?.planningModel !== 'divisions_v1') {
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
    return JSON.stringify({
      name: workArea.name,
      description: workArea.description,
      lineItems: workArea.lineItems,
    });
  }, [workArea]);

  const isDirty = useMemo(() => {
    if (!form) return false;
    return JSON.stringify(form) !== initialSnapshot;
  }, [form, initialSnapshot]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const selectedBudgetRates = useMemo(() => budgetRates
    .filter((rate) => rate.active && rate.budgetId === estimate?.pricingBudgetId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.itemName.localeCompare(b.itemName)), [budgetRates, estimate?.pricingBudgetId]);

  const budgetRatesByCategory = useMemo(() => CATEGORY_ORDER.reduce<Record<LineItemCategory, BudgetRate[]>>((accumulator, category) => {
    accumulator[category] = selectedBudgetRates.filter((rate) => rate.category === category);
    return accumulator;
  }, {
    labour: [],
    equipment: [],
    material: [],
    subcontractor: [],
  }), [selectedBudgetRates]);

  const catalogCandidates = useMemo(() => {
    const lineItems = form?.lineItems ?? [];
    if (pricingBudget?.planningModel === 'divisions_v1') {
      if (!estimatePricingCatalog) return [];
      const alreadyAddedBudgetItemIds = new Set(lineItems.map((item) => item.sourceBudgetItemId).filter((value): value is string => Boolean(value)));
      const categoryItems: Array<[LineItemCategory, EstimatePricingCatalogItem[]]> = [
        ['labour', estimatePricingCatalog.labour],
        ['equipment', estimatePricingCatalog.equipment],
        ['material', estimatePricingCatalog.materials],
        ['subcontractor', estimatePricingCatalog.subcontractors],
      ];
      const canonicalCandidates: CatalogCandidate[] = categoryItems.flatMap(([category, items]) => items.map((item) => ({
        key: `budget:${item.budgetItemId}`,
        category,
        displayName: item.name,
        description: item.description || item.costCode || CATEGORY_LABEL[category],
        unit: item.unit,
        priceText: item.pricingAvailable && item.sellRate
          ? `${formatCurrency(item.sellRate)}/${item.unit}`
          : 'Unavailable',
        pricingItem: item,
        disabledReason: item.pricingAvailable ? undefined : item.pricingReason ?? `${CATEGORY_LABEL[category]} pricing is unavailable for ${estimateDivision?.name ?? 'this Division'}.`,
        alreadyAdded: alreadyAddedBudgetItemIds.has(item.budgetItemId),
        source: 'budget' as const,
        searchText: `${item.name} ${item.description} ${item.costCode ?? ''} ${category} ${item.unit}`.toLowerCase(),
      })));
      return canonicalCandidates;
    }
    const alreadyAddedRateIds = new Set(lineItems.map((item) => item.sourceRateId).filter((value): value is string => Boolean(value)));
    const alreadyAddedEquipmentIds = new Set(lineItems.map((item) => item.equipmentId).filter((value): value is string => Boolean(value)));
    const candidates: CatalogCandidate[] = [];
    const matchedEquipmentRateIds = new Set<string>();
    const matchedMaterialRateIds = new Set<string>();
    const findMatchingRate = (category: LineItemCategory, values: string[]) => {
      const normalizedValues = values.map(normalizeKey).filter(Boolean);
      if (normalizedValues.length === 0) return null;

      return budgetRatesByCategory[category].find((rate) => {
        const rateTexts = [rate.itemName, rate.description].map(normalizeKey).filter(Boolean);
        return normalizedValues.some((value) => rateTexts.some((text) => text === value || text.includes(value) || value.includes(text)));
      }) ?? null;
    };

    for (const rate of budgetRatesByCategory.labour) {
      candidates.push({
        key: `rate:${rate.id}`,
        category: 'labour',
        displayName: rate.itemName,
        description: rate.description || 'Estimating labour rate',
        unit: rate.unit,
        priceText: `${formatCurrency(rateSellPrice(rate))}/${rate.unit}`,
        rate,
        alreadyAdded: alreadyAddedRateIds.has(rate.id),
        source: 'rate',
        searchText: `${rate.itemName} ${rate.description} labour ${rate.unit}`.toLowerCase(),
      });
    }

    for (const asset of equipmentAssets) {
      const matchedRate = findMatchingRate('equipment', [asset.name, asset.type]);
      if (matchedRate) matchedEquipmentRateIds.add(matchedRate.id);
      if (asset.equipmentClassification === 'overhead') continue;
      const approvedChargeOutRate = Math.max(0, Number(asset.chargeOutRate ?? 0));
      const hasCatalogPricing = approvedChargeOutRate > 0;

      candidates.push({
        key: `equipment:${asset.id}`,
        category: 'equipment',
        displayName: asset.name,
        description: asset.type || 'Company equipment',
        unit: matchedRate?.unit ?? 'hr',
        priceText: hasCatalogPricing
          ? `${formatCurrency(approvedChargeOutRate)}/hr charge-out`
          : matchedRate
            ? `${formatCurrency(rateSellPrice(matchedRate))}/${matchedRate.unit} legacy budget rate`
            : 'No approved charge-out rate',
        rate: matchedRate ?? undefined,
        equipment: hasCatalogPricing ? asset : undefined,
        disabledReason: hasCatalogPricing || matchedRate ? undefined : 'Approve a charge-out rate in Budget Pricing & Analysis or use a custom item.',
        alreadyAdded: alreadyAddedEquipmentIds.has(asset.id) || (matchedRate ? alreadyAddedRateIds.has(matchedRate.id) : false),
        source: 'equipment',
        searchText: `${asset.name} ${asset.type} equipment ${matchedRate?.description ?? ''}`.toLowerCase(),
      });
    }

    for (const material of materialCatalogItems) {
      const matchedRate = findMatchingRate('material', [material.name, material.unit, material.notes]);
      if (matchedRate) matchedMaterialRateIds.add(matchedRate.id);

      candidates.push({
        key: `material:${material.id}`,
        category: 'material',
        displayName: material.name,
        description: material.notes || `Unit: ${material.unit}`,
        unit: matchedRate?.unit ?? material.unit,
        priceText: matchedRate ? `${formatCurrency(rateSellPrice(matchedRate))}/${matchedRate.unit}` : 'No pricing rate in selected budget',
        rate: matchedRate ?? undefined,
        disabledReason: matchedRate ? undefined : 'Add a material pricing rate to the selected budget or use a custom item.',
        alreadyAdded: matchedRate ? alreadyAddedRateIds.has(matchedRate.id) : false,
        source: 'material',
        searchText: `${material.name} ${material.unit} ${material.notes} material ${matchedRate?.description ?? ''}`.toLowerCase(),
      });
    }

    for (const rate of budgetRatesByCategory.subcontractor) {
      candidates.push({
        key: `rate:${rate.id}`,
        category: 'subcontractor',
        displayName: rate.itemName,
        description: rate.description || 'Subcontractor estimating rate',
        unit: rate.unit,
        priceText: `${formatCurrency(rateSellPrice(rate))}/${rate.unit}`,
        rate,
        alreadyAdded: alreadyAddedRateIds.has(rate.id),
        source: 'rate',
        searchText: `${rate.itemName} ${rate.description} subcontractor ${rate.unit}`.toLowerCase(),
      });
    }

    return candidates;
  }, [budgetRatesByCategory, equipmentAssets, estimateDivision?.name, estimatePricingCatalog, form?.lineItems, materialCatalogItems, pricingBudget?.planningModel]);

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
      accumulator[category] = (form?.lineItems ?? []).filter((item) => item.category === category);
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

  const deleteLineItem = (lineItemId: string) => {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        lineItems: current.lineItems.filter((item) => item.id !== lineItemId),
      };
    });
  };

  const handleAddFromCandidate = (candidate: CatalogCandidate) => {
    if (candidate.alreadyAdded || (!candidate.rate && !candidate.equipment && !candidate.pricingItem?.pricingAvailable) || addingCandidateKey === candidate.key) return;

    setAddingCandidateKey(candidate.key);
    setForm((current) => {
      if (!current) return current;

      const applied = candidate.pricingItem
        ? applyEstimatePricingToLineItem(createEmptyEstimateLineItem(candidate.category), estimate.pricingBudgetId, candidate.pricingItem)
        : candidate.equipment
          ? applyEquipmentAssetToEstimateLineItem(createEmptyEstimateLineItem('equipment'), candidate.equipment)
          : applyBudgetRateToEstimateLineItem(createEmptyEstimateLineItem(candidate.category), candidate.rate!);
      const nextItem = calculateEstimateLineItem({
        ...applied,
        itemName: candidate.displayName,
        description: candidate.description || applied.description,
      });

      return {
        ...current,
        lineItems: [...current.lineItems, nextItem],
      };
    });

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
      lineItems: [...current.lineItems, nextItem],
    } : current);
    setCustomItemOpen(false);
  };

  const persistWorkArea = async (goBack: boolean) => {
    if (savingWorkArea) return;

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

    if (!saved) return;

    emitAppToast({ tone: 'success', message: 'Work area saved.' });

    if (goBack) {
      navigate(`/estimates/${estimate.id}?tab=work-areas`);
    }
  };

  const handleBack = () => {
    if (isDirty && !window.confirm('You have unsaved changes. Leave this work area without saving?')) {
      return;
    }
    navigate(`/estimates/${estimate.id}?tab=work-areas`);
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
      ) : pricingBudget?.planningModel === 'divisions_v1' && visibleCatalogCandidates.length > 0 && visibleCatalogCandidates.every((candidate) => !candidate.pricingItem?.pricingAvailable) ? (
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
          action={pricingBudget?.planningModel === 'divisions_v1' && catalogCategory === 'labour'
            ? <Link to="/materials/catalog?catalog=labour"><Button variant="secondary">Set up Labour Classes in Catalog</Button></Link>
            : <Button variant="secondary" onClick={() => openCustomItem(catalogCategory)}>Custom {CATEGORY_ADD_LABEL[catalogCategory]}</Button>}
        />
      ) : !catalogLoading && !catalogError ? (
        <div className="space-y-3">
          {visibleCatalogCandidates.map((candidate) => {
            const canAdd = Boolean(candidate.pricingItem?.pricingAvailable || candidate.rate || candidate.equipment);
            return (
            <div key={candidate.key} className="rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900 dark:text-brand-50">{candidate.displayName}</p>
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
              {!canAdd && candidate.disabledReason ? <p className="mt-2 text-xs text-accent-700">{candidate.disabledReason}</p> : null}
            </div>
          );})}
        </div>
      ) : null}
    </div>
  );

  const renderLineItemGroup = (category: LineItemCategory) => {
    const items = groupedLineItems[category];

    return (
      <Card key={category} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">{CATEGORY_LABEL[category]}</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-brand-300">{items.length} item{items.length === 1 ? '' : 's'}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => openCatalog(category)}>
            <Plus size={14} /> Add {CATEGORY_ADD_LABEL[category]}
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-brand-300">No {CATEGORY_LABEL[category].toLowerCase()} items added yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-brand-100 dark:border-brand-600">
            <div className="hidden min-w-[1120px] grid-cols-[minmax(180px,1.4fr)_110px_repeat(6,minmax(105px,0.7fr))_76px] gap-3 border-b border-brand-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-200 lg:grid">
              <span>Item</span><span>Quantity</span><span className="text-right">Cost</span><span className="text-right">Breakeven</span><span className="text-right">Total Cost</span><span className="text-right">Profit</span><span className="text-right">Price</span><span className="text-right">Total Price</span><span className="text-right">Actions</span>
            </div>
            {items.map((lineItem) => {
              const isBudgetPriced = Boolean(lineItem.sourceBudgetItemId || lineItem.sourceRateId || lineItem.equipmentId);
              const usesHours = category === 'labour' || category === 'equipment';
              const quantityLabel = usesHours ? 'Hours' : 'Quantity';
              const isExpanded = expandedLineItemIds.has(lineItem.id);
              const economics = getEstimateLinePricingEconomics(lineItem);
              const unitPrice = (value: number | null) => value === null ? 'Not available' : `${formatCurrency(value)}/${lineItem.unit}`;
              return (
              <div key={lineItem.id} className="border-b border-brand-100 bg-brand-50/40 last:border-b-0 dark:border-brand-600 dark:bg-brand-900/20">
                <div className="grid min-w-[1120px] grid-cols-[minmax(180px,1.4fr)_110px_repeat(6,minmax(105px,0.7fr))_76px] items-center gap-3 px-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900 dark:text-brand-50">{lineItem.itemName || lineItem.description || 'Untitled Item'}</p>
                    <p className="mt-0.5 truncate text-xs capitalize text-gray-500 dark:text-brand-300">{CATEGORY_LABEL[lineItem.category]}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-brand-300">
                    <span className="sr-only">{quantityLabel}</span>
                    <input
                      aria-label={`${quantityLabel} for ${lineItem.itemName || lineItem.description || 'item'}`}
                      type="text"
                      inputMode="decimal"
                      value={formatNumericDisplayValue(lineItem.quantity)}
                      onChange={(event) => setLineItem(lineItem.id, 'quantity', parseNumericInputValue(event.target.value))}
                      onFocus={(event) => event.currentTarget.select()}
                      className="h-9 w-20 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50"
                    />
                    {usesHours || isBudgetPriced ? <span>{lineItem.unit}</span> : <input aria-label={`Unit for ${lineItem.itemName || lineItem.description || 'item'}`} value={lineItem.unit} onChange={(event) => setLineItem(lineItem.id, 'unit', event.target.value)} className="h-9 w-16 rounded-md border border-brand-100 bg-white px-2 text-sm text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" />}
                  </label>
                  <p className="text-right font-medium tabular-nums text-gray-700 dark:text-brand-100">{unitPrice(economics.cost)}</p>
                  <p className="text-right font-medium tabular-nums text-gray-700 dark:text-brand-100">{unitPrice(economics.breakeven)}</p>
                  <p className="text-right font-medium tabular-nums text-gray-900 dark:text-brand-50">{formatCurrency(economics.totalCost)}</p>
                  <p className="text-right font-medium tabular-nums text-gray-700 dark:text-brand-100">{economics.profitPercent === null ? 'Not available' : `${economics.profitPercent}%`}</p>
                  <div className="text-right text-gray-700 dark:text-brand-100">
                    {isBudgetPriced ? <span className="font-medium tabular-nums">{unitPrice(economics.price)}</span> : <label className="flex items-center justify-end gap-1"><span className="sr-only">Price</span><input aria-label={`Price for ${lineItem.itemName || lineItem.description || 'item'}`} type="text" inputMode="decimal" value={formatNumericDisplayValue(lineItem.sellPrice)} onChange={(event) => setLineItem(lineItem.id, 'sellPrice', parseNumericInputValue(event.target.value))} onFocus={(event) => event.currentTarget.select()} className="h-9 w-20 rounded-md border border-brand-100 bg-white px-2 text-right text-sm font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /><span>/{lineItem.unit}</span></label>}
                  </div>
                  <p className="text-right text-base font-semibold tabular-nums text-gray-900 dark:text-brand-50" aria-label="Total Price">{formatCurrency(economics.totalPrice)}</p>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" title={isExpanded ? 'Collapse item details' : 'Edit description and notes'} aria-expanded={isExpanded} onClick={() => setExpandedLineItemIds((current) => { const next = new Set(current); if (next.has(lineItem.id)) next.delete(lineItem.id); else next.add(lineItem.id); return next; })} className="rounded-md p-2 text-gray-400 hover:bg-white hover:text-brand-700 dark:hover:bg-brand-700 dark:hover:text-brand-100">
                      <Pencil size={14} />
                    </button>
                    <button type="button" title="Delete item" onClick={() => deleteLineItem(lineItem.id)} className="rounded-md p-2 text-gray-400 hover:bg-white hover:text-accent-700 dark:hover:bg-brand-700">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {isExpanded ? <div className="grid gap-3 border-t border-brand-100 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_12rem] dark:border-brand-600">
                  <label className="block text-xs font-medium text-gray-600 dark:text-brand-200">Description / Notes<textarea rows={2} value={lineItem.description} onChange={(event) => setLineItem(lineItem.id, 'description', event.target.value)} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm font-normal text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label>
                  {!isBudgetPriced ? <label className="block text-xs font-medium text-gray-600 dark:text-brand-200">Estimated Cost / {lineItem.unit}<input type="text" inputMode="decimal" value={formatNumericDisplayValue(lineItem.unitCost)} onChange={(event) => setLineItem(lineItem.id, 'unitCost', parseNumericInputValue(event.target.value))} onFocus={(event) => event.currentTarget.select()} className="mt-1 h-10 w-full rounded-lg border border-brand-100 bg-white px-3 text-right text-sm font-normal text-brand-900 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50" /></label> : <div />}
                </div> : null}
              </div>
            );})}
          </div>
        )}
      </Card>
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
          <Button variant="secondary" onClick={handleBack}>
            <ArrowLeft size={15} /> Back to Estimate
          </Button>
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
              value={form.name}
              onChange={(event) => setForm((current) => current ? { ...current, name: event.target.value } : current)}
            />
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
            <TextArea
              label="Description / Scope"
              value={form.description}
              onChange={(event) => setForm((current) => current ? { ...current, description: event.target.value } : current)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" onClick={() => setConfirmDeleteOpen(true)}>
                <Trash2 size={14} /> Delete Work Area
              </Button>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => void persistWorkArea(false)} disabled={!isDirty || savingWorkArea}>Save</Button>
                <Button onClick={() => void persistWorkArea(true)} disabled={savingWorkArea}>Save &amp; Back</Button>
              </div>
            </div>
          </Card>
      </div>

      {showCatalogSheet ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCatalogSheet(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md bg-white dark:bg-brand-800 shadow-2xl flex flex-col">
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
            <div className="border-t border-brand-100 dark:border-brand-600 p-4">
              <Button variant="secondary" className="w-full" onClick={() => openCustomItem(catalogCategory)}>
                <Plus size={14} /> Custom {CATEGORY_ADD_LABEL[catalogCategory]}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
    </div>
  );
}