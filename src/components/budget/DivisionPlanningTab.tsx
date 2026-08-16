import { useState } from 'react';
import { ArrowDown, ArrowUp, Download, GripVertical, HardHat, Package, Pencil, Plus, Trash2, Truck, Users } from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal, Select, TextArea } from '../ui';
import type { Budget, BudgetDivision, BudgetDivisionPlanCategory, BudgetDivisionPlanningItem } from '../../types';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import BudgetPlanImportDialog from './BudgetPlanImportDialog';

const config = {
  labour: { label: 'Labour', singular: 'Labour', icon: Users, title: 'No labour planned yet', description: 'Add employees and labour assumptions manually, or import your team and planning assumptions from a previous Budget.' },
  equipment: { label: 'Equipment', singular: 'Equipment', icon: Truck, title: 'No equipment planned yet', description: 'Add equipment from the Equipment Catalog, or bring forward equipment and cost assumptions from a previous Budget.' },
  materials: { label: 'Materials', singular: 'Material', icon: Package, title: 'No materials planned yet', description: 'Add materials manually or import commonly used materials from a previous Budget.' },
  subcontractors: { label: 'Subcontractors', singular: 'Subcontractor', icon: HardHat, title: 'No subcontractors planned yet', description: 'Add subcontractors manually or bring forward subcontractor planning items from a previous Budget.' },
} as const;

interface Props { budget: Budget; division: BudgetDivision; category: BudgetDivisionPlanCategory; canEdit: boolean }

const numberValue = (value: string) => Number(value) || 0;

