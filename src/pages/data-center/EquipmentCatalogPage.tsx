import { useMemo, useState } from 'react';
import { PencilLine, PlusCircle, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import type { EquipmentAsset } from '../../types';
import EquipmentAssetForm, {
  emptyEquipmentAssetFormValue,
  toEquipmentAssetPayload,
  type EquipmentAssetFormValue,
} from '../../components/equipment/EquipmentAssetForm';

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
  const materialCatalogItems = useStore((state) => state.materialCatalogItems);
  const estimates = useStore((state) => state.estimates);
  const expenses = useStore((state) => state.expenses);
  const jobs = useStore((state) => state.jobs);
  const addEquipmentAsset = useStore((state) => state.addEquipmentAsset);
  const addMaterialCatalogItem = useStore((state) => state.addMaterialCatalogItem);
  const updateEquipmentAsset = useStore((state) => state.updateEquipmentAsset);
  const deleteEquipmentAsset = useStore((state) => state.deleteEquipmentAsset);

  const [form, setForm] = useState<EquipmentAssetFormValue>(emptyEquipmentAssetFormValue());
  const [materialForm, setMaterialForm] = useState<MaterialFormState>(emptyMaterialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const resetForm = () => {
    setForm(emptyEquipmentAssetFormValue());
    setEditingId(null);
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

    if (!form.name.trim() || !form.type.trim()) {
      return;
    }

    const payload = toEquipmentAssetPayload(form);

    if (editingId) {
      updateEquipmentAsset(editingId, payload);
    } else {
      addEquipmentAsset(payload);
    }

    resetForm();
  };

  const startEditing = (asset: EquipmentAsset) => {
    setEditingId(asset.id);
    setForm({
      name: asset.name,
      type: asset.type,
      status: asset.status,
      costType: asset.costType,
      serialNumber: asset.serialNumber,
      purchaseDate: asset.purchaseDate ?? '',
      hourlyCost: asset.hourlyCost,
      purchasePrice: asset.purchasePrice ?? 0,
      equipmentPayment: asset.equipmentPayment ?? 0,
      equipmentPaymentFrequencyPerYear: asset.equipmentPaymentFrequencyPerYear ?? 12,
      fuelPriceUnit: asset.fuelPriceUnit ?? 'L',
      averageFuelPrice: asset.averageFuelPrice ?? 0,
      averageFuelBurnPerHour: asset.averageFuelBurnPerHour ?? 0,
      yearlyInsuranceCost: asset.yearlyInsuranceCost ?? 0,
      yearlyMaintenanceCost: asset.yearlyMaintenanceCost ?? 0,
      notes: asset.notes,
    });
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

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit Equipment Asset' : 'Add Equipment Asset'}</h2>
              <p className="text-sm text-gray-500">Keep the catalog current so crews can choose the right asset quickly.</p>
            </div>
          </div>

          <form id="equipment-catalog-form" onSubmit={handleSubmit} className="space-y-4">
            <EquipmentAssetForm value={form} onChange={setForm} />

            <div className="flex gap-2">
              <Button type="submit" className="flex-1 justify-center">
                {editingId ? 'Save Changes' : 'Add to Catalog'}
              </Button>
              {editingId && (
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Equipment Catalog</h2>
              <p className="text-sm text-gray-500">{sortedEquipment.length} equipment items tracked</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
              <PlusCircle size={16} />
              Shared list
            </div>
          </div>

          {sortedEquipment.length === 0 ? (
            <EmptyState
              title="No equipment yet"
              description="Add company equipment to keep your operational records organized."
              action={<a href="#equipment-catalog-form"><Button type="button">Add Equipment</Button></a>}
            />
          ) : (
            <div className="space-y-3">
              {sortedEquipment.map((asset) => (
                <div key={asset.id} className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{asset.name}</h3>
                        <Badge label={asset.status} className="bg-brand-50 text-brand-700" />
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

                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
                    <span>Serial: {asset.serialNumber || '—'}</span>
                    <span>Hourly: ${asset.hourlyCost.toFixed(2)}</span>
                    <span>Updated: {new Date(asset.updatedAt).toLocaleDateString()}</span>
                  </div>

                  {asset.notes && <p className="mt-3 text-sm text-gray-600">{asset.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
