import { useMemo, useRef, useState } from 'react';
import { PlusCircle, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import { closeDetailWorkspace, openDetailWorkspace, readDetailWorkspaceQuery, setDetailWorkspaceMode, setDetailWorkspaceTab } from '../../components/detail-workspace/detailWorkspaceQuery';
import { Button, Card, EmptyState, Input, Modal, TextArea } from '../../components/ui';
import { useStore } from '../../store';
import type { MaterialCatalogItem } from '../../types';
import { formatCurrency } from '../../utils';
import { emitAppToast } from '../../toast';
import MaterialDetailPanel, { type MaterialAllocationView, type MaterialDetailTab } from './MaterialDetailPanel';

const MATERIAL_WORKSPACE_QUERY = { recordParam: 'material', tabParam: 'materialTab', defaultTab: 'overview' } as const;
const MATERIAL_DETAIL_TABS: MaterialDetailTab[] = ['overview', 'budgets'];

type MaterialForm = Pick<MaterialCatalogItem, 'name' | 'unit' | 'defaultUnitCost' | 'notes'>;

const emptyForm = (): MaterialForm => ({ name: '', unit: 'unit', defaultUnitCost: 0, notes: '' });

export default function MaterialsCatalogSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const materialCatalogItems = useStore((state) => state.materialCatalogItems);
  const budgetDivisionPlanningItems = useStore((state) => state.budgetDivisionPlanningItems);
  const budgets = useStore((state) => state.budgets);
  const budgetDivisions = useStore((state) => state.budgetDivisions);
  const addMaterialCatalogItem = useStore((state) => state.addMaterialCatalogItem);
  const updateMaterialCatalogItem = useStore((state) => state.updateMaterialCatalogItem);
  const deleteMaterialCatalogItem = useStore((state) => state.deleteMaterialCatalogItem);

  const [query, setQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MaterialForm>(emptyForm);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [saveError, setSaveError] = useState('');
  const saveInFlight = useRef(false);

  const workspace = readDetailWorkspaceQuery(searchParams, MATERIAL_WORKSPACE_QUERY);
  const selectedMaterial = materialCatalogItems.find((material) => material.id === workspace.recordId) ?? null;
  const activeTab = MATERIAL_DETAIL_TABS.includes(workspace.tab as MaterialDetailTab) ? workspace.tab as MaterialDetailTab : 'overview';

  const allocationsByMaterial = useMemo(() => {
    const result = new Map<string, MaterialAllocationView[]>();
    for (const item of budgetDivisionPlanningItems) {
      if (item.category !== 'materials' || !item.materialCatalogItemId) continue;
      const budget = budgets.find((value) => value.id === item.budgetId);
      const division = budgetDivisions.find((value) => value.id === item.divisionId && value.budgetId === item.budgetId);
      const allocations = result.get(item.materialCatalogItemId) ?? [];
      allocations.push({
        id: item.id,
        budgetId: item.budgetId,
        divisionId: item.divisionId,
        budgetName: budget?.name ?? 'Unavailable Budget',
        divisionName: division?.name ?? 'Unavailable Division',
        plannedQuantity: Math.max(0, item.plannedQuantity ?? 0),
        unit: item.unit || 'unit',
        unitCost: Math.max(0, item.unitCost ?? 0),
      });
      result.set(item.materialCatalogItemId, allocations);
    }
    return result;
  }, [budgetDivisionPlanningItems, budgetDivisions, budgets]);

  const units = useMemo(() => Array.from(new Set(materialCatalogItems.map((item) => item.unit).filter(Boolean))).sort(), [materialCatalogItems]);
  const visibleMaterials = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...materialCatalogItems]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || left.name.localeCompare(right.name))
      .filter((material) => {
        const matchesQuery = !normalizedQuery || [material.name, material.unit, material.notes].some((value) => value.toLowerCase().includes(normalizedQuery));
        const matchesUnit = unitFilter === 'all' || material.unit === unitFilter;
        return matchesQuery && matchesUnit;
      });
  }, [materialCatalogItems, query, unitFilter]);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setSaveStatus('idle');
    setSaveError('');
    setModalOpen(true);
  };

  const openEdit = (material: MaterialCatalogItem) => {
    setEditingId(material.id);
    setForm({ name: material.name, unit: material.unit, defaultUnitCost: material.defaultUnitCost, notes: material.notes });
    setSaveStatus('idle');
    setSaveError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saveInFlight.current) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setSaveStatus('idle');
    setSaveError('');
  };

  const saveMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    const name = form.name.trim();
    const unit = form.unit.trim();
    const defaultUnitCost = Number(form.defaultUnitCost);
    if (!name || !unit || !Number.isFinite(defaultUnitCost) || defaultUnitCost < 0) {
      setSaveError('Enter a material name, unit, and a default unit cost of zero or greater.');
      setSaveStatus('failed');
      return;
    }
    saveInFlight.current = true;
    setSaveStatus('saving');
    setSaveError('');
    try {
      const payload = { name, unit, defaultUnitCost, notes: form.notes.trim() };
      if (editingId) await updateMaterialCatalogItem(editingId, payload);
      else await addMaterialCatalogItem(payload);
      emitAppToast({ tone: 'success', message: editingId ? 'Material changes saved.' : 'Material added to catalog.' });
      saveInFlight.current = false;
      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm());
      setSaveStatus('idle');
    } catch {
      setSaveStatus('failed');
      setSaveError('Material could not be saved. Check your connection and try again.');
    } finally {
      saveInFlight.current = false;
    }
  };

  const selectMaterial = (materialId: string) => setSearchParams(openDetailWorkspace(searchParams, MATERIAL_WORKSPACE_QUERY, materialId));
  const closeMaterial = () => setSearchParams(closeDetailWorkspace(searchParams, MATERIAL_WORKSPACE_QUERY));
  const setWorkspaceMode = (mode: 'panel' | 'expanded') => setSearchParams(setDetailWorkspaceMode(searchParams, MATERIAL_WORKSPACE_QUERY, mode));
  const setMaterialTab = (tab: MaterialDetailTab) => setSearchParams(setDetailWorkspaceTab(searchParams, MATERIAL_WORKSPACE_QUERY, tab));
  const deleteMaterial = (material: MaterialCatalogItem) => {
    if (!window.confirm(`Remove ${material.name} from the materials catalog?`)) return;
    deleteMaterialCatalogItem(material.id);
    closeMaterial();
  };

  const clearFilters = () => { setQuery(''); setUnitFilter('all'); };
  const selectedAllocations = selectedMaterial ? allocationsByMaterial.get(selectedMaterial.id) ?? [] : [];

  return <div className="order-3">
    <DetailWorkspace
      open={Boolean(workspace.recordId)}
      expanded={workspace.mode === 'expanded'}
      detailKey={workspace.recordId}
      list={<Card className="overflow-hidden">
        <div className="border-b border-brand-100 p-4 dark:border-brand-600 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Materials Catalog</h2><p className="text-sm text-gray-500 dark:text-brand-200">{materialCatalogItems.length} material item{materialCatalogItems.length === 1 ? '' : 's'}</p></div>
            <Button onClick={openAdd}><PlusCircle size={16} />Add Material</Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_minmax(9rem,0.45fr)]">
            <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search materials..." aria-label="Search materials" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50" /></div>
            <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} aria-label="Filter by material unit" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50"><option value="all">All Units</option>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
          </div>
        </div>

        {materialCatalogItems.length === 0 ? <div className="p-5"><EmptyState title="No materials yet" description="Add commonly used materials so budgeting and estimating stay consistent." action={<Button type="button" onClick={openAdd}><PlusCircle size={16} />Add Material</Button>} /></div> : visibleMaterials.length === 0 ? <div className="p-5"><EmptyState title="No materials match these filters" description="Try a different search, unit, or allocation." action={<Button type="button" variant="secondary" onClick={clearFilters}>Clear Filters</Button>} /></div> : <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500 dark:border-brand-600 dark:bg-brand-600 dark:text-brand-200"><th className="px-4 py-3 font-medium">Material</th><th className="px-4 py-3 font-medium">Unit</th><th className="px-4 py-3 text-right font-medium">Cost / Unit</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-brand-600">{visibleMaterials.map((material) => <tr key={material.id} className={`cursor-pointer transition-colors ${workspace.recordId === material.id ? 'bg-brand-50 dark:bg-brand-600' : 'hover:bg-gray-50 dark:hover:bg-brand-600/60'}`} onClick={() => selectMaterial(material.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectMaterial(material.id); }} tabIndex={0} aria-selected={workspace.recordId === material.id}><td className="px-4 py-3 font-semibold text-gray-900 dark:text-brand-50">{material.name}</td><td className="px-4 py-3 text-gray-600 dark:text-brand-100">{material.unit}</td><td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-brand-50">{formatCurrency(material.defaultUnitCost)}/{material.unit}</td></tr>)}</tbody>
          </table>
        </div>}
      </Card>}
      detail={selectedMaterial ? <MaterialDetailPanel material={selectedMaterial} allocations={selectedAllocations} activeTab={activeTab} expanded={workspace.mode === 'expanded'} onTabChange={setMaterialTab} onEdit={() => openEdit(selectedMaterial)} onDelete={() => deleteMaterial(selectedMaterial)} onExpand={() => setWorkspaceMode('expanded')} onCollapse={() => setWorkspaceMode('panel')} onClose={closeMaterial} /> : <div className="p-6"><p className="text-sm text-gray-500 dark:text-brand-200">Material not found or no longer available.</p><Button className="mt-4" variant="secondary" onClick={closeMaterial}>Close</Button></div>}
    />

    <Modal open={modalOpen} onClose={closeModal} title={editingId ? `Edit Material - ${form.name || 'Material'}` : 'Add Material'} footer={<><Button variant="secondary" onClick={closeModal} disabled={saveStatus === 'saving'}>Cancel</Button><Button type="submit" form="material-modal-form" disabled={saveStatus === 'saving'}>{saveStatus === 'saving' ? 'Saving...' : editingId ? 'Save Changes' : 'Add to Catalog'}</Button></>}>
      <form id="material-modal-form" onSubmit={(event) => void saveMaterial(event)} className="space-y-4">
        <Input label="Material Name" required value={form.name} disabled={saveStatus === 'saving'} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setSaveStatus('idle'); setSaveError(''); }} />
        <Input label="Unit" required value={form.unit} disabled={saveStatus === 'saving'} onChange={(event) => { setForm((current) => ({ ...current, unit: event.target.value })); setSaveStatus('idle'); setSaveError(''); }} placeholder="tonne" />
        <Input label="Default Unit Cost" required type="number" min={0} step={0.01} value={form.defaultUnitCost} disabled={saveStatus === 'saving'} onChange={(event) => { setForm((current) => ({ ...current, defaultUnitCost: Number(event.target.value || 0) })); setSaveStatus('idle'); setSaveError(''); }} />
        <TextArea label="Notes" value={form.notes} disabled={saveStatus === 'saving'} onChange={(event) => { setForm((current) => ({ ...current, notes: event.target.value })); setSaveStatus('idle'); setSaveError(''); }} />
        {saveError ? <p className="text-sm text-accent-700" role="alert">{saveError}</p> : null}
      </form>
    </Modal>
  </div>;
}
