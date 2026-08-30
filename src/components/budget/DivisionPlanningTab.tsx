import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, GripVertical, HardHat, Package, Pencil, Plus, ReceiptText, Trash2, Truck, Users } from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal, Select, TextArea } from '../ui';
import type { Budget, BudgetDivision, BudgetDivisionPlanCategory, BudgetDivisionPlanningItem } from '../../types';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import BudgetPlanImportDialog from './BudgetPlanImportDialog';
import { calculateDivisionLabour, calculateDivisionLabourShare, isLabourAllocatedToDivision, labourAllocationForDivision, labourAllocationTotal, splitLabourAllocationsEvenly } from '../../pages/budget/divisionLabourPlanningModel';
import EquipmentInfoForm from '../equipment/EquipmentInfoForm';
import { emptyEquipmentInfoFormValue, normalizeEquipmentInfoForm, type EquipmentInfoFormValue, validateEquipmentInfoForm } from '../equipment/equipmentFormModel';
import { calculateAnnualEquipmentCost, calculateEquipmentCostBreakdown } from '../../utils/equipmentPricing';
import { overheadAllocatedAmount, overheadAllocationForDivision, overheadAllocationTotal, overheadAllocationsAreValid, splitOverheadAllocationsEvenly } from '../../pages/budget/overheadAllocationModel.js';
import { resolveEmployeeCostInputs } from '../../utils/employeeLabourCost';

const config = {
  labour: {
    label: 'Labour',
    singular: 'Labour',
    icon: Users,
    title: 'No labour planned yet',
    description: 'Add employees and labour assumptions manually, or import your team and planning assumptions from a previous Budget.',
  },
  equipment: {
    label: 'Equipment',
    singular: 'Equipment',
    icon: Truck,
    title: 'No equipment planned yet',
    description: 'Add equipment from the Equipment Catalog, or bring forward equipment and cost assumptions from a previous Budget.',
  },
  materials: {
    label: 'Materials',
    singular: 'Material',
    icon: Package,
    title: 'No materials planned yet',
    description: 'Add materials manually or import commonly used materials from a previous Budget.',
  },
  subcontractors: {
    label: 'Subcontractors',
    singular: 'Subcontractor',
    icon: HardHat,
    title: 'No subcontractors planned yet',
    description: 'Add subcontractors manually or bring forward subcontractor planning items from a previous Budget.',
  },
  overhead: {
    label: 'Overhead',
    singular: 'Overhead Cost',
    icon: ReceiptText,
    title: 'No Division overhead planned yet',
    description: 'Costs specific to this division that are not already captured as labour, equipment, materials, or subcontractor costs.',
  },
} as const;

interface Props {
  budget: Budget;
  division: BudgetDivision;
  category: BudgetDivisionPlanCategory;
  canEdit: boolean;
}

const numberValue = (value: string) => Number(value) || 0;

