import { useMemo, useState } from 'react';
import { PencilLine, PlusCircle, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import type { EquipmentAsset } from '../../types';
import EquipmentInfoForm, {
  emptyEquipmentInfoFormValue,
  type EquipmentInfoFormValue,
} from '../../components/equipment/EquipmentInfoForm';
import { calculateEquipmentCostBreakdown } from '../../utils/equipmentPricing';

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
  const equipmentAssets = useStore((state) => state.equipmentAssets);
  const budgets = useStore((state) => state.budgets);
  const budgetGroups = useStore((state) => state.budgetGroups);
  const budgetItems = useStore((state) => state.budgetItems);
  const equipmentBudgetAllocations = useStore((state) => state.equipmentBudgetAllocations);
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
  const [materialQuery, setMaterialQuery] = useState('');
  const [materialSort, setMaterialSort] = useState<MaterialSort>('highest_value');

  const sortedEquipment = useMemo(() => {
    return [...equipmentAssets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [equipmentAssets]);

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
      averageFuelPrice: form.averageFuelPrice,
      averageFuelBurnPerHour: form.averageFuelBurnPerHour,
      yearlyInsuranceCost: form.yearlyInsuranceCost,
      yearlyMaintenanceCost: form.yearlyMaintenanceCost,
      sellableHoursPerYear: form.sellableHoursPerYear,
      equipmentHoursPerDay: form.equipmentHoursPerDay,
      monthsUsedPerYear: form.monthsUsedPerYear,
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
    const normalizedFuelPrice = Math.max(0, Number(form.averageFuelPrice || 0));
    const normalizedFuelBurnPerHour = Math.max(0, Number(form.averageFuelBurnPerHour || 0));
    const normalizedFuelCostPerHour = normalizedFuelPrice * normalizedFuelBurnPerHour;
    const normalizedPayment = form.equipmentCostType === 'owned' ? 0 : Math.max(0, Number(form.equipmentPayment || 0));
    const normalizedFrequency = form.equipmentCostType === 'owned' ? 0 : Math.max(0, Number(form.equipmentPaymentFrequencyPerYear || 0));
    const payload = {
      name: form.description.trim(),
      type: (form.costCode.trim() || existingAsset?.type || 'General Equipment'),
      status: existingAsset?.status ?? 'available' as const,
      costType: form.equipmentCostType,
      serialNumber: existingAsset?.serialNumber ?? '',
      purchaseDate: existingAsset?.purchaseDate,
      hourlyCost: normalizedFuelCostPerHour,
      purchasePrice: existingAsset?.purchasePrice,
      equipmentPayment: normalizedPayment,
      equipmentPaymentFrequencyPerYear: normalizedFrequency,
      fuelPriceUnit: form.fuelPriceUnit,
      averageFuelPrice: normalizedFuelPrice,
      averageFuelBurnPerHour: normalizedFuelBurnPerHour,
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
      equipmentPayment: asset.equipmentPayment ?? 0,
      equipmentPaymentFrequencyPerYear: asset.equipmentPaymentFrequencyPerYear ?? 12,
      fuelPriceUnit: asset.fuelPriceUnit ?? 'L',
      averageFuelPrice: asset.averageFuelPrice ?? asset.hourlyCost,
      averageFuelBurnPerHour: asset.averageFuelBurnPerHour ?? 1,
      yearlyInsuranceCost: asset.yearlyInsuranceCost ?? 0,
      yearlyMaintenanceCost: asset.yearlyMaintenanceCost ?? 0,
      sellableHoursPerYear: 0,
      equipmentHoursPerDay: 8,
      monthsUsedPerYear: 12,
    });
    setShowEquipmentCalcDetails(false);
    setEquipmentModalOpen(true);
  };

  const handleDelete = (asset: EquipmentAsset) => {
    const confirmed = window.confirm(`Remove ${asset.name} from the equipment catalog?`);
    if (!confirmed) return;
    deleteEquipmentAsset(asset.id);
    if (editingId === asset.id) {
      resetForm();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Materials & Equipment Catalog"
        subtitle="What materials and assets are we standardizing so planning stays fast and cost decisions stay consistent?"
      />

      <Card className="p-5">
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

      <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Equipment Catalog</h2>
              <p className="text-sm text-gray-500">{sortedEquipment.length} equipment items tracked</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={openAddEquipment}><PlusCircle size={16} /> Add Equipment</Button>
            </div>
          </div>

          {sortedEquipment.length === 0 ? (
            <EmptyState
              title="No equipment yet"
              description="Add company equipment to keep your operational records organized."
              action={<Button type="button" onClick={openAddEquipment}>Add Equipment</Button>}
            />
          ) : (
            <div className="space-y-3">
              {sortedEquipment.map((asset) => (
                <div key={asset.id} className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{asset.name}</h3>
                        <Badge label={asset.costType} className="bg-accent-50 text-accent-700" />
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{asset.type}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => startEditing(asset)}>
                        <PencilLine size={14} />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleDelete(asset)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Cost Rate</p>
                      <p className="mt-1 font-semibold text-gray-900">{formatCurrency(asset.costRateHourly ?? asset.hourlyCost)} / hr</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Recommended Rate</p>
                      <p className="mt-1 font-semibold text-gray-900">{asset.recommendedSellRate && asset.recommendedSellRate > 0 ? `${formatCurrency(asset.recommendedSellRate)} / hr` : 'Not calculated'}</p>
                    </div>
                    <div className="rounded-lg bg-brand-50 p-3">
                      <p className="text-xs text-brand-700">Approved Charge-Out Rate</p>
                      <p className="mt-1 font-semibold text-brand-900">{asset.chargeOutRate && asset.chargeOutRate > 0 ? `${formatCurrency(asset.chargeOutRate)} / hr` : 'Not approved'}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Updated {new Date(asset.updatedAt).toLocaleDateString()}</p>

                  {budgetGroups.map((group) => {
                    const allocations = equipmentBudgetAllocations.filter((allocation) => allocation.equipmentId === asset.id && allocation.budgetGroupId === group.id);
                    if (allocations.length === 0) return null;
                    const totalMonths = allocations.reduce((sum, allocation) => sum + allocation.monthsAllocated, 0);
                    const totalCost = allocations.reduce((sum, allocation) => sum + (budgetItems.find((item) => item.id === allocation.budgetItemId)?.budgeted ?? 0), 0);
                    return (
                      <div key={group.id} className="mt-4 border-t border-gray-200 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                          <p className="text-xs text-gray-500">{totalMonths.toFixed(2).replace(/\.00$/, '')} of 12 months · {formatCurrency(totalCost)}</p>
                        </div>
                        <div className="mt-2 divide-y divide-gray-100">
                          {allocations.map((allocation) => {
                            const budget = budgets.find((value) => value.id === allocation.budgetId);
                            const budgetItem = budgetItems.find((item) => item.id === allocation.budgetItemId);
                            return (
                              <div key={allocation.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="text-gray-700">{budget?.name ?? 'Unavailable budget'}</span>
                                <span className="shrink-0 text-gray-500">{allocation.monthsAllocated} mo · {formatCurrency(budgetItem?.budgeted ?? 0)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {asset.notes && <p className="mt-3 text-sm text-gray-600">{asset.notes}</p>}
                </div>
              ))}
            </div>
          )}
      </Card>

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
            fuelCostPerHour={equipmentCostBreakdown.fuelCostPerHour}
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
