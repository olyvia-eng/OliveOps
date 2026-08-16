import { useMemo, useState } from 'react';
import { PlusCircle, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import {
  closeDetailWorkspace,
  openDetailWorkspace,
  readDetailWorkspaceQuery,
  setDetailWorkspaceMode,
  setDetailWorkspaceTab,
} from '../../components/detail-workspace/detailWorkspaceQuery';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import type { EquipmentAsset } from '../../types';
import EquipmentInfoForm, {
  emptyEquipmentInfoFormValue,
  type EquipmentInfoFormValue,
} from '../../components/equipment/EquipmentInfoForm';
import { calculateEquipmentCostBreakdown, resolveEquipmentCostRate } from '../../utils/equipmentPricing';
import EquipmentDetailPanel, { type EquipmentDetailTab } from './EquipmentDetailPanel';

const EQUIPMENT_WORKSPACE_QUERY = { recordParam: 'equipment', tabParam: 'equipmentTab', defaultTab: 'overview' } as const;
const EQUIPMENT_DETAIL_TABS: EquipmentDetailTab[] = ['overview', 'pricing', 'budgets'];

type MaterialCatalogRow = {
  key: string;
  name: string;
  catalogMentions: number;
  estimateMentions: number;
  jobCostMentions: number;
  expenseMentions: number;
  referencedJobs: number;
  totalPlannedOrSpent: number;
  avgUnitCost: number;
  unit: string;
  notes: string;
  defaultUnitCostTotal: number;
};

type MaterialSort = 'highest_value' | 'most_referenced' | 'name';

interface MaterialFormState {
  name: string;
  unit: string;
  defaultUnitCost: number;
  notes: string;
}

const emptyMaterialForm = (): MaterialFormState => ({
  name: '',
  unit: 'unit',
  defaultUnitCost: 0,
  notes: '',
});

const toMaterialKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export default function EquipmentCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const equipmentAssets = useStore((state) => state.equipmentAssets);
  const budgets = useStore((state) => state.budgets);
  const budgetGroups = useStore((state) => state.budgetGroups);
  const budgetItems = useStore((state) => state.budgetItems);
  const equipmentBudgetAllocations = useStore((state) => state.equipmentBudgetAllocations);
  const budgetRates = useStore((state) => state.budgetRates);
  const materialCatalogItems = useStore((state) => state.materialCatalogItems);
  const estimates = useStore((state) => state.estimates);
  const expenses = useStore((state) => state.expenses);
  const jobs = useStore((state) => state.jobs);
  const addEquipmentAsset = useStore((state) => state.addEquipmentAsset);
  const addMaterialCatalogItem = useStore((state) => state.addMaterialCatalogItem);
  const updateEquipmentAsset = useStore((state) => state.updateEquipmentAsset);
  const deleteEquipmentAsset = useStore((state) => state.deleteEquipmentAsset);

  const [form, setForm] = useState<EquipmentInfoFormValue>(emptyEquipmentInfoFormValue());
  const [materialForm, setMaterialForm] = useState<MaterialFormState>(emptyMaterialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [showEquipmentCalcDetails, setShowEquipmentCalcDetails] = useState(false);
  const [equipmentQuery, setEquipmentQuery] = useState('');
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState('all');
  const [equipmentStatusFilter, setEquipmentStatusFilter] = useState('all');
  const [equipmentBudgetFilter, setEquipmentBudgetFilter] = useState('all');
  const [materialQuery, setMaterialQuery] = useState('');
  const [materialSort, setMaterialSort] = useState<MaterialSort>('highest_value');

  const sortedEquipment = useMemo(() => {
    return [...equipmentAssets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [equipmentAssets]);

  const workspace = readDetailWorkspaceQuery(searchParams, EQUIPMENT_WORKSPACE_QUERY);
  const selectedEquipment = equipmentAssets.find((asset) => asset.id === workspace.recordId) ?? null;
  const equipmentDetailTab = EQUIPMENT_DETAIL_TABS.includes(workspace.tab as EquipmentDetailTab)
    ? workspace.tab as EquipmentDetailTab
    : 'overview';
  const selectedAllocations = selectedEquipment
    ? equipmentBudgetAllocations.filter((allocation) => allocation.equipmentId === selectedEquipment.id)
    : [];
  const selectedPricingRate = selectedEquipment
    ? budgetRates
      .filter((rate) => {
        if (!rate.active || rate.category !== 'equipment') return false;
        if (rate.equipmentId) return rate.equipmentId === selectedEquipment.id;
        return rate.itemName.trim().toLowerCase() === selectedEquipment.name.trim().toLowerCase();
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    : undefined;
  const equipmentTypes = useMemo(() => Array.from(new Set(equipmentAssets.map((asset) => asset.type).filter(Boolean))).sort(), [equipmentAssets]);
  const visibleEquipment = useMemo(() => {
    const query = equipmentQuery.trim().toLowerCase();
    return sortedEquipment.filter((asset) => {
      const allocations = equipmentBudgetAllocations.filter((allocation) => allocation.equipmentId === asset.id);
      const matchesQuery = !query || [asset.name, asset.serialNumber, asset.type].some((value) => value?.toLowerCase().includes(query));
      const matchesType = equipmentTypeFilter === 'all' || asset.type === equipmentTypeFilter;
      const matchesStatus = equipmentStatusFilter === 'all' || asset.costType === equipmentStatusFilter;
      const matchesBudget = equipmentBudgetFilter === 'all' || allocations.some((allocation) => allocation.budgetId === equipmentBudgetFilter);
      return matchesQuery && matchesType && matchesStatus && matchesBudget;
    });
  }, [equipmentBudgetAllocations, equipmentBudgetFilter, equipmentQuery, equipmentStatusFilter, equipmentTypeFilter, sortedEquipment]);

  const selectEquipment = (equipmentId: string) => setSearchParams(openDetailWorkspace(searchParams, EQUIPMENT_WORKSPACE_QUERY, equipmentId));
  const closeEquipment = () => setSearchParams(closeDetailWorkspace(searchParams, EQUIPMENT_WORKSPACE_QUERY));
  const setWorkspaceMode = (mode: 'panel' | 'expanded') => setSearchParams(setDetailWorkspaceMode(searchParams, EQUIPMENT_WORKSPACE_QUERY, mode));
  const setEquipmentTab = (tab: EquipmentDetailTab) => setSearchParams(setDetailWorkspaceTab(searchParams, EQUIPMENT_WORKSPACE_QUERY, tab));

  const materialRows = useMemo<MaterialCatalogRow[]>(() => {
    const rows = new Map<string, MaterialCatalogRow>();
    const trackedJobIds = new Map<string, Set<string>>();

    const ensureRow = (name: string) => {
      const cleanName = name.trim() || 'Unspecified Material';
      const key = toMaterialKey(cleanName);
      const existing = rows.get(key);
      if (existing) return existing;

      const created: MaterialCatalogRow = {
        key,
        name: cleanName,
        catalogMentions: 0,
        estimateMentions: 0,
        jobCostMentions: 0,
        expenseMentions: 0,
        referencedJobs: 0,
        totalPlannedOrSpent: 0,
        avgUnitCost: 0,
        unit: 'unit',
        notes: '',
        defaultUnitCostTotal: 0,
      };
      rows.set(key, created);
      trackedJobIds.set(key, new Set<string>());
      return created;
    };

    for (const material of materialCatalogItems) {
      const row = ensureRow(material.name);
      row.catalogMentions += 1;
      row.defaultUnitCostTotal += Number(material.defaultUnitCost || 0);
      if (!row.notes && material.notes.trim()) {
        row.notes = material.notes.trim();
      }
      if (material.unit.trim()) {
        row.unit = material.unit.trim();
      }
    }

    for (const estimate of estimates) {
      for (const item of estimate.lineItems) {
        if (item.category !== 'material') continue;
        const row = ensureRow(item.description);
        row.estimateMentions += 1;
        row.totalPlannedOrSpent += item.total;
      }
    }

    for (const expense of expenses) {
      if (expense.category !== 'materials') continue;
      const row = ensureRow(expense.description || expense.vendor || 'Unspecified Material');
      row.expenseMentions += 1;
      row.totalPlannedOrSpent += expense.amount;
      if (expense.jobId) {
        trackedJobIds.get(row.key)?.add(expense.jobId);
      }
    }

    for (const job of jobs) {
      for (const cost of job.actualCosts) {
        if (cost.category !== 'material') continue;
        const row = ensureRow(cost.description);
        row.jobCostMentions += 1;
        row.totalPlannedOrSpent += cost.total;
        trackedJobIds.get(row.key)?.add(job.id);
      }
    }

    const result = Array.from(rows.values()).map((row) => {
      const mentions = row.catalogMentions + row.estimateMentions + row.expenseMentions + row.jobCostMentions;
      const referencedJobs = trackedJobIds.get(row.key)?.size ?? 0;
      return {
        ...row,
        referencedJobs,
        avgUnitCost: mentions > 0
          ? (row.totalPlannedOrSpent + row.defaultUnitCostTotal) / mentions
          : 0,
      };
    });

    return result.sort((a, b) => b.totalPlannedOrSpent - a.totalPlannedOrSpent || a.name.localeCompare(b.name));
  }, [estimates, expenses, jobs, materialCatalogItems]);

  const materialSummary = useMemo(() => {
    const totalValue = materialRows.reduce((sum, row) => sum + row.totalPlannedOrSpent, 0);
    const mostReferenced = materialRows.reduce((best, row) => {
      const rowMentions = row.estimateMentions + row.jobCostMentions + row.expenseMentions;
      const bestMentions = best ? best.estimateMentions + best.jobCostMentions + best.expenseMentions : -1;
      return rowMentions > bestMentions ? row : best;
    }, null as MaterialCatalogRow | null);

    return {
      totalValue,
      mostReferenced,
    };
  }, [materialRows]);

  const visibleMaterialRows = useMemo(() => {
    const query = materialQuery.trim().toLowerCase();
    const filtered = query.length === 0
      ? [...materialRows]
      : materialRows.filter((row) => row.name.toLowerCase().includes(query));

    filtered.sort((a, b) => {
      if (materialSort === 'name') {
        return a.name.localeCompare(b.name);
      }

      if (materialSort === 'most_referenced') {
        const aMentions = a.estimateMentions + a.jobCostMentions + a.expenseMentions;
        const bMentions = b.estimateMentions + b.jobCostMentions + b.expenseMentions;
        return bMentions - aMentions || b.totalPlannedOrSpent - a.totalPlannedOrSpent;
      }

      return b.totalPlannedOrSpent - a.totalPlannedOrSpent;
    });

    return filtered;
  }, [materialQuery, materialRows, materialSort]);

  const equipmentCostBreakdown = useMemo(() => {
    return calculateEquipmentCostBreakdown({
      equipmentCostType: form.equipmentCostType,
      equipmentPayment: form.equipmentPayment,
      equipmentPaymentFrequencyPerYear: form.equipmentPaymentFrequencyPerYear,
      yearlyFuelCost: form.yearlyFuelCost,
      yearlyInsuranceCost: form.yearlyInsuranceCost,
      yearlyMaintenanceCost: form.yearlyMaintenanceCost,
      sellableHoursPerYear: form.sellableHoursPerYear,
      equipmentHoursPerDay: form.equipmentHoursPerDay,
    });
  }, [form]);

  const resetForm = () => {
    setForm(emptyEquipmentInfoFormValue());
    setEditingId(null);
    setShowEquipmentCalcDetails(false);
  };

  const openAddEquipment = () => {
    resetForm();
    setEquipmentModalOpen(true);
  };

  const handleMaterialSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!materialForm.name.trim()) return;

    addMaterialCatalogItem({
      name: materialForm.name.trim(),
      unit: materialForm.unit.trim() || 'unit',
      defaultUnitCost: Number(materialForm.defaultUnitCost || 0),
      notes: materialForm.notes.trim(),
    });

    setMaterialForm(emptyMaterialForm());
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!form.description.trim()) {
      return;
    }

    const existingAsset = editingId ? equipmentAssets.find((asset) => asset.id === editingId) : undefined;
    const normalizedPayment = form.equipmentCostType === 'owned' ? 0 : Math.max(0, Number(form.equipmentPayment || 0));
    const normalizedFrequency = form.equipmentCostType === 'owned' ? 0 : Math.max(0, Number(form.equipmentPaymentFrequencyPerYear || 0));
    const payload = {
      name: form.description.trim(),
      type: (form.costCode.trim() || existingAsset?.type || 'General Equipment'),
      status: existingAsset?.status ?? 'available' as const,
      costType: form.equipmentCostType,
      equipmentClassification: form.equipmentClassification,
      serialNumber: existingAsset?.serialNumber ?? '',
      purchaseDate: existingAsset?.purchaseDate,
      hourlyCost: equipmentCostBreakdown.totalCostPerHour,
      purchasePrice: existingAsset?.purchasePrice,
      equipmentPayment: normalizedPayment,
      equipmentPaymentFrequencyPerYear: normalizedFrequency,
      yearlyFuelCost: Math.max(0, Number(form.yearlyFuelCost || 0)),
      ...(form.equipmentClassification === 'overhead' ? { recommendedSellRate: 0, chargeOutRate: 0 } : {}),
      yearlyInsuranceCost: Math.max(0, Number(form.yearlyInsuranceCost || 0)),
      yearlyMaintenanceCost: Math.max(0, Number(form.yearlyMaintenanceCost || 0)),
      notes: existingAsset?.notes ?? '',
    };

    if (editingId) {
      updateEquipmentAsset(editingId, payload);
    } else {
      addEquipmentAsset(payload);
    }

    resetForm();
    setEquipmentModalOpen(false);
  };

  const startEditing = (asset: EquipmentAsset) => {
    setEditingId(asset.id);
    setForm({
      description: asset.name,
      costCode: asset.type,
      equipmentCostType: asset.costType,
      equipmentClassification: asset.equipmentClassification ?? 'billable',
      equipmentPayment: asset.equipmentPayment ?? 0,
      equipmentPaymentFrequencyPerYear: asset.equipmentPaymentFrequencyPerYear ?? 12,
      yearlyFuelCost: asset.yearlyFuelCost ?? 0,
      yearlyInsuranceCost: asset.yearlyInsuranceCost ?? 0,
      yearlyMaintenanceCost: asset.yearlyMaintenanceCost ?? 0,
      sellableHoursPerYear: 0,
      equipmentHoursPerDay: 8,
    });
    setShowEquipmentCalcDetails(false);
    setEquipmentModalOpen(true);
  };

  const handleDelete = (asset: EquipmentAsset) => {
    const confirmed = window.confirm(`Remove ${asset.name} from the equipment catalog?`);
    if (!confirmed) return;
    deleteEquipmentAsset(asset.id);
    if (workspace.recordId === asset.id) closeEquipment();
    if (editingId === asset.id) {
      resetForm();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Materials & Equipment Catalog"
        subtitle="What materials and assets are we standardizing so planning stays fast and cost decisions stay consistent?"
      />

      <Card className="order-3 p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Materials Catalog</h2>
            <p className="text-sm text-gray-500">Built from manual catalog entries, estimate line items, job costs, and material expenses.</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Tracked materials</p>
            <p className="text-base font-semibold text-gray-900">{materialRows.length}</p>
          </div>
        </div>

        <form id="material-catalog-form" onSubmit={handleMaterialSubmit} className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_120px_160px_minmax(0,1fr)_auto] mb-4">
          <Input
            label="Material Name"
            required
            value={materialForm.name}
            onChange={(event) => setMaterialForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="3/4 inch crushed gravel"
          />
          <Input
            label="Unit"
            value={materialForm.unit}
            onChange={(event) => setMaterialForm((current) => ({ ...current, unit: event.target.value }))}
            placeholder="yard"
          />
          <Input
            label="Default Unit Cost"
            type="number"
            min="0"
            step="0.01"
            value={materialForm.defaultUnitCost}
            onChange={(event) => setMaterialForm((current) => ({ ...current, defaultUnitCost: Number(event.target.value || 0) }))}
          />
          <TextArea
            label="Notes"
            value={materialForm.notes}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setMaterialForm((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Preferred supplier or spec notes"
          />
          <div className="flex items-end">
            <Button type="submit" className="w-full justify-center">Add Material</Button>
          </div>
        </form>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] mb-4">
          <Input
            label="Search Materials"
            placeholder="Search by material name"
            value={materialQuery}
            onChange={(event) => setMaterialQuery(event.target.value)}
          />
          <Select
            label="Sort"
            value={materialSort}
            onChange={(event) => setMaterialSort(event.target.value as MaterialSort)}
          >
            <option value="highest_value">Highest Value</option>
            <option value="most_referenced">Most Referenced</option>
            <option value="name">Name (A-Z)</option>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3">
            <p className="text-xs text-brand-700">Total Planned + Spent</p>
            <p className="text-lg font-semibold text-brand-900">{formatCurrency(materialSummary.totalValue)}</p>
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3">
            <p className="text-xs text-brand-700">Most Referenced</p>
            <p className="text-base font-semibold text-brand-900">{materialSummary.mostReferenced?.name ?? 'None yet'}</p>
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3">
            <p className="text-xs text-brand-700">Active Material Rows</p>
            <p className="text-lg font-semibold text-brand-900">{materialRows.filter((row) => row.totalPlannedOrSpent > 0).length}</p>
          </div>
        </div>

        {visibleMaterialRows.length === 0 ? (
          materialRows.length === 0 ? (
            <EmptyState
              title="No materials yet"
              description="Build your material catalog for easier estimating and project planning."
              action={<a href="#material-catalog-form"><Button type="button">Add Material</Button></a>}
            />
          ) : (
            <EmptyState
              title="No materials match this filter"
              description="Try a different search term, or clear the current material filter."
              action={<Button type="button" variant="secondary" onClick={() => { setMaterialQuery(''); setMaterialSort('highest_value'); }}>Clear Filters</Button>}
            />
          )
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Showing {visibleMaterialRows.length} material rows</p>
            {visibleMaterialRows.map((row) => (
              <div key={row.key} className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{row.name}</h3>
                    <p className="mt-1 text-sm text-gray-500">{row.referencedJobs} linked jobs</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Planned + Spent</p>
                    <p className="font-semibold text-gray-900">{formatCurrency(row.totalPlannedOrSpent)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge label={`Catalog ${row.catalogMentions}`} className="bg-brand-200 text-brand-800" />
                  <Badge label={`Estimates ${row.estimateMentions}`} className="bg-brand-50 text-brand-700" />
                  <Badge label={`Job Costs ${row.jobCostMentions}`} className="bg-accent-50 text-accent-700" />
                  <Badge label={`Expenses ${row.expenseMentions}`} className="bg-gray-100 text-gray-700" />
                  <Badge label={`Avg ${formatCurrency(row.avgUnitCost)}`} className="bg-brand-100 text-brand-700" />
                  <Badge label={`Unit ${row.unit || 'unit'}`} className="bg-gray-100 text-gray-700" />
                </div>
                {row.notes ? <p className="mt-3 text-sm text-gray-600">{row.notes}</p> : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="order-2">
      <DetailWorkspace
        open={Boolean(workspace.recordId)}
        expanded={workspace.mode === 'expanded'}
        detailKey={workspace.recordId}
        list={(
          <Card className="overflow-hidden">
            <div className="border-b border-brand-100 p-4 dark:border-brand-600 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Equipment Catalog</h2>
                  <p className="text-sm text-gray-500 dark:text-brand-200">{visibleEquipment.length} of {sortedEquipment.length} equipment items</p>
                </div>
                <Button onClick={openAddEquipment}><PlusCircle size={16} />Add Equipment</Button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_minmax(9rem,0.45fr)_minmax(9rem,0.45fr)_minmax(10rem,0.55fr)]">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={equipmentQuery}
                    onChange={(event) => setEquipmentQuery(event.target.value)}
                    placeholder="Search equipment..."
                    aria-label="Search equipment"
                    className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50"
                  />
                </div>
                <select value={equipmentTypeFilter} onChange={(event) => setEquipmentTypeFilter(event.target.value)} aria-label="Filter by equipment type" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50">
                  <option value="all">All Types</option>
                  {equipmentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <select value={equipmentStatusFilter} onChange={(event) => setEquipmentStatusFilter(event.target.value)} aria-label="Filter by ownership status" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50">
                  <option value="all">All Statuses</option>
                  <option value="owned">Owned</option>
                  <option value="financed">Financed</option>
                  <option value="leased">Leased</option>
                </select>
                <select value={equipmentBudgetFilter} onChange={(event) => setEquipmentBudgetFilter(event.target.value)} aria-label="Filter by budget" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50">
                  <option value="all">All Budgets</option>
                  {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
                </select>
              </div>
            </div>

            {sortedEquipment.length === 0 ? (
              <div className="p-5"><EmptyState title="No equipment yet" description="Add company equipment to keep your operational records organized." action={<Button type="button" onClick={openAddEquipment}>Add Equipment</Button>} /></div>
            ) : visibleEquipment.length === 0 ? (
              <div className="p-5"><EmptyState title="No equipment matches these filters" description="Try a different search, type, status, or budget." action={<Button type="button" variant="secondary" onClick={() => { setEquipmentQuery(''); setEquipmentTypeFilter('all'); setEquipmentStatusFilter('all'); setEquipmentBudgetFilter('all'); }}>Clear Filters</Button>} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500 dark:border-brand-600 dark:bg-brand-600 dark:text-brand-200">
                      <th className="px-4 py-3 font-medium">Equipment</th>
                      <th className="px-4 py-3 font-medium">ID / SKU</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 text-right font-medium">Cost / Hour</th>
                      <th className="px-4 py-3 text-right font-medium">Charge-Out Rate</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Allocated To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-brand-600">
                    {visibleEquipment.map((asset) => {
                      const costRate = resolveEquipmentCostRate(asset);
                      const allocatedBudgetIds = Array.from(new Set(equipmentBudgetAllocations.filter((allocation) => allocation.equipmentId === asset.id).map((allocation) => allocation.budgetId)));
                      const allocatedNames = allocatedBudgetIds.map((budgetId) => budgets.find((budget) => budget.id === budgetId)?.name).filter((name): name is string => Boolean(name));
                      const allocationSummary = allocatedNames.length === 0
                        ? 'Not allocated'
                        : allocatedNames.length <= 2
                          ? allocatedNames.join(' + ')
                          : `${allocatedNames.length} budgets`;
                      return (
                        <tr
                          key={asset.id}
                          className={`cursor-pointer transition-colors ${workspace.recordId === asset.id ? 'bg-brand-50 dark:bg-brand-600' : 'hover:bg-gray-50 dark:hover:bg-brand-600/60'}`}
                          onClick={() => selectEquipment(asset.id)}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectEquipment(asset.id); }}
                          tabIndex={0}
                          aria-selected={workspace.recordId === asset.id}
                        >
                          <td className="px-4 py-3 font-semibold text-gray-900 dark:text-brand-50">{asset.name}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-brand-100">{asset.serialNumber || '—'}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-brand-100">{asset.type || '—'}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-brand-50">{costRate !== null ? `${formatCurrency(costRate)}/hr` : 'Not calculated'}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-brand-50">{asset.chargeOutRate && asset.chargeOutRate > 0 ? `${formatCurrency(asset.chargeOutRate)}/hr` : 'Not approved'}</td>
                          <td className="px-4 py-3"><Badge label={asset.costType.charAt(0).toUpperCase() + asset.costType.slice(1)} className="bg-accent-50 text-accent-700" /></td>
                          <td className="max-w-56 truncate px-4 py-3 text-gray-600 dark:text-brand-100" title={allocatedNames.join(', ')}>{allocationSummary}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
        detail={selectedEquipment ? (
          <EquipmentDetailPanel
            equipment={selectedEquipment}
            activeTab={equipmentDetailTab}
            expanded={workspace.mode === 'expanded'}
            budgets={budgets}
            budgetGroups={budgetGroups}
            budgetItems={budgetItems}
            allocations={selectedAllocations}
            pricingRate={selectedPricingRate}
            onTabChange={setEquipmentTab}
            onEdit={() => startEditing(selectedEquipment)}
            onDelete={() => handleDelete(selectedEquipment)}
            onExpand={() => setWorkspaceMode('expanded')}
            onCollapse={() => setWorkspaceMode('panel')}
            onClose={closeEquipment}
          />
        ) : (
          <div className="p-6"><p className="text-sm text-gray-500 dark:text-brand-200">Equipment not found or no longer available.</p><Button className="mt-4" variant="secondary" onClick={closeEquipment}>Close</Button></div>
        )}
      />
      </div>

      <Modal
        open={equipmentModalOpen}
        onClose={() => {
          setEquipmentModalOpen(false);
          resetForm();
        }}
        title={editingId ? `Edit Equipment - ${form.description || 'Equipment'}` : 'Add Equipment'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => { setEquipmentModalOpen(false); resetForm(); }}>Cancel</Button>
            <Button type="submit" form="equipment-modal-form">
              {editingId ? 'Save Changes' : 'Add to Catalog'}
            </Button>
          </>
        )}
      >
        <form id="equipment-modal-form" onSubmit={handleSubmit} className="space-y-4">
          <EquipmentInfoForm
            value={form}
            onChange={setForm}
            totalEquipmentCostPerYear={equipmentCostBreakdown.totalEquipmentCostPerYear}
            totalCostPerHour={equipmentCostBreakdown.totalCostPerHour}
            totalCostPerDay={equipmentCostBreakdown.totalCostPerDay}
            showCalculationDetails={showEquipmentCalcDetails}
            onToggleCalculationDetails={() => setShowEquipmentCalcDetails((value) => !value)}
          />
        </form>
      </Modal>
    </div>
  );
}