export default function DivisionPlanningTab({ budget, division, category, canEdit }: Props) {
  const settings = config[category];
  const Icon = settings.icon;
  const { budgetDivisionPlanningItems, employees, equipmentAssets, materialCatalogItems, addBudgetDivisionPlanningItem, updateBudgetDivisionPlanningItem, deleteBudgetDivisionPlanningItem, reorderBudgetDivisionPlanningItems } = useStore();
  const items = budgetDivisionPlanningItems.filter((item) => item.budgetId === budget.id && item.divisionId === division.id && item.category === category).sort((left, right) => left.sortOrder - right.sortOrder);
  const [editing, setEditing] = useState<BudgetDivisionPlanningItem | null | 'new'>(null);
  const [draft, setDraft] = useState<Partial<BudgetDivisionPlanningItem>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const openNew = () => { setDraft(category === 'labour' ? { compType: 'hourly', overtimeMultiplier: 1.5 } : category === 'equipment' ? { classification: 'billable', costType: 'owned', allocationMonths: 12 } : { unit: 'each', plannedQuantity: 1 }); setEditing('new'); };
  const openEdit = (item: BudgetDivisionPlanningItem) => { setDraft(item); setEditing(item); };
  const setNumber = (field: keyof BudgetDivisionPlanningItem, value: string) => setDraft((current) => ({ ...current, [field]: numberValue(value) }));

  const save = async () => {
    setSaving(true);
    const result = editing === 'new'
      ? await addBudgetDivisionPlanningItem({ ...draft, budgetId: budget.id, divisionId: division.id, category } as Omit<BudgetDivisionPlanningItem, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt'>)
      : editing ? await updateBudgetDivisionPlanningItem(editing, draft) : null;
    setSaving(false);
    if (result) setEditing(null);
  };

  const reorder = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const next = items.slice();
    const sourceIndex = next.findIndex((item) => item.id === sourceId);
    const targetIndex = next.findIndex((item) => item.id === targetId);
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    void reorderBudgetDivisionPlanningItems(budget.id, division.id, category, next.map((item) => item.id));
  };
  const move = (item: BudgetDivisionPlanningItem, offset: number) => {
    const index = items.findIndex((value) => value.id === item.id);
    const target = items[index + offset];
    if (target) reorder(item.id, target.id);
  };
  const plannedAmount = (item: BudgetDivisionPlanningItem) => {
    if (item.plannedAmount !== undefined) return item.plannedAmount;
    if (item.category === 'labour') {
      const compensation = item.compType === 'salaried' ? item.annualSalary ?? 0 : (item.hourlyRate ?? 0) * (item.plannedHours ?? 0);
      return compensation * (1 + ((item.payrollBurdenPct ?? item.labourBurdenPct ?? 0) / 100)) + (item.benefitsExtraCost ?? 0) + (item.bonus ?? 0);
    }
    if (item.category === 'equipment') return (item.equipmentPayment ?? 0) + (item.yearlyFuelCost ?? 0) + (item.yearlyInsuranceCost ?? 0) + (item.yearlyMaintenanceCost ?? 0);
    return (item.unitCost ?? item.rate ?? 0) * (item.plannedQuantity ?? 1);
  };
  const total = items.reduce((sum, item) => sum + plannedAmount(item), 0);

  const actions = canEdit ? <div className="flex flex-wrap justify-center gap-2"><Button onClick={openNew}><Plus /> Add {settings.singular}</Button><Button variant="secondary" onClick={() => setImportOpen(true)}><Download /> Import from Previous Budget</Button></div> : undefined;

  return <div className="space-y-4">
    {items.length === 0 ? <Card><EmptyState icon={<Icon />} title={settings.title} description={settings.description} action={actions} /></Card> : <>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">{settings.label} Plan</h2><p className="mt-1 text-sm text-brand-400">{items.length} item{items.length === 1 ? '' : 's'} · {formatCurrency(total)} planned</p></div>{actions}</div>
      <Card className="overflow-hidden rounded-lg"><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b border-brand-100 bg-brand-50 text-left text-xs uppercase text-brand-400 dark:border-brand-600 dark:bg-brand-800"><tr><th className="w-24 px-3 py-3">Order</th><th className="px-3 py-3">{settings.singular}</th><th className="px-3 py-3">Planning assumptions</th><th className="px-3 py-3 text-right">Planned</th>{canEdit ? <th className="w-24 px-3 py-3 text-right">Actions</th> : null}</tr></thead><tbody className="divide-y divide-brand-100 dark:divide-brand-600">{items.map((item, index) => <tr key={item.id} draggable={canEdit} onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedId) reorder(draggedId, item.id); setDraggedId(null); }} className="text-brand-800 dark:text-brand-100"><td className="px-3 py-3"><div className="flex items-center gap-1 text-brand-400"><GripVertical size={16} /><button type="button" aria-label={`Move ${item.name ?? item.description} earlier`} disabled={!canEdit || index === 0} onClick={() => move(item, -1)}><ArrowUp size={15} /></button><button type="button" aria-label={`Move ${item.name ?? item.description} later`} disabled={!canEdit || index === items.length - 1} onClick={() => move(item, 1)}><ArrowDown size={15} /></button></div></td><td className="px-3 py-3"><p className="font-semibold">{item.name || item.description}</p>{item.description && item.name !== item.description ? <p className="text-xs text-brand-400">{item.description}</p> : null}</td><td className="px-3 py-3 text-brand-500 dark:text-brand-300">{category === 'labour' ? `${item.role ?? item.compType ?? 'Labour'} · ${item.plannedHours ?? 0} hrs · ${item.payrollBurdenPct ?? 0}% burden` : category === 'equipment' ? `${item.classification ?? 'billable'} · ${item.allocationMonths ?? 12} months · ${formatCurrency(item.yearlyFuelCost ?? 0)} fuel` : `${item.plannedQuantity ?? 1} ${item.unit ?? 'each'} × ${formatCurrency(item.unitCost ?? item.rate ?? 0)}`}</td><td className="px-3 py-3 text-right font-semibold">{formatCurrency(plannedAmount(item))}</td>{canEdit ? <td className="px-3 py-3"><div className="flex justify-end gap-1"><button type="button" title="Edit" onClick={() => openEdit(item)} className="grid h-8 w-8 place-items-center rounded-md text-brand-500 hover:bg-brand-50"><Pencil size={15} /></button><button type="button" title="Remove" onClick={() => void deleteBudgetDivisionPlanningItem(item)} className="grid h-8 w-8 place-items-center rounded-md text-accent-700 hover:bg-accent-50"><Trash2 size={15} /></button></div></td> : null}</tr>)}</tbody></table></div></Card>
    </>}

    <Modal open={editing !== null} onClose={() => { if (!saving) setEditing(null); }} title={`${editing === 'new' ? 'Add' : 'Edit'} ${settings.singular}`} size="wide" footer={<><Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || (!draft.name && !draft.description)}>{saving ? 'Saving...' : `Save ${settings.singular}`}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {category === 'labour' ? <>
          <Select label="Employee Catalog" value={draft.employeeId ?? ''} onChange={(event) => { const employee = employees.find((item) => item.id === event.target.value); setDraft((current) => ({ ...current, employeeId: event.target.value || undefined, name: employee?.name ?? current.name, role: employee?.role ?? current.role, hourlyRate: employee?.hourlyRate ?? current.hourlyRate })); }}><option value="">Custom or unfilled role</option>{employees.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Input label="Name or role" value={draft.name ?? ''} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required />
          <Input label="Description / role" value={draft.role ?? ''} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value, description: event.target.value }))} />
          <Select label="Compensation" value={draft.compType ?? 'hourly'} onChange={(event) => setDraft((current) => ({ ...current, compType: event.target.value as 'hourly' | 'salaried' }))}><option value="hourly">Hourly</option><option value="salaried">Salaried</option></Select>
          <Input type="number" label={draft.compType === 'salaried' ? 'Annual salary' : 'Hourly wage'} value={draft.compType === 'salaried' ? draft.annualSalary ?? 0 : draft.hourlyRate ?? 0} onChange={(event) => setNumber(draft.compType === 'salaried' ? 'annualSalary' : 'hourlyRate', event.target.value)} />
          <Input type="number" label="Planned hours" value={draft.plannedHours ?? 0} onChange={(event) => setNumber('plannedHours', event.target.value)} />
          <Input type="number" label="Payroll burden %" value={draft.payrollBurdenPct ?? 0} onChange={(event) => setNumber('payrollBurdenPct', event.target.value)} />
          <Input type="number" label="Benefits" value={draft.benefitsExtraCost ?? 0} onChange={(event) => setNumber('benefitsExtraCost', event.target.value)} />
          <Input type="number" label="Bonus" value={draft.bonus ?? 0} onChange={(event) => setNumber('bonus', event.target.value)} />
        </> : null}
        {category === 'equipment' ? <>
          <Select label="Equipment Catalog" value={draft.equipmentId ?? ''} onChange={(event) => { const asset = equipmentAssets.find((item) => item.id === event.target.value); setDraft((current) => ({ ...current, equipmentId: event.target.value, name: asset?.name, description: asset?.name, equipmentPayment: asset?.equipmentPayment ?? current.equipmentPayment, yearlyFuelCost: asset?.yearlyFuelCost ?? current.yearlyFuelCost, yearlyInsuranceCost: asset?.yearlyInsuranceCost ?? current.yearlyInsuranceCost, yearlyMaintenanceCost: asset?.yearlyMaintenanceCost ?? current.yearlyMaintenanceCost })); }} required><option value="">Choose equipment</option>{equipmentAssets.map((item) => <option key={item.id} value={item.id} disabled={items.some((value) => value.id !== (editing === 'new' ? '' : editing?.id) && value.equipmentId === item.id)}>{item.name}</option>)}</Select>
          <Select label="Classification" value={draft.classification ?? 'billable'} onChange={(event) => setDraft((current) => ({ ...current, classification: event.target.value as 'billable' | 'overhead' }))}><option value="billable">Billable</option><option value="overhead">Overhead</option></Select>
          <Select label="Cost type" value={draft.costType ?? 'owned'} onChange={(event) => setDraft((current) => ({ ...current, costType: event.target.value as 'owned' | 'financed' | 'leased' }))}><option value="owned">Owned</option><option value="financed">Financed</option><option value="leased">Leased</option></Select>
          <Input type="number" label="Annual payment" value={draft.equipmentPayment ?? 0} onChange={(event) => setNumber('equipmentPayment', event.target.value)} />
          <Input type="number" label="Yearly fuel" value={draft.yearlyFuelCost ?? 0} onChange={(event) => setNumber('yearlyFuelCost', event.target.value)} />
          <Input type="number" label="Yearly insurance" value={draft.yearlyInsuranceCost ?? 0} onChange={(event) => setNumber('yearlyInsuranceCost', event.target.value)} />
          <Input type="number" label="Yearly maintenance" value={draft.yearlyMaintenanceCost ?? 0} onChange={(event) => setNumber('yearlyMaintenanceCost', event.target.value)} />
          <Input type="number" label="Utilization hours" value={draft.utilizationHours ?? 0} onChange={(event) => setNumber('utilizationHours', event.target.value)} />
          <Input type="number" label="Allocation months" min={0} max={12} value={draft.allocationMonths ?? 12} onChange={(event) => setNumber('allocationMonths', event.target.value)} />
          <Input type="number" label="Planned amount" value={draft.plannedAmount ?? 0} onChange={(event) => setNumber('plannedAmount', event.target.value)} />
        </> : null}
        {category === 'materials' ? <>
          <Select label="Material Catalog" value={draft.materialCatalogItemId ?? ''} onChange={(event) => { const material = materialCatalogItems.find((item) => item.id === event.target.value); setDraft((current) => ({ ...current, materialCatalogItemId: event.target.value || undefined, name: material?.name ?? current.name, description: material?.name ?? current.description, unit: material?.unit ?? current.unit, unitCost: material?.defaultUnitCost ?? current.unitCost })); }}><option value="">Manual material</option>{materialCatalogItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Input label="Material name" value={draft.name ?? draft.description ?? ''} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value, description: event.target.value }))} required />
          <Input label="Unit" value={draft.unit ?? 'each'} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} />
          <Input type="number" label="Unit cost" value={draft.unitCost ?? 0} onChange={(event) => setNumber('unitCost', event.target.value)} />
          <Input type="number" label="Planned quantity" value={draft.plannedQuantity ?? 1} onChange={(event) => setNumber('plannedQuantity', event.target.value)} />
        </> : null}
        {category === 'subcontractors' ? <>
          <Input label="Subcontractor name" value={draft.name ?? ''} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required />
          <Input label="Unit" value={draft.unit ?? 'each'} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} />
          <Input type="number" label="Rate" value={draft.rate ?? 0} onChange={(event) => setNumber('rate', event.target.value)} />
          <Input type="number" label="Planned quantity" value={draft.plannedQuantity ?? 1} onChange={(event) => setNumber('plannedQuantity', event.target.value)} />
          <Input type="number" label="Planned amount" value={draft.plannedAmount ?? 0} onChange={(event) => setNumber('plannedAmount', event.target.value)} />
          <div className="sm:col-span-2"><TextArea label="Description" value={draft.description ?? ''} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></div>
        </> : null}
      </div>
    </Modal>
    <BudgetPlanImportDialog open={importOpen} onClose={() => setImportOpen(false)} budget={budget} division={division} category={category} />
  </div>;
}