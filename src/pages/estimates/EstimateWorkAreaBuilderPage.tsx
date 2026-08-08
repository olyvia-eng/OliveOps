import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Search, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { emitAppToast } from '../../toast';
import { formatCurrency, statusColor } from '../../utils';
import {
  applyBudgetRateToEstimateLineItem,
  calculateEstimateLineItem,
  computeWorkAreaCategoryCostTotals,
  computeWorkAreaEstimatedCost,
  computeWorkAreaSubtotal,
  createEmptyEstimateLineItem,
  flattenWorkAreaLineItems,
  normalizeEstimateWorkAreas,
} from '../../utils/estimateModel';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import type { BudgetRate, Estimate, EstimateLineItem, LineItemCategory } from '../../types';

interface Props {
  currentUserRole: string;
}

type WorkAreaBuilderForm = {
  name: string;
  description: string;
  lineItems: EstimateLineItem[];
};

type CatalogFilter = 'all' | LineItemCategory;

type CatalogCandidate = {
  key: string;
  category: LineItemCategory;
  displayName: string;
  description: string;
  unit: string;
  priceText: string;
  rate?: BudgetRate;
  disabledReason?: string;
  alreadyAdded: boolean;
  source: 'rate' | 'equipment' | 'material';
  searchText: string;
};

const CATEGORY_ORDER: LineItemCategory[] = ['labour', 'equipment', 'material', 'subcontractor'];

