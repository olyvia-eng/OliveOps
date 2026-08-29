import { useMemo, useState } from 'react';
import { BriefcaseBusiness, Package, PlusCircle, Search, Truck, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, Modal, PageHeader } from '../../components/ui';
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
import SubcontractorsCatalogSection from './SubcontractorsCatalogSection';

const EQUIPMENT_WORKSPACE_QUERY = { recordParam: 'equipment', tabParam: 'equipmentTab', defaultTab: 'overview' } as const;
const EQUIPMENT_DETAIL_TABS: EquipmentDetailTab[] = ['overview', 'budgets'];
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
  const addEquipmentAsset = useStore((state) => state.addEquipmentAsset);
  const updateEquipmentAsset = useStore((state) => state.updateEquipmentAsset);
  const deleteEquipmentAsset = useStore((state) => state.deleteEquipmentAsset);

  const [form, setForm] = useState<EquipmentInfoFormValue>(emptyEquipmentInfoFormValue());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [equipmentFormError, setEquipmentFormError] = useState('');
  const [showEquipmentCalcDetails, setShowEquipmentCalcDetails] = useState(false);
  const [equipmentQuery, setEquipmentQuery] = useState('');
  const requestedCatalog = searchParams.get('catalog');
  const activeCatalog: CatalogTab = CATALOG_TABS.some((tab) => tab.key === requestedCatalog) ? requestedCatalog as CatalogTab : 'labour';

  const setCatalogTab = (tab: CatalogTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('catalog', tab);
    setSearchParams(next);
  };

  const sortedEquipment = useMemo(() => {
    return equipmentAssets.filter((asset) => asset.equipmentClassification !== 'overhead').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [equipmentAssets]);

  const workspace = readDetailWorkspaceQuery(searchParams, EQUIPMENT_WORKSPACE_QUERY);
  const selectedEquipment = sortedEquipment.find((asset) => asset.id === workspace.recordId) ?? null;
  const equipmentDetailTab = EQUIPMENT_DETAIL_TABS.includes(workspace.tab as EquipmentDetailTab)
    ? workspace.tab as EquipmentDetailTab
    : 'overview';
  const selectedAllocations = selectedEquipment
    ? equipmentBudgetAllocations.filter((allocation) => allocation.equipmentId === selectedEquipment.id)
    : [];
  const visibleEquipment = useMemo(() => {
    const query = equipmentQuery.trim().toLowerCase();
    return sortedEquipment.filter((asset) => !query || [asset.name, asset.serialNumber, asset.type].some((value) => value?.toLowerCase().includes(query)));
  }, [equipmentQuery, sortedEquipment]);

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
      rentalCost: normalizedForm.equipmentCostType === 'rental' ? normalizedForm.rentalCost : undefined,
      rentalUnit: normalizedForm.equipmentCostType === 'rental' ? normalizedForm.rentalUnit : undefined,
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
      rentalCost: asset.rentalCost ?? 0,
      rentalUnit: asset.rentalUnit ?? 'day',
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

      {activeCatalog === 'materials' ? <div id="materials-catalog-panel" role="tabpanel"><MaterialsCatalogSection /></div> : null}

      {activeCatalog === 'labour' ? <div id="labour-catalog-panel" role="tabpanel"><LabourCatalogSection /></div> : null}

      {activeCatalog === 'subcontractors' ? <div id="subcontractors-catalog-panel" role="tabpanel"><SubcontractorsCatalogSection /></div> : null}

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

              <div className="mt-4 max-w-xl">
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
              </div>
            </div>

            {sortedEquipment.length === 0 ? (
              <div className="p-5"><EmptyState title="No equipment yet" description="Add company equipment to keep your operational records organized." action={<Button type="button" onClick={openAddEquipment}>Add Equipment</Button>} /></div>
            ) : visibleEquipment.length === 0 ? (
              <div className="p-5"><EmptyState title="No equipment matches this search" description="Try a different equipment name, ID, or type." action={<Button type="button" variant="secondary" onClick={() => setEquipmentQuery('')}>Clear Search</Button>} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500 dark:border-brand-600 dark:bg-brand-600 dark:text-brand-200">
                      <th className="px-4 py-3 font-medium">Equipment</th>
                      <th className="px-4 py-3 font-medium">ID / SKU</th>
                      <th className="px-4 py-3 text-right font-medium">Direct Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-brand-600">
                    {visibleEquipment.map((asset) => {
                      const costRate = asset.costType === 'rental' ? asset.rentalCost ?? 0 : resolveEquipmentCostRate(asset);
                      const costUnit = asset.costType === 'rental' ? asset.rentalUnit ?? 'hr' : 'hr';
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
                          <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-brand-50">{costRate !== null ? `${formatCurrency(costRate)}/${costUnit}` : 'Not calculated'}</td>
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