export default function DivisionPlanningTab({ budget, division, category, canEdit }: Props) {
  const settings = config[category];
  const Icon = settings.icon;
  const { budgetDivisionPlanningItems, budgetDivisions, employees, labourClasses, equipmentAssets, materialCatalogItems, subcontractorCatalogItems, addBudgetDivisionPlanningItem, updateBudgetDivisionPlanningItem, saveBudgetEquipmentPlanningItem, deleteBudgetDivisionPlanningItem, reorderBudgetDivisionPlanningItems } = useStore();
  const items = budgetDivisionPlanningItems.filter((item) => item.budgetId === budget.id && item.category === category && (item.category === 'labour' ? isLabourAllocatedToDivision(item, division.id) : item.category === 'overhead' ? overheadAllocationForDivision(item, division.id) > 0 : item.divisionId === division.id || (item.category === 'equipment' && item.equipmentDivisionAllocations?.some((allocation) => allocation.divisionId === division.id && allocation.months > 0)))).sort((left, right) => left.sortOrder - right.sortOrder);
  const activeDivisions = budgetDivisions.filter((item) => item.budgetId === budget.id && item.status === 'active').sort((left, right) => left.sortOrder - right.sortOrder);
  const budgetLabourItems = budgetDivisionPlanningItems.filter((item) => item.budgetId === budget.id && item.category === 'labour');
  const [editing, setEditing] = useState<BudgetDivisionPlanningItem | null | 'new'>(null);
  const [draft, setDraft] = useState<Partial<BudgetDivisionPlanningItem>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [overheadError, setOverheadError] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [equipmentError, setEquipmentError] = useState('');
  const [showEquipmentCalcDetails, setShowEquipmentCalcDetails] = useState(false);

  const openNew = () => {
    const equipmentDefaults = emptyEquipmentInfoFormValue();
    setDraft(
      category === 'labour'
        ? {
            compType: 'hourly',
            plannedHours: 1900,
            labourClassification: 'billable',
            expectedBillablePct: 80,
            overtimeHours: 0,
            overtimeMultiplier: 1.5,
            divisionAllocations: activeDivisions.map((item) => ({
              divisionId: item.id,
              hours: item.id === division.id ? 1900 : 0,
            })),
          }
        : category === 'equipment'
          ? {
              classification: equipmentDefaults.equipmentClassification,
              costType: equipmentDefaults.equipmentCostType,
              equipmentPayment: 0,
              equipmentPaymentFrequencyPerYear: 12,
              yearlyFuelCost: 0,
              yearlyInsuranceCost: 0,
              yearlyMaintenanceCost: 0,
              sellableHoursPerYear: 0,
              equipmentHoursPerDay: 8,
              equipmentDivisionAllocations: [{ divisionId: division.id, months: 12, sellableHours: 0 }],
            }
              : category === 'overhead'
            ? { plannedAmount: 0, overheadDivisionAllocations: activeDivisions.map((item) => ({ divisionId: item.id, percentage: item.id === division.id ? 100 : 0 })) }
            : { unit: 'each', plannedQuantity: 1 },
    );
            setOverheadError('');
    setEquipmentError('');
    setShowEquipmentCalcDetails(false);
    setEditing('new');
  };
  const openEdit = (item: BudgetDivisionPlanningItem) => {
    setDraft({
      ...item,
      labourClassification: item.labourClassification ?? 'billable',
      expectedBillablePct: item.expectedBillablePct ?? 0,
      overtimeHours: item.overtimeHours ?? 0,
      overtimeMultiplier: item.overtimeMultiplier ?? 1.5,
      divisionAllocations: activeDivisions.map((value) => ({
        divisionId: value.id,
        hours: labourAllocationForDivision(item, value.id),
      })),
      equipmentDivisionAllocations: item.equipmentDivisionAllocations?.length
        ? item.equipmentDivisionAllocations
        : [
            {
              divisionId: item.divisionId,
              months: item.allocationMonths ?? 12,
            },
          ],
      overheadDivisionAllocations: activeDivisions.map((value) => ({
        divisionId: value.id,
        percentage: item.overheadDivisionAllocations?.find((allocation) => allocation.divisionId === value.id)?.percentage ?? 0,
      })),
    });
    setOverheadError('');
    setEquipmentError('');
    setShowEquipmentCalcDetails(false);
    setEditing(item);
  };
  const setNumber = (field: keyof BudgetDivisionPlanningItem, value: string) => setDraft((current) => ({ ...current, [field]: numberValue(value) }));
  const setDivisionAllocation = (divisionId: string, hours: number) =>
    setDraft((current) => ({
      ...current,
      divisionAllocations: activeDivisions.map((item) => ({
        divisionId: item.id,
        hours: item.id === divisionId ? hours : (current.divisionAllocations?.find((allocation) => allocation.divisionId === item.id)?.hours ?? 0),
      })),
    }));
  const splitLabourEvenly = () =>
    setDraft((current) => ({
      ...current,
      divisionAllocations: splitLabourAllocationsEvenly(
        activeDivisions.map((item) => item.id),
        current.plannedHours,
      ),
    }));
  const draftLabour = calculateDivisionLabour(draft);
  const allocationTotal = labourAllocationTotal(draft.divisionAllocations);
  const labourAllocationValid = category !== 'labour' || Math.abs(allocationTotal - (draft.plannedHours ?? 0)) < 0.001;
  const labourInputsValid = category !== 'labour' || ((draft.expectedBillablePct ?? 0) <= 100 && (draft.overtimeMultiplier ?? 1.5) >= 1);
  const linkedEquipment = equipmentAssets.find((item) => item.id === draft.equipmentId);
  const equipmentFormValue: EquipmentInfoFormValue = {
    description: linkedEquipment?.name ?? draft.name ?? draft.description ?? '',
    costCode: linkedEquipment?.type ?? draft.costCode ?? '',
    equipmentCostType: linkedEquipment?.costType ?? draft.costType ?? 'financed',
    equipmentClassification: linkedEquipment?.equipmentClassification ?? draft.classification ?? 'billable',
    equipmentPayment: draft.equipmentPayment ?? linkedEquipment?.equipmentPayment ?? 0,
    equipmentPaymentFrequencyPerYear: draft.equipmentPaymentFrequencyPerYear ?? draft.paymentFrequencyPerYear ?? linkedEquipment?.equipmentPaymentFrequencyPerYear ?? 12,
    yearlyFuelCost: draft.yearlyFuelCost ?? linkedEquipment?.yearlyFuelCost ?? 0,
    yearlyInsuranceCost: draft.yearlyInsuranceCost ?? linkedEquipment?.yearlyInsuranceCost ?? 0,
    yearlyMaintenanceCost: draft.yearlyMaintenanceCost ?? linkedEquipment?.yearlyMaintenanceCost ?? 0,
    expectedReplacementCost: draft.expectedReplacementCost,
    expectedResaleValue: draft.expectedResaleValue,
    remainingUsefulMonths: draft.remainingUsefulMonths,
    sellableHoursPerYear: draft.sellableHoursPerYear ?? draft.utilizationHours ?? 0,
    equipmentHoursPerDay: draft.equipmentHoursPerDay ?? 8,
    rentalCost: draft.rentalCost ?? linkedEquipment?.rentalCost ?? 0,
    rentalUnit: draft.rentalUnit ?? linkedEquipment?.rentalUnit ?? 'day',
  };
  const equipmentCostBreakdown = calculateEquipmentCostBreakdown(equipmentFormValue);
  const equipmentAllocationTotal = (draft.equipmentDivisionAllocations ?? []).reduce((sum, allocation) => sum + Number(allocation.months || 0), 0);
  const equipmentAllocationValid = category !== 'equipment' || Math.abs(equipmentAllocationTotal - 12) < 0.001;
  const overheadTotal = overheadAllocationTotal(draft.overheadDivisionAllocations);
  const overheadAllocationValid = category !== 'overhead' || overheadAllocationsAreValid(draft.overheadDivisionAllocations);
  const setOverheadDivisionAllocation = (divisionId: string, percentage: number) => setDraft((current) => ({
    ...current,
    overheadDivisionAllocations: activeDivisions.map((item) => ({
      divisionId: item.id,
      percentage: item.id === divisionId ? percentage : current.overheadDivisionAllocations?.find((allocation) => allocation.divisionId === item.id)?.percentage ?? 0,
    })),
  }));
  const setEquipmentFormValue = (value: EquipmentInfoFormValue) =>
    setDraft((current) => ({
      ...current,
      name: value.description,
      description: value.description,
      costCode: value.costCode,
      costType: value.equipmentCostType,
      classification: value.equipmentClassification,
      equipmentPayment: value.equipmentPayment,
      equipmentPaymentFrequencyPerYear: value.equipmentPaymentFrequencyPerYear,
      paymentFrequencyPerYear: undefined,
      yearlyFuelCost: value.yearlyFuelCost,
      yearlyInsuranceCost: value.yearlyInsuranceCost,
      yearlyMaintenanceCost: value.yearlyMaintenanceCost,
      expectedReplacementCost: value.expectedReplacementCost,
      expectedResaleValue: value.expectedResaleValue,
      remainingUsefulMonths: value.remainingUsefulMonths,
      sellableHoursPerYear: value.sellableHoursPerYear,
      utilizationHours: undefined,
      equipmentHoursPerDay: value.equipmentHoursPerDay,
      rentalCost: value.rentalCost,
      rentalUnit: value.rentalUnit,
      unit: value.equipmentCostType === 'rental' ? value.rentalUnit : 'hr',
      plannedAmount: value.equipmentCostType === 'rental' ? value.rentalCost : calculateEquipmentCostBreakdown(value).totalEquipmentCostPerYear,
    }));
  const setEquipmentDivisionAllocation = (divisionId: string, field: 'months' | 'sellableHours', value: number) =>
    setDraft((current) => ({
      ...current,
      equipmentDivisionAllocations: activeDivisions.map((item) => ({
        divisionId: item.id,
        months: current.equipmentDivisionAllocations?.find((allocation) => allocation.divisionId === item.id)?.months ?? 0,
        sellableHours: current.equipmentDivisionAllocations?.find((allocation) => allocation.divisionId === item.id)?.sellableHours ?? 0,
        ...(item.id === divisionId ? { [field]: value } : {}),
      })),
    }));

  const save = async () => {
    if (saveInFlight.current) return;
    if (!overheadAllocationValid) {
      setOverheadError('Division allocations must total exactly 100%.');
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    let nextDraft = { ...draft };
    if (category === 'equipment') {
      const normalized = normalizeEquipmentInfoForm(equipmentFormValue);
      const validationError = validateEquipmentInfoForm(normalized);
      if (validationError || !equipmentAllocationValid) {
        setEquipmentError(validationError ?? 'Equipment allocation must total 12 months.');
        setSaving(false);
        saveInFlight.current = false;
        return;
      }
      nextDraft = {
        ...nextDraft,
        equipmentPayment: normalized.equipmentPayment,
        equipmentPaymentFrequencyPerYear: normalized.equipmentPaymentFrequencyPerYear,
        paymentFrequencyPerYear: undefined,
        yearlyFuelCost: normalized.yearlyFuelCost,
        yearlyInsuranceCost: normalized.yearlyInsuranceCost,
        yearlyMaintenanceCost: normalized.yearlyMaintenanceCost,
        expectedReplacementCost: normalized.expectedReplacementCost,
        expectedResaleValue: normalized.expectedResaleValue,
        remainingUsefulMonths: normalized.remainingUsefulMonths,
        sellableHoursPerYear: normalized.sellableHoursPerYear,
        utilizationHours: undefined,
        equipmentHoursPerDay: normalized.equipmentHoursPerDay,
        rentalCost: normalized.equipmentCostType === 'rental' ? normalized.rentalCost : undefined,
        rentalUnit: normalized.equipmentCostType === 'rental' ? normalized.rentalUnit : undefined,
        unit: normalized.equipmentCostType === 'rental' ? normalized.rentalUnit : 'hr',
        allocationMonths: undefined,
        plannedAmount: normalized.equipmentCostType === 'rental' ? normalized.rentalCost : equipmentCostBreakdown.totalEquipmentCostPerYear,
      };
      const { name: _name, description: _description, costCode: _costCode, costType: _costType, classification: _classification, ...planningData } = nextDraft;
      const result = await saveBudgetEquipmentPlanningItem({
        planningItem: {
          ...planningData,
          budgetId: budget.id,
          divisionId: division.id,
          category,
        },
        existingItem: editing === 'new' ? undefined : editing ?? undefined,
        createEquipmentAsset: !draft.equipmentId,
        catalogPatch: {
          name: normalized.description,
          type: normalized.costCode || 'General Equipment',
          equipmentClassification: normalized.equipmentClassification,
          costType: normalized.equipmentCostType,
        },
      });
      setSaving(false);
      saveInFlight.current = false;
      if (result) setEditing(null);
      else setEquipmentError('Equipment changes could not be saved. Check your connection and try again.');
      return;
    }
    const result =
      editing === 'new'
        ? await addBudgetDivisionPlanningItem({
            ...nextDraft,
            budgetId: budget.id,
            divisionId: division.id,
            category,
          } as Omit<BudgetDivisionPlanningItem, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt'>)
        : editing
          ? await updateBudgetDivisionPlanningItem(editing, nextDraft)
          : null;
    setSaving(false);
    saveInFlight.current = false;
    if (result) setEditing(null);
    else if (category === 'overhead') setOverheadError('Overhead could not be saved. Check your connection and try again.');
  };

  const reorder = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const next = (category === 'labour' || category === 'equipment' || category === 'overhead' ? budgetDivisionPlanningItems.filter((item) => item.budgetId === budget.id && item.category === category) : items).slice().sort((left, right) => left.sortOrder - right.sortOrder);
    const sourceIndex = next.findIndex((item) => item.id === sourceId);
    const targetIndex = next.findIndex((item) => item.id === targetId);
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    void reorderBudgetDivisionPlanningItems(
      budget.id,
      division.id,
      category,
      next.map((item) => item.id),
    );
  };
  const move = (item: BudgetDivisionPlanningItem, offset: number) => {
    const index = items.findIndex((value) => value.id === item.id);
    const target = items[index + offset];
    if (target) reorder(item.id, target.id);
  };
  const equipmentMonthsForDivision = (item: BudgetDivisionPlanningItem) => item.equipmentDivisionAllocations?.find((allocation) => allocation.divisionId === division.id)?.months ?? (item.divisionId === division.id ? (item.allocationMonths ?? 12) : 0);
  const plannedAmount = (item: BudgetDivisionPlanningItem) => {
    if (item.category === 'labour') return calculateDivisionLabourShare(item, division.id).annualLabourCost;
    if (item.category === 'equipment') {
      const asset = equipmentAssets.find((value) => value.id === item.equipmentId);
      const annualCost = calculateAnnualEquipmentCost({ ...item, costType: asset?.costType ?? item.costType });
      return (annualCost * equipmentMonthsForDivision(item)) / 12;
    }
    if (item.category === 'overhead') return overheadAllocatedAmount(item, division.id);
    if (item.plannedAmount !== undefined) return item.plannedAmount;
    return (item.unitCost ?? item.rate ?? 0) * (item.plannedQuantity ?? 1);
  };
  const total = items.reduce((sum, item) => sum + plannedAmount(item), 0);
  const directLabourTotal = items.reduce((sum, item) => sum + calculateDivisionLabourShare(item, division.id).directLabourCost, 0);
  const overheadLabourTotal = items.reduce((sum, item) => sum + calculateDivisionLabourShare(item, division.id).overheadLabourCost, 0);

  const actions = canEdit ? (
    <div className="flex flex-wrap justify-center gap-2">
      <Button onClick={openNew}>
        <Plus /> Add {settings.singular}
      </Button>
      {category !== 'overhead' ? <Button variant="secondary" onClick={() => setImportOpen(true)}><Download /> Import from Previous Budget</Button> : null}
    </div>
  ) : undefined;

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<Icon />} title={settings.title} description={settings.description} action={actions} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">{settings.label} Plan</h2>
              <p className="mt-1 text-sm text-brand-400">
                {items.length} item{items.length === 1 ? '' : 's'} · {formatCurrency(total)} planned
                {category === 'labour' ? ` · ${formatCurrency(directLabourTotal)} direct · ${formatCurrency(overheadLabourTotal)} overhead pool` : ''}
              </p>
            </div>
            {actions}
          </div>
          <Card className="overflow-hidden rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b border-brand-100 bg-brand-50 text-left text-xs uppercase text-brand-400 dark:border-brand-600 dark:bg-brand-800">
                  <tr>
                    <th className="w-24 px-3 py-3">Order</th>
                    <th className="px-3 py-3">{settings.singular}</th>
                    <th className="px-3 py-3">Planning assumptions</th>
                    <th className="px-3 py-3 text-right">{category === 'overhead' ? 'Allocated Cost' : 'Annual Cost'}</th>
                    {canEdit ? <th className="w-24 px-3 py-3 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 dark:divide-brand-600">
                  {items.map((item, index) => {
                    const labour = calculateDivisionLabour(item);
                    const labourShare = calculateDivisionLabourShare(item, division.id);
                    return (
                      <tr
                        key={item.id}
                        draggable={canEdit}
                        onDragStart={() => setDraggedId(item.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedId) reorder(draggedId, item.id);
                          setDraggedId(null);
                        }}
                        className="text-brand-800 dark:text-brand-100"
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 text-brand-400">
                            <GripVertical size={16} />
                            <button type="button" aria-label={`Move ${item.name ?? item.description} earlier`} disabled={!canEdit || index === 0} onClick={() => move(item, -1)}>
                              <ArrowUp size={15} />
                            </button>
                            <button type="button" aria-label={`Move ${item.name ?? item.description} later`} disabled={!canEdit || index === items.length - 1} onClick={() => move(item, 1)}>
                              <ArrowDown size={15} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold">{item.name || item.description}</p>
                          {item.description && item.name !== item.description ? <p className="text-xs text-brand-400">{item.description}</p> : null}
                        </td>
                        <td className="px-3 py-3 text-brand-500 dark:text-brand-300">
                          {category === 'labour' ? (
                            <>
                              <p>
                                {item.role ?? item.compType ?? 'Labour'} · {labour.classification === 'overhead' ? 'Overhead' : `${labour.expectedBillablePct}% billable · ${labourShare.expectedBillableHours.toFixed(0)} allocated hrs · ${formatCurrency(labour.directCostPerBillableHour)}/hr`}
                              </p>
                              <p className="mt-1 text-xs font-medium text-brand-500">
                                Allocation: {labourShare.hours} hours to {division.name}
                              </p>
                            </>
                          ) : category === 'equipment' ? (
                            `${item.classification ?? 'billable'} · ${equipmentMonthsForDivision(item)} months · ${formatCurrency(item.yearlyFuelCost ?? 0)} yearly fuel`
                          ) : category === 'overhead' ? (
                            <><p>Total annual cost: {formatCurrency(item.plannedAmount ?? 0)}</p><p className="mt-1 text-xs font-medium text-brand-500">{division.name}: {overheadAllocationForDivision(item, division.id).toFixed(2)}%</p></>
                          ) : (
                            `${item.plannedQuantity ?? 1} ${item.unit ?? 'each'} × ${formatCurrency(item.unitCost ?? item.rate ?? 0)}`
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">{formatCurrency(plannedAmount(item))}</td>
                        {canEdit ? (
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-1">
                              <button type="button" title="Edit" onClick={() => openEdit(item)} className="grid h-8 w-8 place-items-center rounded-md text-brand-500 hover:bg-brand-50">
                                <Pencil size={15} />
                              </button>
                              <button type="button" title="Remove" onClick={() => void deleteBudgetDivisionPlanningItem(item)} className="grid h-8 w-8 place-items-center rounded-md text-accent-700 hover:bg-accent-50">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}


      <Modal
        open={editing !== null}
        onClose={() => {
          if (!saving) setEditing(null);
        }}
        title={`${editing === 'new' ? 'Add' : 'Edit'} ${settings.singular}`}
        size={category === 'equipment' ? 'large' : 'wide'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || (!draft.name && !draft.description && category !== 'equipment') || !labourAllocationValid || !labourInputsValid || !equipmentAllocationValid || !overheadAllocationValid}>
              {saving ? 'Saving...' : category === 'equipment' ? (editing === 'new' && draft.equipmentId ? 'Add to Budget' : editing === 'new' ? 'Save Equipment' : 'Save Changes') : `Save ${settings.singular}`}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {category === 'labour' ? (
            <>
              <div className="sm:col-span-2">
                <h3 className="font-semibold text-brand-900 dark:text-brand-50">Employee / Labour Details</h3>
              </div>
              <Select
                label="Employee Catalog"
                value={draft.employeeId ?? ''}
                disabled={editing !== 'new' && Boolean(draft.employeeId)}
                onChange={(event) => {
                  const employee = employees.find((item) => item.id === event.target.value);
                  const costInputs = employee ? resolveEmployeeCostInputs(employee) : null;
                  setDraft((current) => ({
                    ...current,
                    employeeId: event.target.value || undefined,
                    name: employee?.name ?? current.name,
                    role: employee?.role ?? current.role,
                    ...(costInputs ?? {}),
                    labourClassification: employee ? (employee.labourType === 'overhead' ? 'overhead' : 'billable') : current.labourClassification,
                    expectedBillablePct: employee?.labourType === 'overhead' ? 0 : current.expectedBillablePct,
                  }));
                }}
              >
                <option value="">Custom or unfilled role</option>
                {employees
                  .filter((item) => item.active)
                  .map((item) => {
                    const existing = budgetLabourItems.find((value) => value.employeeId === item.id);
                    const labourClassName = labourClasses.find((labourClass) => labourClass.id === item.labourClassId && labourClass.active)?.name;
                    return (
                      <option key={item.id} value={item.id} disabled={Boolean(existing)}>
                        {item.name}
                        {labourClassName ? ` · ${labourClassName}` : ' · Labour Class unassigned'}
                        {existing ? ` — Already in Budget (${labourAllocationForDivision(existing, division.id)} hours allocated to ${division.name})` : ''}
                      </option>
                    );
                  })}
              </Select>
              {editing === 'new' && budgetLabourItems.some((item) => item.employeeId) ? (
                <div className="sm:col-span-2 rounded-lg border border-brand-100 bg-brand-50 p-3 dark:border-brand-600 dark:bg-brand-800">
                  <p className="text-xs font-semibold uppercase text-brand-400">Already in Budget</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {budgetLabourItems
                      .filter((item) => item.employeeId)
                      .map((item) => (
                        <Button key={item.id} type="button" variant="secondary" size="sm" onClick={() => openEdit(item)}>
                          {item.name ?? item.description} · {labourAllocationForDivision(item, division.id)} hours allocated to {division.name} · Edit Allocation
                        </Button>
                      ))}
                  </div>
                </div>
              ) : null}
              <Input
                label="Name or role"
                value={draft.name ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
              <Input
                label="Description / role"
                value={draft.role ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    role: event.target.value,
                    description: event.target.value,
                  }))
                }
              />
              <Select
                label="Compensation"
                value={draft.compType ?? 'hourly'}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    compType: event.target.value as 'hourly' | 'salaried',
                  }))
                }
              >
                <option value="hourly">Hourly</option>
                <option value="salaried">Salaried</option>
              </Select>
              <Input type="number" min={0} label={draft.compType === 'salaried' ? 'Annual salary' : 'Base hourly wage'} value={draft.compType === 'salaried' ? (draft.annualSalary ?? 0) : (draft.hourlyRate ?? 0)} onChange={(event) => setNumber(draft.compType === 'salaried' ? 'annualSalary' : 'hourlyRate', event.target.value)} />
              <fieldset className="sm:col-span-2 border-y border-brand-100 py-4 dark:border-brand-600">
                <legend className="font-semibold text-brand-900 dark:text-brand-50">Labour Classification</legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer gap-3">
                    <input
                      type="radio"
                      name="labour-classification"
                      value="billable"
                      checked={(draft.labourClassification ?? 'billable') === 'billable'}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          labourClassification: 'billable',
                        }))
                      }
                    />
                    <span>
                      <strong className="block text-sm">Billable Labour</strong>
                      <span className="text-xs text-brand-400">Labour expected to be recovered directly through jobs.</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer gap-3">
                    <input
                      type="radio"
                      name="labour-classification"
                      value="overhead"
                      checked={draft.labourClassification === 'overhead'}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          labourClassification: 'overhead',
                          expectedBillablePct: 0,
                        }))
                      }
                    />
                    <span>
                      <strong className="block text-sm">Overhead Labour</strong>
                      <span className="text-xs text-brand-400">Labour that supports operations but is not normally charged directly to jobs.</span>
                    </span>
                  </label>
                </div>
              </fieldset>
              {draft.labourClassification !== 'overhead' ? (
                <div className="sm:col-span-2">
                  <Input type="number" min={0} max={100} label="Expected Billable %" value={draft.expectedBillablePct ?? 0} onChange={(event) => setNumber('expectedBillablePct', event.target.value)} />
                  <p className="mt-1 text-xs text-brand-400">Estimated percentage of this employee's paid working hours that can realistically be charged to jobs.</p>
                  {(draft.expectedBillablePct ?? 0) > 100 ? <p className="mt-1 text-xs font-semibold text-accent-700">Expected Billable % cannot exceed 100%.</p> : null}
                </div>
              ) : null}
              <div className="sm:col-span-2 mt-2">
                <h3 className="font-semibold text-brand-900 dark:text-brand-50">Working Hours / Overtime</h3>
              </div>
              <Input type="number" min={0} label="Regular Hours / Year" value={draft.plannedHours ?? 0} onChange={(event) => setNumber('plannedHours', event.target.value)} />
              <Input type="number" min={0} label="Planned Overtime Hours / Year" value={draft.overtimeHours ?? 0} disabled={draft.compType === 'salaried'} onChange={(event) => setNumber('overtimeHours', event.target.value)} />
              <div>
                <Input type="number" min={1} step={0.1} label="Overtime Multiplier" value={draft.overtimeMultiplier ?? 1.5} disabled={draft.compType === 'salaried'} onChange={(event) => setNumber('overtimeMultiplier', event.target.value)} />
                {(draft.overtimeMultiplier ?? 1.5) < 1 ? <p className="mt-1 text-xs font-semibold text-accent-700">Overtime multiplier must be at least 1.</p> : null}
              </div>
              <Input type="number" label="Payroll burden %" value={draft.payrollBurdenPct ?? 0} onChange={(event) => setNumber('payrollBurdenPct', event.target.value)} />
              <Input type="number" label="Benefits" value={draft.benefitsExtraCost ?? 0} onChange={(event) => setNumber('benefitsExtraCost', event.target.value)} />
              <Input type="number" label="Bonus" value={draft.bonus ?? 0} onChange={(event) => setNumber('bonus', event.target.value)} />
              <section className="sm:col-span-2 border-y border-brand-100 py-4 dark:border-brand-600">
                <h3 className="font-semibold text-brand-900 dark:text-brand-50">Calculated Labour Cost</h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-brand-400">Regular Wage Cost</dt>
                    <dd className="font-semibold">{formatCurrency(draftLabour.regularWageCost)}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-400">Overtime Cost</dt>
                    <dd className="font-semibold">{formatCurrency(draftLabour.overtimeWageCost)}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-400">Payroll Burden</dt>
                    <dd className="font-semibold">{formatCurrency(draftLabour.payrollBurdenCost)}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-400">Annual Labour Cost</dt>
                    <dd className="font-semibold">{formatCurrency(draftLabour.annualLabourCost)}</dd>
                  </div>
                  {draft.labourClassification !== 'overhead' ? (
                    <>
                      <div>
                        <dt className="text-brand-400">Expected Billable Hours</dt>
                        <dd className="font-semibold">{draftLabour.expectedBillableHours.toFixed(0)}</dd>
                      </div>
                      <div>
                        <dt className="text-brand-400">Direct Cost / Billable Hour</dt>
                        <dd className="font-semibold">{draftLabour.expectedBillableHours > 0 ? `${formatCurrency(draftLabour.directCostPerBillableHour)}/hr` : 'Not available'}</dd>
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-2">
                      <dt className="text-brand-400">Recovery</dt>
                      <dd className="font-semibold">Included in overhead pool; no billable charge-out rate.</dd>
                    </div>
                  )}
                </dl>
              </section>
              <section className="sm:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-brand-900 dark:text-brand-50">Allocate Employee Cost Across Divisions</h3>
                    <p className="mt-1 text-xs text-brand-400">Assign this employee's regular annual hours to each Division.</p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={splitLabourEvenly}>
                    Split Evenly
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  {activeDivisions.map((item) => {
                    const hours = draft.divisionAllocations?.find((allocation) => allocation.divisionId === item.id)?.hours ?? 0;
                    return (
                      <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
                        <label htmlFor={`labour-allocation-${item.id}`} className="text-sm">
                          {item.name}
                          {item.id === division.id ? <span className="ml-2 text-xs text-brand-500">Current Division</span> : null}
                        </label>
                        <Input id={`labour-allocation-${item.id}`} type="number" min={0} step={0.01} value={hours} onChange={(event) => setDivisionAllocation(item.id, numberValue(event.target.value))} />
                        <span className="text-sm text-brand-400">hours</span>
                      </div>
                    );
                  })}
                </div>
                <div className={`mt-3 text-sm font-semibold ${labourAllocationValid ? 'text-green-700' : allocationTotal > (draft.plannedHours ?? 0) ? 'text-accent-700' : 'text-amber-700'}`}>{labourAllocationValid ? `Allocated: ${allocationTotal} hours · Remaining: 0 hours` : allocationTotal > (draft.plannedHours ?? 0) ? `Allocated: ${allocationTotal} hours · ${allocationTotal - (draft.plannedHours ?? 0)} hours over allocation` : `Allocated: ${allocationTotal} hours · Remaining: ${(draft.plannedHours ?? 0) - allocationTotal} hours`}</div>
              </section>
            </>
          ) : null}
          {category === 'equipment' ? (
            <div className="space-y-6 sm:col-span-2">
              <section>
                <h3 className="text-sm font-semibold text-gray-900">Equipment Catalog</h3>
                <p className="mt-1 text-xs text-gray-500">Choose an existing asset, or leave this blank to create one when you save.</p>
                <div className="mt-3">
                  <Select
                    label="Existing Equipment (optional)"
                    value={draft.equipmentId ?? ''}
                    disabled={editing !== 'new'}
                    onChange={(event) => {
                      const asset = equipmentAssets.find((item) => item.id === event.target.value);
                      setEquipmentError('');
                      setDraft((current) =>
                        asset
                          ? {
                              ...current,
                              equipmentId: asset.id,
                              name: asset.name,
                              description: asset.name,
                              costCode: asset.type,
                              costType: asset.costType,
                              classification: asset.equipmentClassification ?? 'billable',
                              equipmentPayment: asset.equipmentPayment ?? 0,
                              equipmentPaymentFrequencyPerYear: asset.equipmentPaymentFrequencyPerYear ?? 12,
                              paymentFrequencyPerYear: undefined,
                              yearlyFuelCost: asset.yearlyFuelCost ?? 0,
                              yearlyInsuranceCost: asset.yearlyInsuranceCost ?? 0,
                              yearlyMaintenanceCost: asset.yearlyMaintenanceCost ?? 0,
                            }
                          : {
                              ...current,
                              ...emptyEquipmentInfoFormValue(),
                              equipmentId: undefined,
                              name: '',
                              description: '',
                              costCode: '',
                            },
                      );
                    }}
                  >
                    <option value="">Create new equipment</option>
                    {equipmentAssets.map((item) => (
                      <option key={item.id} value={item.id} disabled={budgetDivisionPlanningItems.some((value) => value.budgetId === budget.id && value.category === 'equipment' && value.id !== (editing === 'new' ? '' : editing?.id) && value.equipmentId === item.id)}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </section>

              <EquipmentInfoForm value={equipmentFormValue} onChange={setEquipmentFormValue} context="budget" totalEquipmentCostPerYear={equipmentCostBreakdown.totalEquipmentCostPerYear} annualPayments={equipmentCostBreakdown.annualPayments} annualReplacementReserve={equipmentCostBreakdown.annualReplacementReserve} totalCostPerHour={equipmentCostBreakdown.totalCostPerHour} totalCostPerDay={equipmentCostBreakdown.totalCostPerDay} showCalculationDetails={showEquipmentCalcDetails} onToggleCalculationDetails={() => setShowEquipmentCalcDetails((value) => !value)} />

              <section className="border-t border-gray-200 pt-5">
                <h3 className="text-sm font-semibold text-gray-900">Allocate Annual Equipment Cost</h3>
                <p className="mt-1 text-xs text-gray-500">Allocation controls cost responsibility and which Division Equipment views show this asset.</p>
                <div className="mt-3 space-y-2">
                  {activeDivisions.map((item) => {
                    const allocation = draft.equipmentDivisionAllocations?.find((value) => value.divisionId === item.id);
                    const months = allocation?.months ?? 0;
                    const sellableHours = allocation?.sellableHours ?? 0;
                    return (
                      <div key={item.id} className="grid items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_10rem]">
                        <label htmlFor={`equipment-allocation-${item.id}`} className="text-sm font-medium text-gray-900">
                          {item.name}
                          {item.id === division.id ? <span className="ml-2 text-xs font-normal text-brand-600">Current Division</span> : null}
                        </label>
                        <div className="flex items-center gap-2">
                          <Input id={`equipment-allocation-${item.id}`} type="number" min={0} max={12} step={0.25} value={months} onChange={(event) => setEquipmentDivisionAllocation(item.id, 'months', numberValue(event.target.value))} />
                          <span className="text-xs text-gray-500">months</span>
                        </div>
                        <Input aria-label={`${item.name} sellable equipment hours`} type="number" min={0} step={1} value={sellableHours} onChange={(event) => setEquipmentDivisionAllocation(item.id, 'sellableHours', numberValue(event.target.value))} />
                        <p className="text-right text-sm font-semibold text-gray-900">{formatCurrency((equipmentCostBreakdown.totalEquipmentCostPerYear * months) / 12)}</p>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-500">Sellable hours are entered explicitly for each Division and are not inferred from allocated months.</p>
                <p className={`mt-3 text-sm font-semibold ${equipmentAllocationValid ? 'text-green-700' : equipmentAllocationTotal > 12 ? 'text-accent-700' : 'text-amber-700'}`}>
                  {equipmentAllocationTotal} of 12 months allocated
                  {equipmentAllocationTotal < 12 ? ` · ${12 - equipmentAllocationTotal} remaining` : equipmentAllocationTotal > 12 ? ` · ${equipmentAllocationTotal - 12} over allocation` : ''}
                </p>
              </section>
              {equipmentError ? <p className="text-sm text-accent-700">{equipmentError}</p> : null}
            </div>
          ) : null}
          {category === 'materials' ? (
            <>
              <Select
                label="Material Catalog"
                value={draft.materialCatalogItemId ?? ''}
                onChange={(event) => {
                  const material = materialCatalogItems.find((item) => item.id === event.target.value);
                  setDraft((current) => ({
                    ...current,
                    materialCatalogItemId: event.target.value || undefined,
                    name: material?.name ?? current.name,
                    description: material?.name ?? current.description,
                    unit: material?.unit ?? current.unit,
                    unitCost: material?.defaultUnitCost ?? current.unitCost,
                  }));
                }}
              >
                <option value="">Manual material</option>
                {materialCatalogItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Material name"
                value={draft.name ?? draft.description ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                    description: event.target.value,
                  }))
                }
                required
              />
              <Input
                label="Unit"
                value={draft.unit ?? 'each'}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    unit: event.target.value,
                  }))
                }
              />
              <Input type="number" label="Unit cost" value={draft.unitCost ?? 0} onChange={(event) => setNumber('unitCost', event.target.value)} />
              <Input type="number" label="Planned quantity" value={draft.plannedQuantity ?? 1} onChange={(event) => setNumber('plannedQuantity', event.target.value)} />
            </>
          ) : null}
          {category === 'subcontractors' ? (
            <>
              <Select
                label="Subcontractor Catalog"
                value={draft.subcontractorCatalogItemId ?? draft.vendorId ?? ''}
                onChange={(event) => {
                  const subcontractor = subcontractorCatalogItems.find((item) => item.id === event.target.value);
                  setDraft((current) => ({
                    ...current,
                    subcontractorCatalogItemId: subcontractor?.id,
                    vendorId: subcontractor?.id,
                    name: subcontractor?.name ?? current.name,
                    description: subcontractor?.trade ?? current.description,
                    unit: subcontractor?.unit ?? current.unit,
                    rate: subcontractor?.defaultUnitCost ?? current.rate,
                  }));
                }}
              >
                <option value="">Manual subcontractor</option>
                {subcontractorCatalogItems.map((item) => <option key={item.id} value={item.id}>{item.name}{item.trade ? ` - ${item.trade}` : ''}</option>)}
              </Select>
              <Input
                label="Subcontractor name"
                value={draft.name ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
              <Input
                label="Unit"
                value={draft.unit ?? 'each'}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    unit: event.target.value,
                  }))
                }
              />
              <Input type="number" label="Rate" value={draft.rate ?? 0} onChange={(event) => setNumber('rate', event.target.value)} />
              <Input type="number" label="Planned quantity" value={draft.plannedQuantity ?? 1} onChange={(event) => setNumber('plannedQuantity', event.target.value)} />
              <Input type="number" label="Planned amount" value={draft.plannedAmount ?? 0} onChange={(event) => setNumber('plannedAmount', event.target.value)} />
              <div className="sm:col-span-2">
                <TextArea
                  label="Description"
                  value={draft.description ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
            </>
          ) : null}
          {category === 'overhead' ? (
            <>
              <Input
                label="Overhead cost"
                value={draft.name ?? draft.description ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                    description: event.target.value,
                  }))
                }
                required
              />
              <Input
                label="Cost code"
                value={draft.costCode ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    costCode: event.target.value,
                  }))
                }
              />
              <Input type="number" min={0} label="Annual amount" value={draft.plannedAmount ?? 0} onChange={(event) => setNumber('plannedAmount', event.target.value)} />
              <div className="sm:col-span-2 rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="font-semibold text-gray-900">Division Allocation</h3><p className="mt-1 text-sm text-gray-500">Allocate this one overhead cost across the applicable Divisions.</p></div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setDraft((current) => ({ ...current, overheadDivisionAllocations: splitOverheadAllocationsEvenly(activeDivisions.map((item) => item.id)) })); setOverheadError(''); }}>Split Evenly</Button>
                </div>
                <div className="mt-3 space-y-2">
                  {activeDivisions.map((item) => {
                    const percentage = draft.overheadDivisionAllocations?.find((allocation) => allocation.divisionId === item.id)?.percentage ?? 0;
                    return <div key={item.id} className="grid items-center gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]">
                      <label htmlFor={`overhead-allocation-${item.id}`} className="text-sm font-medium text-gray-900">{item.name}</label>
                      <div className="flex items-center gap-2"><Input id={`overhead-allocation-${item.id}`} aria-label={`${item.name} overhead allocation percentage`} type="number" min={0} max={100} step={0.01} value={percentage} onChange={(event) => { setOverheadDivisionAllocation(item.id, numberValue(event.target.value)); setOverheadError(''); }} /><span className="text-sm text-gray-500">%</span></div>
                      <p className="text-right text-sm font-semibold text-gray-900">{formatCurrency(Math.round((draft.plannedAmount ?? 0) * percentage) / 100)}</p>
                    </div>;
                  })}
                </div>
                <p className={`mt-3 text-sm font-semibold ${overheadAllocationValid ? 'text-green-700' : 'text-amber-700'}`}>{overheadTotal.toFixed(2)}% allocated{overheadAllocationValid ? '' : ' · Must total 100%'}</p>
                {overheadError ? <p className="mt-2 text-sm text-red-600" role="alert">{overheadError}</p> : null}
              </div>
            </>
          ) : null}
        </div>
      </Modal>
      <BudgetPlanImportDialog open={importOpen} onClose={() => setImportOpen(false)} budget={budget} division={division} category={category} />
    </div>
  );
}