const CATEGORY_LABEL: Record<LineItemCategory, string> = {
  labour: 'Labour',
  equipment: 'Equipment',
  material: 'Materials',
  subcontractor: 'Subcontractors',
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
  const { estimates, customers, budgets, budgetRates, equipmentAssets, materialCatalogItems, updateEstimate } = useStore();

  const estimate = estimates.find((item) => item.id === id);
  const customer = customers.find((item) => item.id === estimate?.customerId);
  const pricingBudget = budgets.find((budget) => budget.id === estimate?.pricingBudgetId);
  const workAreas = useMemo(() => (estimate ? normalizeEstimateWorkAreas(estimate) : []), [estimate]);
  const workArea = useMemo(() => workAreas.find((area) => area.id === workAreaId) ?? null, [workAreaId, workAreas]);

  const [form, setForm] = useState<WorkAreaBuilderForm | null>(workArea ? {
    name: workArea.name,
    description: workArea.description,
    lineItems: workArea.lineItems,
  } : null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all');
  const [showCatalogSheet, setShowCatalogSheet] = useState(false);
  const [addingCandidateKey, setAddingCandidateKey] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [customItemOpen, setCustomItemOpen] = useState(false);
  const [customItemCategory, setCustomItemCategory] = useState<LineItemCategory>('labour');
  const [customItem, setCustomItem] = useState({
    category: 'labour' as LineItemCategory,
    description: '',
    quantity: 1,
    unit: 'hr',
    unitCost: 0,
    markupPercent: 0,
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

  if (!estimate || !workArea || !form) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" onClick={() => navigate(id ? `/estimates/${id}?tab=work-areas` : '/estimates')}>
          <ArrowLeft size={15} /> Back to Estimate
        </Button>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Work area not found</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-brand-200">This work area may have been removed or is still syncing.</p>
        </Card>
      </div>
    );
  }

  const selectedBudgetRates = budgetRates
    .filter((rate) => rate.active && rate.budgetId === estimate.pricingBudgetId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.itemName.localeCompare(b.itemName));

  const budgetRatesByCategory = CATEGORY_ORDER.reduce<Record<LineItemCategory, BudgetRate[]>>((accumulator, category) => {
    accumulator[category] = selectedBudgetRates.filter((rate) => rate.category === category);
    return accumulator;
  }, {
    labour: [],
    equipment: [],
    material: [],
    subcontractor: [],
  });

  const findMatchingRate = (category: LineItemCategory, values: string[]) => {
    const normalizedValues = values.map(normalizeKey).filter(Boolean);
    if (normalizedValues.length === 0) return null;

    return budgetRatesByCategory[category].find((rate) => {
      const rateTexts = [rate.itemName, rate.description].map(normalizeKey).filter(Boolean);
      return normalizedValues.some((value) => rateTexts.some((text) => text === value || text.includes(value) || value.includes(text)));
    }) ?? null;
  };

  const catalogCandidates = useMemo(() => {
    const alreadyAddedRateIds = new Set(form.lineItems.map((item) => item.sourceRateId).filter((value): value is string => Boolean(value)));
    const candidates: CatalogCandidate[] = [];
    const matchedEquipmentRateIds = new Set<string>();
    const matchedMaterialRateIds = new Set<string>();

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
      const matchedRate = findMatchingRate('equipment', [asset.name, asset.type, asset.serialNumber]);
      if (matchedRate) matchedEquipmentRateIds.add(matchedRate.id);

      candidates.push({
        key: `equipment:${asset.id}`,
        category: 'equipment',
        displayName: asset.name,
        description: [asset.type, asset.serialNumber].filter(Boolean).join(' • ') || 'Company equipment',
        unit: matchedRate?.unit ?? 'hr',
        priceText: matchedRate ? `${formatCurrency(rateSellPrice(matchedRate))}/${matchedRate.unit}` : 'No pricing rate in selected budget',
        rate: matchedRate ?? undefined,
        disabledReason: matchedRate ? undefined : 'Add an equipment pricing rate to the selected budget or use a custom item.',
        alreadyAdded: matchedRate ? alreadyAddedRateIds.has(matchedRate.id) : false,
        source: 'equipment',
        searchText: `${asset.name} ${asset.type} ${asset.serialNumber} equipment ${matchedRate?.description ?? ''}`.toLowerCase(),
      });
    }

    for (const rate of budgetRatesByCategory.equipment.filter((value) => !matchedEquipmentRateIds.has(value.id))) {
      candidates.push({
        key: `rate:${rate.id}`,
        category: 'equipment',
        displayName: rate.itemName,
        description: rate.description || 'Equipment pricing rate',
        unit: rate.unit,
        priceText: `${formatCurrency(rateSellPrice(rate))}/${rate.unit}`,
        rate,
        alreadyAdded: alreadyAddedRateIds.has(rate.id),
        source: 'rate',
        searchText: `${rate.itemName} ${rate.description} equipment ${rate.unit}`.toLowerCase(),
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

    for (const rate of budgetRatesByCategory.material.filter((value) => !matchedMaterialRateIds.has(value.id))) {
      candidates.push({
        key: `rate:${rate.id}`,
        category: 'material',
        displayName: rate.itemName,
        description: rate.description || 'Material pricing rate',
        unit: rate.unit,
        priceText: `${formatCurrency(rateSellPrice(rate))}/${rate.unit}`,
        rate,
        alreadyAdded: alreadyAddedRateIds.has(rate.id),
        source: 'rate',
        searchText: `${rate.itemName} ${rate.description} material ${rate.unit}`.toLowerCase(),
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
  }, [budgetRatesByCategory, equipmentAssets, form.lineItems, materialCatalogItems]);

  const visibleCatalogCandidates = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return catalogCandidates.filter((candidate) => {
      const matchesFilter = catalogFilter === 'all' || candidate.category === catalogFilter;
      const matchesSearch = query.length === 0 || candidate.searchText.includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [catalogCandidates, catalogFilter, catalogSearch]);

  const groupedLineItems = useMemo(() => {
    return CATEGORY_ORDER.reduce<Record<LineItemCategory, EstimateLineItem[]>>((accumulator, category) => {
      accumulator[category] = form.lineItems.filter((item) => item.category === category);
      return accumulator;
    }, {
      labour: [],
      equipment: [],
      material: [],
      subcontractor: [],
    });
  }, [form.lineItems]);

  const workAreaSummary = useMemo(() => {
    const currentWorkArea = {
      ...workArea,
      name: form.name,
      description: form.description,
      lineItems: form.lineItems,
    };

    return {
      estimatedCost: computeWorkAreaEstimatedCost(currentWorkArea),
      sellPrice: computeWorkAreaSubtotal(currentWorkArea),
      categoryCosts: computeWorkAreaCategoryCostTotals(currentWorkArea),
    };
  }, [form, workArea]);

  const setLineItem = (lineItemId: string, key: keyof EstimateLineItem, value: unknown) => {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        lineItems: current.lineItems.map((item) => {
          if (item.id !== lineItemId) return item;
          return calculateEstimateLineItem(
            { ...item, [key]: value } as EstimateLineItem,
            { recalculateSellPrice: key === 'unitCost' || key === 'markupPercent' }
          );
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
    if (!candidate.rate || addingCandidateKey === candidate.key) return;
    const rate = candidate.rate;

    setAddingCandidateKey(candidate.key);
    setForm((current) => {
      if (!current) return current;

      const applied = applyBudgetRateToEstimateLineItem(createEmptyEstimateLineItem(candidate.category), rate);
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
      markupPercent: 0,
      sellPrice: 0,
    });
    setCustomItemOpen(true);
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
      markupPercent: customItem.markupPercent,
      sellPrice: customItem.sellPrice,
    }, { recalculateSellPrice: customItem.sellPrice <= 0 });

    setForm((current) => current ? {
      ...current,
      lineItems: [...current.lineItems, nextItem],
    } : current);
    setCustomItemOpen(false);
  };

  const persistWorkArea = (goBack: boolean) => {
    const nextWorkAreas = workAreas.map((area) => (
      area.id === workArea.id
        ? {
            ...area,
            name: form.name.trim() || area.name,
            description: form.description,
            lineItems: form.lineItems,
          }
        : area
    ));

    const payload = createWorkAreaPayload(estimate, nextWorkAreas);
    updateEstimate(estimate.id, payload);
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

  const handleDeleteWorkArea = () => {
    const nextWorkAreas = workAreas
      .filter((area) => area.id !== workArea.id)
      .map((area, index) => ({ ...area, sortOrder: index }));
    const payload = createWorkAreaPayload(estimate, nextWorkAreas);
    updateEstimate(estimate.id, payload);
    emitAppToast({ tone: 'success', message: 'Work area deleted.' });
    navigate(`/estimates/${estimate.id}?tab=work-areas`);
  };

  const renderCatalogPanel = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Add Items</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Pricing comes from {pricingBudget?.name ?? 'the selected estimate budget'}.</p>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={catalogSearch}
            onChange={(event) => setCatalogSearch(event.target.value)}
            placeholder="Search catalog..."
            className="h-10 w-full rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 pl-9 pr-3 text-sm text-brand-900 dark:text-brand-50 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-500/40"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(['all', ...CATEGORY_ORDER] as CatalogFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCatalogFilter(value)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${catalogFilter === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 text-gray-700 dark:text-brand-100 hover:bg-brand-50 dark:hover:bg-brand-600'}`}
            >
              {value === 'all' ? 'All' : CATEGORY_LABEL[value]}
            </button>
          ))}
        </div>
      </div>

      {visibleCatalogCandidates.length === 0 ? (
        <EmptyState
          title={catalogFilter === 'equipment' ? 'No equipment found' : catalogFilter === 'material' ? 'No materials found' : 'No catalog items found'}
          description={catalogFilter === 'equipment'
            ? 'Add equipment to your company catalog or use a custom item.'
            : catalogFilter === 'material'
              ? 'Add materials to your company catalog or use a custom item.'
              : 'Try a different search, switch categories, or use a custom item.'}
          action={<Button variant="secondary" onClick={() => openCustomItem(catalogFilter === 'all' ? 'labour' : catalogFilter)}>Custom Item</Button>}
        />
      ) : (
        <div className="space-y-3">
          {visibleCatalogCandidates.map((candidate) => (
            <div key={candidate.key} className="rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900 dark:text-brand-50">{candidate.displayName}</p>
                    <Badge label={CATEGORY_LABEL[candidate.category]} className="bg-gray-100 text-gray-700" />
                    {candidate.alreadyAdded ? <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Already added</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">{candidate.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-brand-50">{candidate.priceText}</p>
                  <Button
                    size="sm"
                    variant={candidate.rate ? 'secondary' : 'ghost'}
                    onClick={() => handleAddFromCandidate(candidate)}
                    disabled={!candidate.rate || addingCandidateKey === candidate.key}
                    className="mt-2"
                    title={candidate.disabledReason}
                  >
                    <Plus size={14} /> Add
                  </Button>
                </div>
              </div>
              {!candidate.rate && candidate.disabledReason ? <p className="mt-2 text-xs text-accent-700">{candidate.disabledReason}</p> : null}
            </div>
          ))}
        </div>
      )}
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
          <Button variant="secondary" size="sm" onClick={() => openCustomItem(category)}>
            <Plus size={14} /> Custom Item
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-brand-300">No {CATEGORY_LABEL[category].toLowerCase()} items added yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {items.map((lineItem) => (
              <div key={lineItem.id} className="rounded-xl border border-brand-100 dark:border-brand-600 bg-brand-50/40 dark:bg-brand-900/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 dark:text-brand-50">{lineItem.itemName || lineItem.description || 'Untitled Item'}</p>
                    {lineItem.sourceRateId ? <p className="mt-1 text-xs text-gray-500 dark:text-brand-300">Pricing snapshot from selected budget</p> : null}
                  </div>
                  <button type="button" onClick={() => deleteLineItem(lineItem.id)} className="rounded-lg p-2 text-gray-400 hover:bg-white hover:text-accent-700 dark:hover:bg-brand-700">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div className="xl:col-span-2">
                    <label className="text-xs font-medium text-gray-600 dark:text-brand-200">Description</label>
                    <textarea
                      rows={2}
                      value={lineItem.description}
                      onChange={(event) => setLineItem(lineItem.id, 'description', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 py-2 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-brand-200">Quantity</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatNumericDisplayValue(lineItem.quantity)}
                      onChange={(event) => setLineItem(lineItem.id, 'quantity', parseNumericInputValue(event.target.value))}
                      onFocus={(event) => event.currentTarget.select()}
                      className="mt-1 h-10 w-full rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 text-sm text-right text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-brand-200">Unit</label>
                    <input
                      value={lineItem.unit}
                      onChange={(event) => setLineItem(lineItem.id, 'unit', event.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-brand-200">Unit Cost</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatNumericDisplayValue(lineItem.unitCost)}
                      onChange={(event) => setLineItem(lineItem.id, 'unitCost', parseNumericInputValue(event.target.value))}
                      onFocus={(event) => event.currentTarget.select()}
                      className="mt-1 h-10 w-full rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 text-sm text-right text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-brand-200">Markup %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatNumericDisplayValue(lineItem.markupPercent)}
                      onChange={(event) => setLineItem(lineItem.id, 'markupPercent', parseNumericInputValue(event.target.value))}
                      onFocus={(event) => event.currentTarget.select()}
                      className="mt-1 h-10 w-full rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 text-sm text-right text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-brand-200">Sell Price</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatNumericDisplayValue(lineItem.sellPrice)}
                      onChange={(event) => setLineItem(lineItem.id, 'sellPrice', parseNumericInputValue(event.target.value))}
                      onFocus={(event) => event.currentTarget.select()}
                      className="mt-1 h-10 w-full rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 text-sm text-right text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                    />
                  </div>
                  <div className="rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 py-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-brand-200">Estimated Cost</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(lineItem.quantity * lineItem.unitCost)}</p>
                  </div>
                  <div className="rounded-lg border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 px-3 py-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-brand-200">Sell Total</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(lineItem.total)}</p>
                  </div>
                </div>
              </div>
            ))}
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

      <div className="flex flex-wrap items-center justify-between gap-3 lg:hidden">
        <Button variant="secondary" onClick={() => setShowCatalogSheet(true)}>
          <Plus size={14} /> Add Items
        </Button>
        <Button variant="secondary" onClick={() => openCustomItem('labour')}>Custom Item</Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card className="p-4 space-y-4">
            <Input
              label="Work Area Name"
              required
              value={form.name}
              onChange={(event) => setForm((current) => current ? { ...current, name: event.target.value } : current)}
            />
            <TextArea
              label="Description / Scope"
              value={form.description}
              onChange={(event) => setForm((current) => current ? { ...current, description: event.target.value } : current)}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-brand-300">
              <span>Estimate: {estimate.title}</span>
              {pricingBudget ? <span>• Pricing Budget: {pricingBudget.name}</span> : null}
            </div>
          </Card>

          {CATEGORY_ORDER.map(renderLineItemGroup)}

          <Card className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Work Area Totals</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Estimate pricing remains tied to the selected budget. Added items are stored as snapshots.</p>
              </div>
              <Button variant="secondary" onClick={() => setConfirmDeleteOpen(true)}>
                <Trash2 size={14} /> Delete Work Area
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-brand-50/60 dark:bg-brand-900/20 p-3">
                <p className="text-xs text-gray-500 dark:text-brand-300">Estimated Cost</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(workAreaSummary.estimatedCost)}</p>
              </div>
              <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-brand-50/60 dark:bg-brand-900/20 p-3">
                <p className="text-xs text-gray-500 dark:text-brand-300">Sell Price</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(workAreaSummary.sellPrice)}</p>
              </div>
              <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-brand-50/60 dark:bg-brand-900/20 p-3">
                <p className="text-xs text-gray-500 dark:text-brand-300">Line Items</p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-brand-50">{form.lineItems.length}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 text-sm">
              {CATEGORY_ORDER.map((category) => (
                <p key={category} className="text-gray-700 dark:text-brand-100">
                  {CATEGORY_LABEL[category]} <span className="ml-2 font-semibold">{formatCurrency(workAreaSummary.categoryCosts[category])}</span>
                </p>
              ))}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => persistWorkArea(false)} disabled={!isDirty}>Save</Button>
              <Button onClick={() => persistWorkArea(true)}>Save &amp; Back</Button>
            </div>
          </Card>
        </div>

        <div className="hidden lg:block">
          <Card className="sticky top-20 p-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
            {renderCatalogPanel()}
          </Card>
        </div>
      </div>

      {showCatalogSheet ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCatalogSheet(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md bg-white dark:bg-brand-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-brand-100 dark:border-brand-600 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Add Items</h2>
                <p className="text-xs text-gray-500 dark:text-brand-300">{pricingBudget?.name ?? 'Selected pricing budget'}</p>
              </div>
              <button type="button" onClick={() => setShowCatalogSheet(false)} className="rounded-lg p-2 text-gray-400 hover:bg-brand-50 hover:text-gray-700 dark:hover:bg-brand-700 dark:text-brand-300">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {renderCatalogPanel()}
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        open={customItemOpen}
        onClose={() => setCustomItemOpen(false)}
        title={`Custom ${CATEGORY_LABEL[customItemCategory]} Item`}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCustomItemOpen(false)}>Cancel</Button>
            <Button onClick={saveCustomItem}>Add Item</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Select label="Category" value={customItem.category} onChange={(event) => setCustomItem((current) => ({ ...current, category: event.target.value as LineItemCategory }))}>
            {CATEGORY_ORDER.map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
          </Select>
          <TextArea label="Description" value={customItem.description} onChange={(event) => setCustomItem((current) => ({ ...current, description: event.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" min={0} value={customItem.quantity} onChange={(event) => setCustomItem((current) => ({ ...current, quantity: Number(event.target.value) }))} />
            <Input label="Unit" value={customItem.unit} onChange={(event) => setCustomItem((current) => ({ ...current, unit: event.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Unit Cost" type="number" min={0} value={customItem.unitCost} onChange={(event) => setCustomItem((current) => ({ ...current, unitCost: Number(event.target.value) }))} />
            <Input label="Markup %" type="number" min={0} value={customItem.markupPercent} onChange={(event) => setCustomItem((current) => ({ ...current, markupPercent: Number(event.target.value) }))} />
            <Input label="Sell Price" type="number" min={0} value={customItem.sellPrice} onChange={(event) => setCustomItem((current) => ({ ...current, sellPrice: Number(event.target.value) }))} />
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title={`Delete ${workArea.name}?`}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleDeleteWorkArea}>Delete Work Area</Button>
          </>
        )}
      >
        <p className="text-sm text-gray-600 dark:text-brand-200">This will remove {form.lineItems.length} estimate line item{form.lineItems.length === 1 ? '' : 's'} from this work area.</p>
      </Modal>
    </div>
  );
}