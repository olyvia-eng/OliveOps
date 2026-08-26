import { useMemo, useState } from 'react';
import { BriefcaseBusiness, Package, PlusCircle, Search, Truck, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Modal, PageHeader } from '../../components/ui';
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
import EquipmentInfoForm from '../../components/equipment/EquipmentInfoForm';
import {
  emptyEquipmentInfoFormValue,
  normalizeEquipmentInfoForm,
  type EquipmentInfoFormValue,
  validateEquipmentInfoForm,
} from '../../components/equipment/equipmentFormModel';
import { calculateEquipmentCostBreakdown, resolveEquipmentCostRate } from '../../utils/equipmentPricing';
import EquipmentDetailPanel, { type EquipmentDetailTab } from './EquipmentDetailPanel';
import MaterialsCatalogSection from './MaterialsCatalogSection';
import LabourCatalogSection from './LabourCatalogSection';
import { useCatalogPricing } from './useCatalogPricing';
import SubcontractorCatalogSection from './SubcontractorCatalogSection';

const EQUIPMENT_WORKSPACE_QUERY = { recordParam: 'equipment', tabParam: 'equipmentTab', defaultTab: 'overview' } as const;
const EQUIPMENT_DETAIL_TABS: EquipmentDetailTab[] = ['overview', 'pricing', 'budgets'];
type CatalogTab = 'labour' | 'equipment' | 'materials' | 'subcontractors';

const CATALOG_TABS: Array<{ key: CatalogTab; label: string; icon: typeof Truck }> = [
  { key: 'labour', label: 'Labour', icon: Users },
  { key: 'equipment', label: 'Equipment', icon: Truck },
  { key: 'materials', label: 'Materials', icon: Package },
  { key: 'subcontractors', label: 'Subcontractors', icon: BriefcaseBusiness },
];

export default function EquipmentCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const equipmentAssets = useStore((state) => state.equipmentAssets);
  const budgets = useStore((state) => state.budgets);
  const budgetGroups = useStore((state) => state.budgetGroups);
  const budgetItems = useStore((state) => state.budgetItems);
  const equipmentBudgetAllocations = useStore((state) => state.equipmentBudgetAllocations);
  const budgetRates = useStore((state) => state.budgetRates);
  const addEquipmentAsset = useStore((state) => state.addEquipmentAsset);
  const updateEquipmentAsset = useStore((state) => state.updateEquipmentAsset);
  const deleteEquipmentAsset = useStore((state) => state.deleteEquipmentAsset);
  const catalogPricing = useCatalogPricing();

  const [form, setForm] = useState<EquipmentInfoFormValue>(emptyEquipmentInfoFormValue());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [equipmentFormError, setEquipmentFormError] = useState('');
  const [showEquipmentCalcDetails, setShowEquipmentCalcDetails] = useState(false);
  const [equipmentQuery, setEquipmentQuery] = useState('');
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState('all');
  const [equipmentStatusFilter, setEquipmentStatusFilter] = useState('all');
  const [equipmentBudgetFilter, setEquipmentBudgetFilter] = useState('all');
  const requestedCatalog = searchParams.get('catalog');
  const activeCatalog: CatalogTab = CATALOG_TABS.some((tab) => tab.key === requestedCatalog) ? requestedCatalog as CatalogTab : 'labour';

  const setCatalogTab = (tab: CatalogTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('catalog', tab);
    setSearchParams(next);
  };

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
    setEquipmentFormError('');
  };

  const openAddEquipment = () => {
    resetForm();
    setEquipmentModalOpen(true);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const validationError = validateEquipmentInfoForm(form);
    if (validationError) {
      setEquipmentFormError(validationError);
      return;
    }
    const normalizedForm = normalizeEquipmentInfoForm(form);

    const existingAsset = editingId ? equipmentAssets.find((asset) => asset.id === editingId) : undefined;
    const payload = {
      name: normalizedForm.description,
      type: (normalizedForm.costCode || existingAsset?.type || 'General Equipment'),
      status: existingAsset?.status ?? 'available' as const,
      costType: normalizedForm.equipmentCostType,
      equipmentClassification: normalizedForm.equipmentClassification,
      serialNumber: existingAsset?.serialNumber ?? '',
      purchaseDate: existingAsset?.purchaseDate,
      hourlyCost: equipmentCostBreakdown.totalCostPerHour,
      purchasePrice: existingAsset?.purchasePrice,
      equipmentPayment: normalizedForm.equipmentPayment,
      equipmentPaymentFrequencyPerYear: normalizedForm.equipmentPaymentFrequencyPerYear,
      yearlyFuelCost: normalizedForm.yearlyFuelCost,
      ...(normalizedForm.equipmentClassification === 'overhead' ? { recommendedSellRate: 0, chargeOutRate: 0 } : {}),
      yearlyInsuranceCost: normalizedForm.yearlyInsuranceCost,
      yearlyMaintenanceCost: normalizedForm.yearlyMaintenanceCost,
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
        title="Catalog"
        subtitle="What reusable resources and costs should every plan start from?"
      />

      <div className="overflow-x-auto">
        <div className="inline-flex min-w-max rounded-xl border border-brand-100 bg-white p-1 dark:border-brand-600 dark:bg-brand-700" role="tablist" aria-label="Catalog type">
          {CATALOG_TABS.map((tab) => {
            const Icon = tab.icon;
            return <button key={tab.key} type="button" role="tab" aria-selected={activeCatalog === tab.key} aria-controls={`${tab.key}-catalog-panel`} onClick={() => setCatalogTab(tab.key)} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeCatalog === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-800'}`}><Icon size={16} />{tab.label}</button>;
          })}
        </div>
      </div>

      {activeCatalog === 'materials' ? <div id="materials-catalog-panel" role="tabpanel"><MaterialsCatalogSection pricing={catalogPricing.pricing} pricingLoading={catalogPricing.loading} onSaveCustomRate={catalogPricing.saveCustomRate} /></div> : null}

      {activeCatalog === 'labour' ? <div id="labour-catalog-panel" role="tabpanel"><LabourCatalogSection pricing={catalogPricing.pricing} pricingLoading={catalogPricing.loading} onSaveCustomRate={catalogPricing.saveCustomRate} /></div> : null}

      {activeCatalog === 'subcontractors' ? <div id="subcontractors-catalog-panel" role="tabpanel"><SubcontractorCatalogSection pricing={catalogPricing.pricing} pricingLoading={catalogPricing.loading} onSaveCustomRate={catalogPricing.saveCustomRate} /></div> : null}

      {activeCatalog === 'equipment' ? <div id="equipment-catalog-panel" role="tabpanel">
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
                      <th className="px-4 py-3 text-right font-medium">Calculated Rate</th>
                      <th className="px-4 py-3 text-right font-medium">Custom Rate</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Allocated To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-brand-600">
                    {visibleEquipment.map((asset) => {
                      const costRate = resolveEquipmentCostRate(asset);
                      const pricingRates = budgetRates.filter((rate) => rate.active && rate.category === 'equipment' && (rate.equipmentId ? rate.equipmentId === asset.id : rate.itemName.trim().toLowerCase() === asset.name.trim().toLowerCase()));
                      const recommendedRates = pricingRates.filter((rate) => (rate.recommendedSellPrice ?? 0) > 0);
                      const customRates = pricingRates.filter((rate) => rate.customRate != null);
                      const recommendedSummary = recommendedRates.length > 1 ? `${recommendedRates.length} division rates` : recommendedRates.length === 1 ? `${formatCurrency(recommendedRates[0].recommendedSellPrice ?? 0)}/hr` : 'Not calculated';
                      const customSummary = customRates.length > 1 ? `${customRates.length} division rates` : customRates.length === 1 ? `${formatCurrency(customRates[0].customRate ?? 0)}/hr` : 'No custom rate';
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
                          <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-brand-50">{recommendedSummary}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-brand-50">{customSummary}</td>
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
            catalogPricing={catalogPricing.pricing}
            catalogPricingLoading={catalogPricing.loading}
            onSaveCustomRate={catalogPricing.saveCustomRate}
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
      </div> : null}

      <Modal
        open={equipmentModalOpen}
        size="large"
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
            context="catalog"
            totalEquipmentCostPerYear={equipmentCostBreakdown.totalEquipmentCostPerYear}
            totalCostPerHour={equipmentCostBreakdown.totalCostPerHour}
            totalCostPerDay={equipmentCostBreakdown.totalCostPerDay}
            showCalculationDetails={showEquipmentCalcDetails}
            onToggleCalculationDetails={() => setShowEquipmentCalcDetails((value) => !value)}
          />
          {equipmentFormError ? <p className="text-sm text-accent-700">{equipmentFormError}</p> : null}
        </form>
      </Modal>
    </div>
  );
}
