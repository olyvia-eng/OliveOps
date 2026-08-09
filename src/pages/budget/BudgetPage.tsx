import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../store';
import { PageHeader, Button, Card, Modal, Input, Select, TextArea, EmptyState } from '../../components/ui';
import { Plus, Pencil, Trash2, FileDown, Info, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { BUDGET_CATEGORIES } from '../../config/budgetCategories.js';
import { formatCurrency } from '../../utils';
import { formatNumericDisplayValue, parseNumericInputValue } from '../../utils/numberInput';
import type {
  BudgetItem,
  BudgetRate,
  Budget,
  BudgetCategory,
  LabourBudgetPlan,
  EquipmentCostType,
  EquipmentAsset,
  RevenueSalesGoal,
  EmployeeLabourType,
} from '../../types';
import EmployeeEditModal from '../../components/employees/EmployeeEditModal';
import EmployeeCreateModal from '../../components/employees/EmployeeCreateModal';
import EquipmentAssetForm, {
  emptyEquipmentAssetFormValue,
  toEquipmentAssetPayload,
} from '../../components/equipment/EquipmentAssetForm';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type BudgetTab = 'analysis' | 'revenue' | 'labour' | 'materials' | 'equipment' | 'subcontractors' | 'overhead';
type LabourTableView = 'all' | 'hourly' | 'salaried';
type EquipmentTableView = 'all' | EquipmentCostType;
type ExportColumnMode = 'budgeted' | 'actual';
const EQUIPMENT_COST_TYPES: EquipmentCostType[] = ['financed', 'leased', 'owned'];
const RATE_CATEGORIES = ['labour', 'equipment', 'material', 'subcontractor'] as const;
const CATEGORY_BY_TAB: Record<Exclude<BudgetTab, 'analysis'>, BudgetCategory> = {
  revenue: 'revenue',
  labour: 'labour',
  materials: 'materials',
  equipment: 'equipment',
  subcontractors: 'subcontractors',
  overhead: 'overhead',
};

const normalizeEquipmentCostType = (value: EquipmentCostType | undefined): EquipmentCostType => {
  if (value === 'financed' || value === 'leased' || value === 'owned') return value;
  return 'owned';
};

const createBudgetCategoryGroups = (): Record<BudgetCategory, BudgetItem[]> => ({
  revenue: [],
  labour: [],
  materials: [],
  equipment: [],
  subcontractors: [],
  overhead: [],
  marketing: [],
  insurance: [],
  other: [],
});

const emptyBudgetRate = (budgetId?: string): Omit<BudgetRate, 'id' | 'createdAt' | 'updatedAt'> => ({
  budgetId: budgetId ?? '',
  category: 'labour',
  itemName: '',
  description: '',
  unit: 'hr',
  unitCost: 0,
  defaultMarkupPercent: 0,
  defaultSellPrice: 0,
  active: true,
  sortOrder: 0,
});

const currentPeriod = () => new Date().toISOString().slice(0, 7);

const compareBudgetItemsByCostCode = (a: BudgetItem, b: BudgetItem) => {
  const aCode = a.costCode?.trim() ?? '';
  const bCode = b.costCode?.trim() ?? '';

  if (!aCode && !bCode) {
    return a.description.localeCompare(b.description, undefined, { sensitivity: 'base' });
  }
  if (!aCode) return 1;
  if (!bCode) return -1;

  const byCode = aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
  if (byCode !== 0) return byCode;

  return a.description.localeCompare(b.description, undefined, { sensitivity: 'base' });
};

const normalizedEquipmentIdentity = (item: Pick<BudgetItem, 'equipmentId' | 'costCode' | 'description'>) => {
  if (item.equipmentId?.trim()) return `id:${item.equipmentId.trim()}`;
  if (item.costCode?.trim()) return `code:${item.costCode.trim().toUpperCase()}`;
  if (item.description.trim()) return `desc:${item.description.trim().toLowerCase()}`;
  return null;
};

const empty = (budgetId?: string): Omit<BudgetItem, 'id'> => ({
  budgetId,
  category: 'labour',
  equipmentId: undefined,
  equipmentCostType: undefined,
  costCode: '',
  equipmentPayment: undefined,
  equipmentPaymentFrequencyPerYear: undefined,
  fuelPriceUnit: undefined,
  averageFuelPrice: undefined,
  averageFuelBurnPerHour: undefined,
  fuelCostPerHour: undefined,
  yearlyInsuranceCost: undefined,
  yearlyMaintenanceCost: undefined,
  equipmentHoursPerDay: undefined,
  monthlyInsuranceCost: undefined,
  monthlyMaintenanceCost: undefined,
  sellableHoursPerYear: undefined,
  actualMachineHoursPerYear: undefined,
  monthsUsedPerYear: undefined,
  equipmentCostAllocationPercent: undefined,
  description: '',
  budgeted: 0,
  actual: 0,
  period: currentPeriod(),
});

const equipmentInfoDefaults = () => ({
  equipmentPayment: 0,
  equipmentPaymentFrequencyPerYear: 12,
  fuelPriceUnit: 'L' as const,
  averageFuelPrice: 0,
  averageFuelBurnPerHour: 0,
  fuelCostPerHour: 0,
  yearlyInsuranceCost: 0,
  yearlyMaintenanceCost: 0,
  equipmentHoursPerDay: 8,
  sellableHoursPerYear: 0,
  actualMachineHoursPerYear: 0,
  monthsUsedPerYear: 12,
  equipmentCostAllocationPercent: 100,
});

const equipmentInfoDefaultsFromAsset = (asset: EquipmentAsset) => {
  const averageFuelPrice = asset.averageFuelPrice ?? 0;
  const averageFuelBurnPerHour = asset.averageFuelBurnPerHour ?? 0;
  return {
    equipmentPayment: asset.equipmentPayment ?? 0,
    equipmentPaymentFrequencyPerYear: asset.equipmentPaymentFrequencyPerYear ?? 12,
    fuelPriceUnit: asset.fuelPriceUnit ?? 'L' as const,
    averageFuelPrice,
    averageFuelBurnPerHour,
    fuelCostPerHour: averageFuelPrice * averageFuelBurnPerHour,
    yearlyInsuranceCost: asset.yearlyInsuranceCost ?? 0,
    yearlyMaintenanceCost: asset.yearlyMaintenanceCost ?? 0,
    equipmentHoursPerDay: 8,
    sellableHoursPerYear: 0,
    actualMachineHoursPerYear: 0,
    monthsUsedPerYear: 12,
    equipmentCostAllocationPercent: 100,
  };
};

const yearlyHoursBase = 2080;
const buildLabourPlanId = (budgetId: string, employeeId: string, year: string) => `${budgetId}-${employeeId}-${year}`;
const buildRevenueSalesGoalId = (budgetId: string, scopeType: 'year', scopeValue: string) => `revenue-goal-${budgetId}-${scopeType}-${scopeValue}`;
const DEFAULT_WORKING_DAYS_YEAR = 260;
const isSalariedCompType = (value: string | undefined) => value === 'salaried' || value === 'salary';

const defaultLabourPlan = (budgetId: string, employeeId: string, year: string, hourlyRate: number, sortOrder: number): LabourBudgetPlan => ({
  id: buildLabourPlanId(budgetId, employeeId, year),
  budgetId,
  employeeId,
  year,
  compType: 'hourly',
  description: '',
  sortOrder,
  hoursPerYear: 1900,
  billablePct: 84,
  overtimeFactorPct: 0,
  payrollBurdenPct: 18,
  benefitsExtraCost: 0,
  bonus: 0,
  billableHoursYear: 1600,
  unbillableHoursYear: 300,
  overtimeHoursYear: 0,
  overtimeMultiplier: 1.5,
  hourlyRate,
  annualSalary: Math.round(hourlyRate * yearlyHoursBase),
  labourBurdenPct: 18,
});

const LABOUR_ITEM_TYPES: EmployeeLabourType[] = ['field_producing', 'overhead'];

const toOptionLabel = (value: string) => value
  .split('_')
  .join(' ')
  .split(' ')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatBudgetTabLabel = (value: BudgetTab) => {
  switch (value) {
    case 'analysis':
      return 'Analysis';
    case 'revenue':
      return 'Revenue';
    case 'labour':
      return 'Labour';
    case 'materials':
      return 'Materials';
    case 'equipment':
      return 'Equipment';
    case 'subcontractors':
      return 'Subcontractors';
    case 'overhead':
      return 'Overhead';
  }
};

export default function BudgetPage() {
  const navigate = useNavigate();
  const { budgetId: routeBudgetId } = useParams<{ budgetId: string }>();
  const {
    budgets,
    budgetItems,
    budgetRates,
    labourBudgetPlans,
    revenueSalesGoals,
    equipmentAssets,
    addEquipmentAsset,
    addBudget,
    updateBudget,
    employees,
    updateEmployee,
    addBudgetItem,
    updateBudgetItem,
    deleteBudgetItem,
    addBudgetRate,
    updateBudgetRate,
    deleteBudgetRate,
    upsertLabourBudgetPlan,
    deleteLabourBudgetPlan,
    upsertRevenueSalesGoal,
  } = useStore();
  const [year, setYear] = useState(currentPeriod().slice(0, 4));
  const [activeTab, setActiveTab] = useState<BudgetTab>('revenue');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [form, setForm] = useState(empty());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [assumptionsModalOpen, setAssumptionsModalOpen] = useState(false);
  const [labourTableView, setLabourTableView] = useState<LabourTableView>('all');
  const [equipmentTableView, setEquipmentTableView] = useState<EquipmentTableView>('all');
  const [showLabourCalcDetails, setShowLabourCalcDetails] = useState(false);
  const [showEquipmentCalcDetails, setShowEquipmentCalcDetails] = useState(false);
  const [averageFuelPriceInput, setAverageFuelPriceInput] = useState('0');
  const [averageFuelBurnPerHourInput, setAverageFuelBurnPerHourInput] = useState('0');
  const [billablePctDrafts, setBillablePctDrafts] = useState<Record<string, string>>({});
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);
  const [mobileEquipmentCatalogOpen, setMobileEquipmentCatalogOpen] = useState(false);
  const [createCatalogEquipmentOnSave, setCreateCatalogEquipmentOnSave] = useState(false);
  const [canonicalEquipmentForm, setCanonicalEquipmentForm] = useState(emptyEquipmentAssetFormValue());
  const [createEmployeeOpen, setCreateEmployeeOpen] = useState(false);
  const [employeeCatalogSearch, setEmployeeCatalogSearch] = useState('');
  const [employeeCatalogCollapsed, setEmployeeCatalogCollapsed] = useState(false);
  const [equipmentCatalogSearch, setEquipmentCatalogSearch] = useState('');
  const [equipmentCatalogCollapsed, setEquipmentCatalogCollapsed] = useState(false);
  const [plannerEmployeeError, setPlannerEmployeeError] = useState('');
  const [equipmentCatalogError, setEquipmentCatalogError] = useState('');
  const [draggedPlanId, setDraggedPlanId] = useState<string | null>(null);
  const [dragOverPlanId, setDragOverPlanId] = useState<string | null>(null);
  const [removePlanId, setRemovePlanId] = useState<string | null>(null);
  const [editEmployeeId, setEditEmployeeId] = useState<string | null>(null);
  const [ratesModalOpen, setRatesModalOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<BudgetRate | null>(null);
  const [rateForm, setRateForm] = useState<Omit<BudgetRate, 'id' | 'createdAt' | 'updatedAt'>>(emptyBudgetRate());
  const [confirmDeleteRate, setConfirmDeleteRate] = useState<string | null>(null);
  const legacyBudgetBootstrapStarted = useRef(false);
  const defaultOverheadRecoveryAllocation = {
    labourPercent: 50,
    equipmentPercent: 30,
    materialsPercent: 20,
    subcontractorsPercent: 0,
  };
  const [overheadRecoveryAllocation, setOverheadRecoveryAllocation] = useState(defaultOverheadRecoveryAllocation);
  const [pricingInputs, setPricingInputs] = useState({
    payrollBurdenPct: 18,
    overheadRecoveryPct: 15,
    targetMarginPct: 20,
    equipmentUtilizationHours: 120,
    materialWastePct: 8,
    subcontractorRiskPct: 10,
  });

  const sortedBudgets = useMemo(() => {
    return budgets
      .slice()
      .sort((a: Budget, b: Budget) => b.updatedAt.localeCompare(a.updatedAt));
  }, [budgets]);

  const activeBudgetId = routeBudgetId ?? sortedBudgets[0]?.id ?? null;
  const activeBudget = activeBudgetId ? (budgets.find((budget) => budget.id === activeBudgetId) ?? null) : null;
  const hasLegacyBudgetData = budgetItems.length > 0 || labourBudgetPlans.length > 0 || revenueSalesGoals.length > 0;

  useEffect(() => {
    if (!activeBudget) {
      setOverheadRecoveryAllocation(defaultOverheadRecoveryAllocation);
      return;
    }

    setOverheadRecoveryAllocation(activeBudget.overheadRecoveryAllocation ?? defaultOverheadRecoveryAllocation);
  }, [activeBudget?.id, activeBudget?.overheadRecoveryAllocation]);


  useEffect(() => {
    if (legacyBudgetBootstrapStarted.current) return;
    if (budgets.length > 0) return;
    if (!hasLegacyBudgetData) return;

    legacyBudgetBootstrapStarted.current = true;
    void (async () => {
      const created = await addBudget({
        name: `Company Budget ${year}`,
        budgetType: 'operating',
        division: 'company_wide',
        fiscalYear: year,
        status: 'active',
      });

      if (created && !routeBudgetId) {
        navigate(`/budgets/${created.id}`, { replace: true });
      }
    })();
  }, [addBudget, budgets.length, hasLegacyBudgetData, navigate, routeBudgetId, year]);

  const legacyOwnerBudgetId = useMemo(() => {
    if (budgets.length === 0) return null;
    const oldestBudget = budgets
      .slice()
      .sort((a: Budget, b: Budget) => (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt))[0];
    return oldestBudget?.id ?? null;
  }, [budgets]);
  const hasAnyScopedBudgetData = useMemo(() => {
    return budgetItems.some((item) => Boolean(item.budgetId))
      || labourBudgetPlans.some((plan) => Boolean(plan.budgetId))
      || revenueSalesGoals.some((goal) => Boolean(goal.budgetId));
  }, [budgetItems, labourBudgetPlans, revenueSalesGoals]);
  // TODO: Remove legacy unscoped fallback once all historical budget records are migrated with budgetId.
  const includeLegacyUnscopedData = Boolean(activeBudgetId) && !hasAnyScopedBudgetData && activeBudgetId === legacyOwnerBudgetId;

  const scopedBudgetItems = useMemo(() => {
    if (!activeBudgetId) return [];
    return budgetItems.filter((item) => item.budgetId === activeBudgetId || (includeLegacyUnscopedData && !item.budgetId));
  }, [activeBudgetId, budgetItems, includeLegacyUnscopedData]);

  const scopedLabourBudgetPlans = useMemo(() => {
    if (!activeBudgetId) return [];
    return labourBudgetPlans.filter((plan) => plan.budgetId === activeBudgetId || (includeLegacyUnscopedData && !plan.budgetId));
  }, [activeBudgetId, labourBudgetPlans, includeLegacyUnscopedData]);

  const scopedRevenueSalesGoals = useMemo(() => {
    if (!activeBudgetId) return [];
    return revenueSalesGoals.filter((goal) => goal.budgetId === activeBudgetId || (includeLegacyUnscopedData && !goal.budgetId));
  }, [activeBudgetId, includeLegacyUnscopedData, revenueSalesGoals]);

  const scopedBudgetRates = useMemo(() => {
    if (!activeBudgetId) return [];
    return budgetRates
      .filter((rate) => rate.budgetId === activeBudgetId)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.itemName.localeCompare(b.itemName));
  }, [activeBudgetId, budgetRates]);

  const equipmentAssetsById = useMemo(() => {
    const next: Record<string, EquipmentAsset> = {};
    for (const asset of equipmentAssets) {
      next[asset.id] = asset;
    }
    return next;
  }, [equipmentAssets]);

  const sortedEquipmentAssets = useMemo(() => {
    return equipmentAssets
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [equipmentAssets]);

  const allYears = [...new Set(scopedBudgetItems.map((b) => b.period.slice(0, 4)))].sort().reverse();

  const items = useMemo(() => {
    return scopedBudgetItems
      .filter((b) => b.period.startsWith(`${year}-`))
      .sort(compareBudgetItemsByCostCode);
  }, [scopedBudgetItems, year]);
  const equipmentBudgetItemsForYear = useMemo(() => {
    return items.filter((item) => item.category === 'equipment');
  }, [items]);
  const equipmentBudgetItemByEquipmentId = useMemo(() => {
    const byId: Record<string, BudgetItem> = {};
    for (const item of equipmentBudgetItemsForYear) {
      if (!item.equipmentId) continue;
      byId[item.equipmentId] = item;
    }
    return byId;
  }, [equipmentBudgetItemsForYear]);
  const availableCatalogEquipment = useMemo(() => {
    return sortedEquipmentAssets
      .filter((asset) => asset.status !== 'inactive')
      .filter((asset) => asset.id && asset.id.trim().length > 0 && asset.id in equipmentAssetsById);
  }, [equipmentAssetsById, sortedEquipmentAssets]);
  const allAvailableEquipmentIncluded = useMemo(() => {
    if (availableCatalogEquipment.length === 0) return false;
    return availableCatalogEquipment.every((asset) => Boolean(equipmentBudgetItemByEquipmentId[asset.id]));
  }, [availableCatalogEquipment, equipmentBudgetItemByEquipmentId]);
  const normalizedEquipmentCatalogSearch = equipmentCatalogSearch.trim().toLowerCase();
  const filteredCatalogEquipment = useMemo(() => {
    if (!normalizedEquipmentCatalogSearch) return availableCatalogEquipment;

    return availableCatalogEquipment.filter((asset) => {
      return asset.name.toLowerCase().includes(normalizedEquipmentCatalogSearch)
        || asset.type.toLowerCase().includes(normalizedEquipmentCatalogSearch)
        || asset.serialNumber.toLowerCase().includes(normalizedEquipmentCatalogSearch);
    });
  }, [availableCatalogEquipment, normalizedEquipmentCatalogSearch]);
  const scopeLabel = year;
  const revenueScopeType: 'year' = 'year';
  const revenueScopeValue = scopeLabel;
  const plannerYear = year;

  const openNew = () => {
    const defaultPeriod = `${year}-01`;
    const defaultCategory = activeTab === 'analysis' ? 'revenue' : CATEGORY_BY_TAB[activeTab];
    if (defaultCategory === 'equipment') {
      openNewCategoryItem('equipment', { createCatalogAssetOnSave: true });
      return;
    }
    const defaultEquipmentInfo = defaultCategory === 'equipment' ? equipmentInfoDefaults() : null;
    setEditing(null);
    setForm({
      ...empty(activeBudgetId ?? undefined),
      category: defaultCategory,
      equipmentCostType: defaultCategory === 'equipment' ? 'financed' : undefined,
      ...(defaultEquipmentInfo ?? {}),
      period: defaultPeriod,
    });
    if (defaultEquipmentInfo) {
      setAverageFuelPriceInput(formatNumericDisplayValue(defaultEquipmentInfo.averageFuelPrice));
      setAverageFuelBurnPerHourInput(formatNumericDisplayValue(defaultEquipmentInfo.averageFuelBurnPerHour));
      setShowEquipmentCalcDetails(false);
    } else {
      setAverageFuelPriceInput('0');
      setAverageFuelBurnPerHourInput('0');
      setShowEquipmentCalcDetails(false);
    }
    setCreateCatalogEquipmentOnSave(false);
    setModalOpen(true);
  };

  const openNewRate = () => {
    if (!activeBudgetId) return;
    setEditingRate(null);
    setRateForm(emptyBudgetRate(activeBudgetId));
    setRatesModalOpen(true);
  };

  const openEditRate = (rate: BudgetRate) => {
    setEditingRate(rate);
    setRateForm({
      budgetId: rate.budgetId,
      category: rate.category,
      itemName: rate.itemName,
      description: rate.description,
      unit: rate.unit,
      unitCost: rate.unitCost,
      defaultMarkupPercent: rate.defaultMarkupPercent,
      defaultSellPrice: rate.defaultSellPrice,
      active: rate.active,
      sortOrder: rate.sortOrder,
    });
    setRatesModalOpen(true);
  };

  const saveRate = () => {
    if (!activeBudgetId) return;
    if (!rateForm.itemName.trim() || !rateForm.unit.trim()) return;

    const payload = {
      ...rateForm,
      budgetId: activeBudgetId,
      itemName: rateForm.itemName.trim(),
      unit: rateForm.unit.trim(),
      description: rateForm.description.trim(),
      unitCost: Math.max(0, Number(rateForm.unitCost) || 0),
      defaultMarkupPercent: Math.max(0, Number(rateForm.defaultMarkupPercent) || 0),
      defaultSellPrice: Math.max(0, Number(rateForm.defaultSellPrice) || 0),
      sortOrder: Math.max(0, Number(rateForm.sortOrder) || 0),
    };

    if (editingRate) updateBudgetRate(editingRate.id, payload);
    else addBudgetRate(payload);

    setRatesModalOpen(false);
  };
  const openEdit = (b: BudgetItem) => {
    const averageFuelPrice = b.averageFuelPrice ?? b.fuelCostPerHour ?? 0;
    const averageFuelBurnPerHour = b.averageFuelBurnPerHour ?? 1;
    setEditing(b);
    setForm({
      budgetId: b.budgetId ?? activeBudgetId ?? undefined,
      category: b.category,
      equipmentId: b.equipmentId,
      equipmentCostType: normalizeEquipmentCostType(b.equipmentCostType),
      costCode: b.costCode ?? '',
      equipmentPayment: b.equipmentPayment,
      equipmentPaymentFrequencyPerYear: b.equipmentPaymentFrequencyPerYear,
      fuelPriceUnit: b.fuelPriceUnit ?? 'L',
      averageFuelPrice,
      averageFuelBurnPerHour,
      fuelCostPerHour: b.fuelCostPerHour,
      yearlyInsuranceCost: b.yearlyInsuranceCost ?? ((b.monthlyInsuranceCost ?? 0) * 12),
      yearlyMaintenanceCost: b.yearlyMaintenanceCost ?? ((b.monthlyMaintenanceCost ?? 0) * 12),
      equipmentHoursPerDay: b.equipmentHoursPerDay ?? 8,
      sellableHoursPerYear: b.sellableHoursPerYear,
      actualMachineHoursPerYear: b.actualMachineHoursPerYear,
      monthsUsedPerYear: b.monthsUsedPerYear ?? 12,
      equipmentCostAllocationPercent: b.equipmentCostAllocationPercent ?? 100,
      description: b.description,
      budgeted: b.budgeted,
      actual: b.actual,
      period: b.period,
    });
    setAverageFuelPriceInput(formatNumericDisplayValue(averageFuelPrice));
    setAverageFuelBurnPerHourInput(formatNumericDisplayValue(averageFuelBurnPerHour));
    setShowEquipmentCalcDetails(false);
    setCreateCatalogEquipmentOnSave(false);
    setModalOpen(true);
  };
  const handleSave = async () => {
    const normalizedDescription = form.description.trim() || (createCatalogEquipmentOnSave ? canonicalEquipmentForm.name.trim() : '');
    if (!normalizedDescription) return;
    let normalizedCostCode = form.costCode?.trim();
    let normalizedEquipmentId = form.equipmentId?.trim() ? form.equipmentId.trim() : undefined;
    let createdEquipmentAssetPayload: ReturnType<typeof toEquipmentAssetPayload> | null = null;
    const normalizeNumber = (value: number | undefined) => Math.max(0, Number.isFinite(value ?? 0) ? (value ?? 0) : 0);
    const normalizedFuelPriceUnit: BudgetItem['fuelPriceUnit'] = form.fuelPriceUnit === 'gal' ? 'gal' : 'L';
    const normalizedFuelPrice = normalizeNumber(form.averageFuelPrice);
    const normalizedFuelBurnPerHour = normalizeNumber(form.averageFuelBurnPerHour);
    const normalizedFuelCostPerHour = normalizedFuelPrice * normalizedFuelBurnPerHour;
    const normalizedEquipmentPayment = normalizeNumber(form.equipmentPayment);
    const normalizedEquipmentPaymentFrequencyPerYear = normalizeNumber(form.equipmentPaymentFrequencyPerYear);
    const normalizedYearlyInsuranceCost = normalizeNumber(form.yearlyInsuranceCost);
    const normalizedYearlyMaintenanceCost = normalizeNumber(form.yearlyMaintenanceCost);
    const normalizedEquipmentHoursPerDay = normalizeNumber(form.equipmentHoursPerDay);
    const normalizedBillableHoursPerYear = normalizeNumber(form.sellableHoursPerYear);
    const normalizedMonthsUsedPerYear = Math.max(1, Math.min(12, Math.round(normalizeNumber(form.monthsUsedPerYear) || 1)));
    const normalizedEquipmentCostAllocationPercent = normalizeNumber(form.equipmentCostAllocationPercent);
    const normalizedFixedOwnershipCostBasePerYear =
      (normalizedEquipmentPayment * normalizedEquipmentPaymentFrequencyPerYear)
      + normalizedYearlyInsuranceCost
      + normalizedYearlyMaintenanceCost;
    const normalizedAllocatedFixedOwnershipCostPerYear = normalizedFixedOwnershipCostBasePerYear * (normalizedEquipmentCostAllocationPercent / 100);
    const normalizedVariableOperatingCostPerYear = normalizedFuelCostPerHour * normalizedBillableHoursPerYear;
    const normalizedTotalEquipmentCostPerYear =
      normalizedAllocatedFixedOwnershipCostPerYear
      + normalizedVariableOperatingCostPerYear;

    if (!editing && form.category === 'equipment' && createCatalogEquipmentOnSave) {
      createdEquipmentAssetPayload = toEquipmentAssetPayload(canonicalEquipmentForm);
      if (!createdEquipmentAssetPayload.name || !createdEquipmentAssetPayload.type) {
        setEquipmentCatalogError('Equipment name and type are required.');
        return;
      }

      const created = await addEquipmentAsset(createdEquipmentAssetPayload);

      if (!created.ok || !created.id) {
        setEquipmentCatalogError('Could not create equipment in the catalog.');
        return;
      }

      normalizedEquipmentId = created.id;
      normalizedCostCode = normalizedCostCode || createdEquipmentAssetPayload.serialNumber;
      setEquipmentCatalogError('');
    }

    const linkedEquipmentAsset = normalizedEquipmentId
      ? (equipmentAssetsById[normalizedEquipmentId] ?? (createdEquipmentAssetPayload ? { ...createdEquipmentAssetPayload, id: normalizedEquipmentId } as EquipmentAsset : undefined))
      : undefined;
    const canonicalFuelPrice = linkedEquipmentAsset?.averageFuelPrice ?? normalizedFuelPrice;
    const canonicalFuelBurnPerHour = linkedEquipmentAsset?.averageFuelBurnPerHour ?? normalizedFuelBurnPerHour;
    const canonicalFuelPriceUnit = linkedEquipmentAsset?.fuelPriceUnit ?? normalizedFuelPriceUnit;
    const canonicalFuelCostPerHour = canonicalFuelPrice * canonicalFuelBurnPerHour;

    const equipmentFields = form.category === 'equipment'
      ? {
          equipmentId: normalizedEquipmentId,
          equipmentPayment: linkedEquipmentAsset?.equipmentPayment ?? normalizedEquipmentPayment,
          equipmentPaymentFrequencyPerYear: linkedEquipmentAsset?.equipmentPaymentFrequencyPerYear ?? normalizedEquipmentPaymentFrequencyPerYear,
          fuelPriceUnit: canonicalFuelPriceUnit,
          averageFuelPrice: canonicalFuelPrice,
          averageFuelBurnPerHour: canonicalFuelBurnPerHour,
          fuelCostPerHour: canonicalFuelCostPerHour,
          yearlyInsuranceCost: linkedEquipmentAsset?.yearlyInsuranceCost ?? normalizedYearlyInsuranceCost,
          yearlyMaintenanceCost: linkedEquipmentAsset?.yearlyMaintenanceCost ?? normalizedYearlyMaintenanceCost,
          equipmentHoursPerDay: normalizedEquipmentHoursPerDay,
          monthlyInsuranceCost: undefined,
          monthlyMaintenanceCost: undefined,
          sellableHoursPerYear: normalizedBillableHoursPerYear,
          actualMachineHoursPerYear: normalizeNumber(form.actualMachineHoursPerYear),
          monthsUsedPerYear: normalizedMonthsUsedPerYear,
          equipmentCostAllocationPercent: normalizedEquipmentCostAllocationPercent,
        }
      : {
          equipmentId: undefined,
          equipmentPayment: undefined,
          equipmentPaymentFrequencyPerYear: undefined,
          fuelPriceUnit: undefined,
          averageFuelPrice: undefined,
          averageFuelBurnPerHour: undefined,
          fuelCostPerHour: undefined,
          yearlyInsuranceCost: undefined,
          yearlyMaintenanceCost: undefined,
          equipmentHoursPerDay: undefined,
          monthlyInsuranceCost: undefined,
          monthlyMaintenanceCost: undefined,
          sellableHoursPerYear: undefined,
          actualMachineHoursPerYear: undefined,
          monthsUsedPerYear: undefined,
          equipmentCostAllocationPercent: undefined,
        };
    const yearlyForm = {
      ...form,
      budgetId: activeBudgetId ?? undefined,
      budgeted: form.category === 'equipment' ? normalizedTotalEquipmentCostPerYear : normalizeNumber(form.budgeted),
      description: normalizedDescription,
      equipmentCostType: form.category === 'equipment'
        ? normalizeEquipmentCostType(linkedEquipmentAsset?.costType ?? form.equipmentCostType)
        : form.equipmentCostType,
      costCode: normalizedCostCode ? normalizedCostCode.toUpperCase() : undefined,
      ...equipmentFields,
      period: `${year}-01`,
    };
    if (editing) updateBudgetItem(editing.id, yearlyForm);
    else addBudgetItem(yearlyForm);
    setCreateCatalogEquipmentOnSave(false);
    setModalOpen(false);
  };
  const set = (key: keyof typeof form, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const addEquipmentToCurrentBudget = (equipmentId: string) => {
    if (!activeBudgetId) return;
    if (equipmentBudgetItemByEquipmentId[equipmentId]) {
      setEquipmentCatalogError('This equipment is already included in this budget.');
      return;
    }
    const selected = equipmentAssetsById[equipmentId];
    if (!selected) {
      setEquipmentCatalogError('Selected equipment was not found.');
      return;
    }

    const costCode = selected.serialNumber?.trim() || undefined;
    const equipmentDefaults = equipmentInfoDefaultsFromAsset(selected);
    addBudgetItem({
      ...empty(activeBudgetId),
      ...equipmentDefaults,
      budgetId: activeBudgetId,
      category: 'equipment',
      equipmentId,
      equipmentCostType: selected.costType,
      costCode,
      description: selected.name,
      period: `${year}-01`,
      budgeted: 0,
      actual: 0,
    });
    setEquipmentCatalogError('');
  };

  const openNewCategoryItem = (category: BudgetCategory, options?: { createCatalogAssetOnSave?: boolean }) => {
    const defaultPeriod = `${year}-01`;
    const defaultEquipmentInfo = category === 'equipment' ? equipmentInfoDefaults() : null;
    setEditing(null);
    setForm({
      ...empty(activeBudgetId ?? undefined),
      category,
      equipmentCostType: category === 'equipment' ? 'financed' : undefined,
      ...(defaultEquipmentInfo ?? {}),
      period: defaultPeriod,
    });
    if (defaultEquipmentInfo) {
      setAverageFuelPriceInput(formatNumericDisplayValue(defaultEquipmentInfo.averageFuelPrice));
      setAverageFuelBurnPerHourInput(formatNumericDisplayValue(defaultEquipmentInfo.averageFuelBurnPerHour));
      setShowEquipmentCalcDetails(false);
    } else {
      setAverageFuelPriceInput('0');
      setAverageFuelBurnPerHourInput('0');
      setShowEquipmentCalcDetails(false);
    }
    setCreateCatalogEquipmentOnSave(Boolean(options?.createCatalogAssetOnSave && category === 'equipment'));
    if (category === 'equipment') {
      setCanonicalEquipmentForm(() => ({
        ...emptyEquipmentAssetFormValue(),
        costType: 'financed',
        name: '',
        serialNumber: '',
      }));
    }
    setModalOpen(true);
  };

  const handleAddPlannerEmployee = async (employeeId: string) => {
    if (!activeBudgetId) return;
    const employee = employees.find((value) => value.id === employeeId);
    if (!employee) {
      setPlannerEmployeeError('Selected employee was not found.');
      return;
    }

    const existingPlan = plansByEmployeeId[employee.id];
    if (existingPlan) {
      setPlannerEmployeeError('That employee is already in this budget labour planner.');
      return;
    }

    const nextSortOrder = scopedLabourBudgetPlans
      .filter((plan) => plan.year === plannerYear)
      .reduce((max, plan) => Math.max(max, plan.sortOrder ?? 0), -1) + 1;

    const seededPlan = defaultLabourPlan(activeBudgetId, employee.id, plannerYear, employee.hourlyRate, nextSortOrder);
    const isSalariedEmployee = employee.compensationType === 'salary';
    const saved = await upsertLabourBudgetPlan({
      ...seededPlan,
      description: '',
      compType: isSalariedEmployee ? 'salaried' : 'hourly',
      annualSalary: isSalariedEmployee ? employee.hourlyRate : seededPlan.annualSalary,
    });

    if (!saved) {
      setPlannerEmployeeError('Could not add employee to labour planner.');
      return;
    }
    setPlannerEmployeeError('');
  };

  // Summaries
  const revenue = items.filter((b) => b.category === 'revenue');
  const expenses = items.filter((b) => b.category !== 'revenue');

  const totalBudgetedRevenue = revenue.reduce((s, b) => s + b.budgeted, 0);
  const totalActualRevenue = revenue.reduce((s, b) => s + b.actual, 0);
  const totalBudgetedExpenses = expenses.reduce((s, b) => s + b.budgeted, 0);
  const budgetedProfit = totalBudgetedRevenue - totalBudgetedExpenses;

  const grouped = useMemo(() => {
    const next = createBudgetCategoryGroups();
    for (const item of items) {
      next[item.category].push(item);
    }
    return next;
  }, [items]);

  const categoryTabs: Array<{ key: BudgetTab; label: string }> = [
    { key: 'revenue', label: 'Sales / Revenue' },
    { key: 'labour', label: 'Labour' },
    { key: 'materials', label: 'Materials' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'subcontractors', label: 'Subcontractors' },
    { key: 'overhead', label: 'Overhead' },
    { key: 'analysis', label: 'Analysis' },
  ];

  const totalsByCategory = useMemo(() => {
    const sum = (category: BudgetCategory) => ({
      budgeted: grouped[category].reduce((value, item) => value + item.budgeted, 0),
      actual: grouped[category].reduce((value, item) => value + item.actual, 0),
    });

    return {
      revenue: sum('revenue'),
      labour: sum('labour'),
      materials: sum('materials'),
      equipment: sum('equipment'),
      subcontractors: sum('subcontractors'),
      overhead: {
        budgeted: grouped.overhead.reduce((value, item) => value + item.budgeted, 0)
          + grouped.marketing.reduce((value, item) => value + item.budgeted, 0)
          + grouped.insurance.reduce((value, item) => value + item.budgeted, 0)
          + grouped.other.reduce((value, item) => value + item.budgeted, 0),
        actual: grouped.overhead.reduce((value, item) => value + item.actual, 0)
          + grouped.marketing.reduce((value, item) => value + item.actual, 0)
          + grouped.insurance.reduce((value, item) => value + item.actual, 0)
          + grouped.other.reduce((value, item) => value + item.actual, 0),
      },
    };
  }, [grouped]);

  const categoryRows = BUDGET_CATEGORIES.map((category) => {
    const catItems = grouped[category];
    const budgeted = catItems.reduce((sum, item) => sum + item.budgeted, 0);
    const actual = catItems.reduce((sum, item) => sum + item.actual, 0);
    const variance = category === 'revenue' ? actual - budgeted : budgeted - actual;
    return { category, budgeted, actual, variance, count: catItems.length };
  }).filter((row) => row.count > 0);

  const equipmentByCostType = useMemo(() => {
    const equipmentItems = grouped.equipment;
    const totalFor = (costType: EquipmentCostType) => ({
      budgeted: equipmentItems
        .filter((item) => normalizeEquipmentCostType(item.equipmentCostType) === costType)
        .reduce((sum, item) => sum + item.budgeted, 0),
      actual: equipmentItems
        .filter((item) => normalizeEquipmentCostType(item.equipmentCostType) === costType)
        .reduce((sum, item) => sum + item.actual, 0),
    });

    return {
      financed: totalFor('financed'),
      leased: totalFor('leased'),
      owned: totalFor('owned'),
    };
  }, [grouped.equipment]);

  const equipmentAllocationStatusByItemId = useMemo(() => {
    const statuses: Record<string, {
      totalAllocatedPercent: number;
      unallocatedPercent: number;
      overAllocatedPercent: number;
      isBalanced: boolean;
      isOverAllocated: boolean;
    }> = {};

    const activeBudgetIds = new Set(
      budgets
        .filter((budget) => budget.fiscalYear === year && budget.status === 'active')
        .map((budget) => budget.id)
    );

    const groupedByIdentity: Record<string, BudgetItem[]> = {};
    for (const item of budgetItems) {
      if (item.category !== 'equipment') continue;
      if (!item.period.startsWith(`${year}-`)) continue;
      if (!item.budgetId || !activeBudgetIds.has(item.budgetId)) continue;
      const identity = normalizedEquipmentIdentity(item);
      if (!identity) continue;
      if (!groupedByIdentity[identity]) groupedByIdentity[identity] = [];
      groupedByIdentity[identity].push(item);
    }

    for (const identity of Object.keys(groupedByIdentity)) {
      const rows = groupedByIdentity[identity];
      const totalAllocatedPercent = rows.reduce((sum, item) => {
        const value = Number.isFinite(item.equipmentCostAllocationPercent ?? 0)
          ? Math.max(0, item.equipmentCostAllocationPercent ?? 0)
          : 0;
        return sum + value;
      }, 0);
      const unallocatedPercent = Math.max(0, 100 - totalAllocatedPercent);
      const overAllocatedPercent = Math.max(0, totalAllocatedPercent - 100);
      const isBalanced = Math.abs(totalAllocatedPercent - 100) <= 0.1;
      const isOverAllocated = totalAllocatedPercent > 100;

      for (const row of rows) {
        statuses[row.id] = {
          totalAllocatedPercent,
          unallocatedPercent,
          overAllocatedPercent,
          isBalanced,
          isOverAllocated,
        };
      }
    }

    return statuses;
  }, [budgetItems, budgets, year]);

  const selectedCategory = activeTab !== 'analysis' ? activeTab : null;
  const selectedCategoryItems = selectedCategory ? grouped[selectedCategory] : [];
  const equipmentFilteredItems = useMemo(() => {
    if (equipmentTableView === 'all') return grouped.equipment;
    return grouped.equipment.filter((item) => normalizeEquipmentCostType(item.equipmentCostType) === equipmentTableView);
  }, [equipmentTableView, grouped.equipment]);

  const displayCategoryItems = activeTab === 'equipment' ? equipmentFilteredItems : selectedCategoryItems;

  const selectedCategoryTotals = selectedCategory
    ? {
        budgeted: displayCategoryItems.reduce((sum, item) => sum + item.budgeted, 0),
        actual: displayCategoryItems.reduce((sum, item) => sum + item.actual, 0),
      }
    : { budgeted: 0, actual: 0 };
  const confirmDeleteItem = confirmDelete ? items.find((item) => item.id === confirmDelete) : null;

  const tabLabel = categoryTabs.find((tab) => tab.key === activeTab)?.label ?? 'Analysis';

  const currentRevenuePlanRecord = useMemo(() => {
    return scopedRevenueSalesGoals.find((goal) => goal.scopeType === revenueScopeType && goal.scopeValue === revenueScopeValue);
  }, [scopedRevenueSalesGoals, revenueScopeType, revenueScopeValue]);

  const currentRevenuePlan = currentRevenuePlanRecord ?? {
    id: buildRevenueSalesGoalId(activeBudgetId ?? 'budget', revenueScopeType, revenueScopeValue),
    budgetId: activeBudgetId ?? undefined,
    scopeType: revenueScopeType,
    scopeValue: revenueScopeValue,
    goalRevenue: totalBudgetedRevenue > 0 ? totalBudgetedRevenue : totalActualRevenue,
    workingDays: DEFAULT_WORKING_DAYS_YEAR,
  };

  const revenuePerDayNeeded = currentRevenuePlan.workingDays > 0
    ? currentRevenuePlan.goalRevenue / currentRevenuePlan.workingDays
    : 0;

  useEffect(() => {
    if (!activeBudgetId) return;
    if (currentRevenuePlanRecord) return;
    upsertRevenueSalesGoal({
      id: buildRevenueSalesGoalId(activeBudgetId, revenueScopeType, revenueScopeValue),
      budgetId: activeBudgetId,
      scopeType: revenueScopeType,
      scopeValue: revenueScopeValue,
      goalRevenue: totalBudgetedRevenue > 0 ? totalBudgetedRevenue : totalActualRevenue,
      workingDays: DEFAULT_WORKING_DAYS_YEAR,
    });
  }, [
    currentRevenuePlanRecord,
    activeBudgetId,
    revenueScopeType,
    revenueScopeValue,
    totalBudgetedRevenue,
    totalActualRevenue,
    upsertRevenueSalesGoal,
  ]);

  const updateRevenuePlan = (key: 'goalRevenue' | 'workingDays', value: number) => {
    const sanitizedValue = Math.max(0, Number.isFinite(value) ? value : 0);
    const next: RevenueSalesGoal = {
      ...currentRevenuePlan,
      [key]: sanitizedValue,
    };
    upsertRevenueSalesGoal(next);
  };

  const exportMetricHeaders = () => {
    return ['Budgeted'];
  };

  const exportMetricCells = (budgeted: number) => {
    return [formatCurrency(budgeted)];
  };

  const plansByEmployeeId = useMemo(() => {
    const byEmployeeId: Record<string, LabourBudgetPlan> = {};
    for (const plan of scopedLabourBudgetPlans) {
      if (plan.year === plannerYear) {
        byEmployeeId[plan.employeeId] = plan;
      }
    }
    return byEmployeeId;
  }, [scopedLabourBudgetPlans, plannerYear]);

  const labourPlansForYear = useMemo(() => {
    return scopedLabourBudgetPlans
      .filter((plan) => plan.year === plannerYear)
      .slice()
      .sort((a, b) => {
        const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aName = employees.find((employee) => employee.id === a.employeeId)?.name ?? '';
        const bName = employees.find((employee) => employee.id === b.employeeId)?.name ?? '';
        return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
      });
  }, [employees, plannerYear, scopedLabourBudgetPlans]);

  const exportToPdf = (mode: ExportColumnMode = 'budgeted') => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const scopeTypeLabel = 'Yearly';
    const generatedAt = new Date().toLocaleString();

    doc.setFontSize(16);
    doc.text('OliveOps Budget Report', 40, 42);
    doc.setFontSize(10);
    doc.text(`Scope: ${scopeTypeLabel} (${scopeLabel})`, 40, 60);
    doc.text(`Tab: ${tabLabel}`, 40, 74);
    doc.text(`Generated: ${generatedAt}`, 40, 88);

    if (activeTab === 'analysis') {
      autoTable(doc, {
        startY: 104,
        head: [['Summary', ...exportMetricHeaders()]],
        body: [
          ['Revenue', ...exportMetricCells(totalBudgetedRevenue)],
          ['Expenses', ...exportMetricCells(totalBudgetedExpenses)],
          ['Profit', ...exportMetricCells(budgetedProfit)],
        ],
        styles: { fontSize: 9 },
      });

      autoTable(doc, {
        startY: 220,
        head: [['Category', ...exportMetricHeaders(), 'Items']],
        body: categoryRows.map((row) => [
          row.category.replace(/_/g, ' '),
          ...exportMetricCells(row.budgeted),
          String(row.count),
        ]),
        styles: { fontSize: 9 },
      });

      autoTable(doc, {
        startY: 390,
        head: [[
          'Category',
          'Cost Code',
          'Description',
          ...exportMetricHeaders(),
        ]],
        body: items.map((item) => {
          return [
            item.category.replace(/_/g, ' '),
            item.costCode ?? '—',
            item.description,
            ...exportMetricCells(item.budgeted),
          ];
        }),
        styles: { fontSize: 8 },
      });
    } else {
      autoTable(doc, {
        startY: 104,
        head: [['Category Totals', ...exportMetricHeaders()]],
        body: [[
          tabLabel,
          ...exportMetricCells(selectedCategoryTotals.budgeted),
        ]],
        styles: { fontSize: 9 },
      });

      autoTable(doc, {
        startY: 170,
        head: [[
          'Cost Code',
          'Description',
          ...exportMetricHeaders(),
        ]],
        body: selectedCategoryItems.map((item) => {
          return [
            item.costCode ?? '—',
            item.description,
            ...exportMetricCells(item.budgeted),
          ];
        }),
        styles: { fontSize: 9 },
      });
    }

    doc.save(`budget-${activeTab}-${scopeLabel}-${mode}.pdf`);
  };

  const updatePricingInput = (key: keyof typeof pricingInputs, value: number) => {
    const next = Number.isFinite(value) ? value : 0;
    setPricingInputs((current) => ({ ...current, [key]: Math.max(0, next) }));
  };

  const updateOverheadRecoveryAllocation = (key: keyof typeof overheadRecoveryAllocation, value: number) => {
    if (!activeBudgetId) return;

    const next = {
      ...overheadRecoveryAllocation,
      [key]: Math.max(0, Number.isFinite(value) ? value : 0),
    };

    setOverheadRecoveryAllocation(next);
    updateBudget(activeBudgetId, { overheadRecoveryAllocation: next });
  };

  const normalizedAverageFuelPrice = Math.max(0, Number.isFinite(form.averageFuelPrice ?? 0) ? (form.averageFuelPrice ?? 0) : 0);
  const normalizedAverageFuelBurnPerHour = Math.max(0, Number.isFinite(form.averageFuelBurnPerHour ?? 0) ? (form.averageFuelBurnPerHour ?? 0) : 0);
  const calculatedFuelCostPerHour = normalizedAverageFuelPrice * normalizedAverageFuelBurnPerHour;
  const normalizedEquipmentPayment = Math.max(0, Number.isFinite(form.equipmentPayment ?? 0) ? (form.equipmentPayment ?? 0) : 0);
  const normalizedEquipmentPaymentFrequencyPerYear = Math.max(
    0,
    Number.isFinite(form.equipmentPaymentFrequencyPerYear ?? 0) ? (form.equipmentPaymentFrequencyPerYear ?? 0) : 0
  );
  const normalizedYearlyInsuranceCost = Math.max(0, Number.isFinite(form.yearlyInsuranceCost ?? 0) ? (form.yearlyInsuranceCost ?? 0) : 0);
  const normalizedYearlyMaintenanceCost = Math.max(0, Number.isFinite(form.yearlyMaintenanceCost ?? 0) ? (form.yearlyMaintenanceCost ?? 0) : 0);
  const normalizedEquipmentHoursPerDay = Math.max(0, Number.isFinite(form.equipmentHoursPerDay ?? 0) ? (form.equipmentHoursPerDay ?? 0) : 0);
  const normalizedBillableHoursPerYear = Math.max(0, Number.isFinite(form.sellableHoursPerYear ?? 0) ? (form.sellableHoursPerYear ?? 0) : 0);
  const normalizedMonthsUsedPerYear = Math.max(1, Math.min(12, Math.round(Number.isFinite(form.monthsUsedPerYear ?? 0) ? (form.monthsUsedPerYear ?? 0) : 1)));
  const normalizedEquipmentCostAllocationPercent = Math.max(0, Number.isFinite(form.equipmentCostAllocationPercent ?? 0) ? (form.equipmentCostAllocationPercent ?? 0) : 0);
  const calculatedAnnualPaymentCost = normalizedEquipmentPayment * normalizedEquipmentPaymentFrequencyPerYear;
  const calculatedFixedOwnershipCostBasePerYear =
    calculatedAnnualPaymentCost
    + normalizedYearlyInsuranceCost
    + normalizedYearlyMaintenanceCost;
  const calculatedAllocatedFixedOwnershipCostPerYear = calculatedFixedOwnershipCostBasePerYear * (normalizedEquipmentCostAllocationPercent / 100);
  const calculatedAnnualFuelCost = calculatedFuelCostPerHour * normalizedBillableHoursPerYear;
  const calculatedAnnualInsuranceCost = normalizedYearlyInsuranceCost;
  const calculatedAnnualMaintenanceCost = normalizedYearlyMaintenanceCost;
  const calculatedTotalEquipmentCostPerYear =
    calculatedAllocatedFixedOwnershipCostPerYear
    + calculatedAnnualFuelCost;
  const calculatedTotalEquipmentCostPerHour = normalizedBillableHoursPerYear > 0
    ? calculatedTotalEquipmentCostPerYear / normalizedBillableHoursPerYear
    : 0;
  const calculatedTotalEquipmentCostPerDay = normalizedEquipmentHoursPerDay > 0
    ? calculatedTotalEquipmentCostPerHour * normalizedEquipmentHoursPerDay
    : 0;
  const equipmentAllocationPreview = useMemo(() => {
    if (form.category !== 'equipment') return null;

    const identity = normalizedEquipmentIdentity({
      equipmentId: form.equipmentId,
      costCode: form.costCode,
      description: form.description,
    });
    if (!identity) return null;

    const activeBudgetIds = new Set(
      budgets
        .filter((budget) => budget.fiscalYear === year && budget.status === 'active')
        .map((budget) => budget.id)
    );

    const peers = budgetItems.filter((item) => {
      if (item.category !== 'equipment') return false;
      if (!item.period.startsWith(`${year}-`)) return false;
      if (!item.budgetId || !activeBudgetIds.has(item.budgetId)) return false;
      return normalizedEquipmentIdentity(item) === identity;
    });

    const existingTotal = peers
      .filter((item) => item.id !== editing?.id)
      .reduce((sum, item) => {
        const value = Number.isFinite(item.equipmentCostAllocationPercent ?? 0)
          ? Math.max(0, item.equipmentCostAllocationPercent ?? 0)
          : 0;
        return sum + value;
      }, 0);

    const includeCurrentBudget = Boolean(activeBudgetId && activeBudgetIds.has(activeBudgetId));
    const totalAllocatedPercent = includeCurrentBudget
      ? existingTotal + normalizedEquipmentCostAllocationPercent
      : existingTotal;
    const unallocatedPercent = Math.max(0, 100 - totalAllocatedPercent);
    const overAllocatedPercent = Math.max(0, totalAllocatedPercent - 100);
    const isBalanced = Math.abs(totalAllocatedPercent - 100) <= 0.1;

    return {
      totalAllocatedPercent,
      unallocatedPercent,
      overAllocatedPercent,
      isBalanced,
      activeBudgetCount: peers.filter((item) => item.id !== editing?.id).length + (includeCurrentBudget ? 1 : 0),
    };
  }, [
    activeBudgetId,
    budgetItems,
    budgets,
    editing?.id,
    form.category,
    form.costCode,
    form.description,
    form.equipmentId,
    normalizedEquipmentCostAllocationPercent,
    year,
  ]);
  const overheadMonthlyCost = Math.max(0, Number.isFinite(form.budgeted) ? form.budgeted / 12 : 0);

  const marginDivisor = Math.max(0.01, 1 - pricingInputs.targetMarginPct / 100);

  const updateLabourPlan = (employeeId: string, key: keyof LabourBudgetPlan, value: LabourBudgetPlan[keyof LabourBudgetPlan]) => {
    const employee = employees.find((value) => value.id === employeeId);
    if (!employee) return;
    if (!activeBudgetId) return;

    const existing = plansByEmployeeId[employeeId] ?? defaultLabourPlan(activeBudgetId, employee.id, plannerYear, employee.hourlyRate, labourPlansForYear.length);
    const next = { ...existing, [key]: value };
    void upsertLabourBudgetPlan(next);
  };

  const updatePlannerEmployeeLabourType = (employeeId: string, labourType: EmployeeLabourType) => {
    updateEmployee(employeeId, { labourType });
  };

  const plannedBillableHoursTotal = useMemo(() => {
    return labourPlansForYear.reduce((sum, plan) => {
      const hoursPerYear = Math.max(0, Number.isFinite(plan.hoursPerYear ?? 0) ? (plan.hoursPerYear ?? 0) : 0);
      const fallbackBillablePct = (plan.billableHoursYear / Math.max(1, plan.billableHoursYear + plan.unbillableHoursYear + plan.overtimeHoursYear)) * 100;
      const billablePct = Math.max(0, Math.min(100, Number.isFinite(plan.billablePct ?? fallbackBillablePct) ? (plan.billablePct ?? fallbackBillablePct) : 0));
      return sum + (hoursPerYear * (billablePct / 100));
    }, 0);
  }, [labourPlansForYear]);

  const labourPlannerRows = useMemo(() => {
    return labourPlansForYear.map((plan) => {
      const employee = employees.find((value) => value.id === plan.employeeId);
      if (!employee) return null;
      const isSalariedEmployee = isSalariedCompType(plan.compType) || employee.compensationType === 'salary';

      const hoursPerYear = Math.max(
        0,
        Number.isFinite(plan.hoursPerYear ?? 0)
          ? (plan.hoursPerYear ?? 0)
          : 0
      );
      const fallbackBillablePct = (plan.billableHoursYear / Math.max(1, plan.billableHoursYear + plan.unbillableHoursYear + plan.overtimeHoursYear)) * 100;
      const billablePct = Math.max(
        0,
        Math.min(100, Number.isFinite(plan.billablePct ?? fallbackBillablePct) ? (plan.billablePct ?? fallbackBillablePct) : 0)
      );
      const annualBillableHours = hoursPerYear * (billablePct / 100);

      const hourlyWage = Math.max(0, Number.isFinite(plan.hourlyRate) ? plan.hourlyRate : 0);
      const annualSalary = Math.max(
        0,
        Number.isFinite(plan.annualSalary)
          ? plan.annualSalary
          : (employee.compensationType === 'salary' ? employee.hourlyRate : 0)
      );
      const annualBasePay = isSalariedEmployee
        ? annualSalary
        : hourlyWage * hoursPerYear;

      const overtimeHoursYear = Math.max(
        0,
        Math.min(
          hoursPerYear,
          Number.isFinite(plan.overtimeHoursYear ?? 0)
            ? (plan.overtimeHoursYear ?? 0)
            : 0
        )
      );
      const overtimeMultiplier = Math.max(1, Number.isFinite(plan.overtimeMultiplier ?? 1.5) ? (plan.overtimeMultiplier ?? 1.5) : 1.5);
      const overtimeCost = isSalariedEmployee
        ? 0
        : hourlyWage * overtimeHoursYear * (overtimeMultiplier - 1);
      const payrollBurdenPct = Math.max(0, Number.isFinite(plan.payrollBurdenPct ?? plan.labourBurdenPct ?? 0) ? (plan.payrollBurdenPct ?? plan.labourBurdenPct ?? 0) : 0);
      const benefitsExtraCost = Math.max(0, Number.isFinite(plan.benefitsExtraCost ?? 0) ? (plan.benefitsExtraCost ?? 0) : 0);
      const bonus = Math.max(0, Number.isFinite(plan.bonus ?? 0) ? (plan.bonus ?? 0) : 0);
      const payrollBurdenAmount = (annualBasePay + overtimeCost) * (payrollBurdenPct / 100);
      const totalEmployeeCostPerYear = annualBasePay + overtimeCost + payrollBurdenAmount + benefitsExtraCost + bonus;
      const hourlyRate = hoursPerYear > 0
        ? totalEmployeeCostPerYear / hoursPerYear
        : 0;

      const labourOverheadRecoveryPerHour = plannedBillableHoursTotal > 0
        ? (totalsByCategory.overhead.budgeted * (overheadRecoveryAllocation.labourPercent / 100)) / plannedBillableHoursTotal
        : 0;
      const suggestedChargeOutRate = (hourlyRate + labourOverheadRecoveryPerHour) / marginDivisor;
      const annualRevenueGenerated = suggestedChargeOutRate * annualBillableHours;
      const grossProfitGenerated = annualRevenueGenerated - totalEmployeeCostPerYear;
      const description = typeof plan.description === 'string' ? plan.description : '';

      return {
        employee,
        plan,
        description,
        hoursPerYear,
        overtimeHoursYear,
        billablePct,
        annualBillableHours,
        overtimeMultiplier,
        payrollBurdenPct,
        benefitsExtraCost,
        bonus,
        totalEmployeeCostPerYear,
        hourlyRate,
        suggestedChargeOutRate,
        annualLabourCost: totalEmployeeCostPerYear,
        annualRevenueGenerated,
        grossProfitGenerated,
      };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [employees, labourPlansForYear, marginDivisor, overheadRecoveryAllocation.labourPercent, plannedBillableHoursTotal, totalsByCategory.overhead.budgeted]);

  const visibleLabourPlannerRows = useMemo(() => {
    if (labourTableView === 'all') return labourPlannerRows;
    if (labourTableView === 'salaried') return labourPlannerRows.filter((row) => isSalariedCompType(row.plan.compType));
    return labourPlannerRows.filter((row) => row.plan.compType === labourTableView);
  }, [labourPlannerRows, labourTableView]);

  const activeEmployees = useMemo(() => {
    return employees
      .filter((employee) => employee.active)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [employees]);

  const normalizedCatalogSearch = employeeCatalogSearch.trim().toLowerCase();
  const filteredCatalogEmployees = useMemo(() => {
    if (!normalizedCatalogSearch) return activeEmployees;

    return activeEmployees.filter((employee) => {
      const roleLabel = toOptionLabel(employee.role ?? 'crew_member').toLowerCase();
      const labourLabel = toOptionLabel(employee.labourType ?? 'field_producing').toLowerCase();
      return employee.name.toLowerCase().includes(normalizedCatalogSearch)
        || roleLabel.includes(normalizedCatalogSearch)
        || labourLabel.includes(normalizedCatalogSearch);
    });
  }, [activeEmployees, normalizedCatalogSearch]);

  const labourPlannerTotalsAll = useMemo(() => {
    return labourPlannerRows.reduce((acc, row) => ({
      annualLabourCost: acc.annualLabourCost + row.totalEmployeeCostPerYear,
      annualRevenueGenerated: acc.annualRevenueGenerated + row.annualRevenueGenerated,
      grossProfitGenerated: acc.grossProfitGenerated + row.grossProfitGenerated,
      billableHoursYear: acc.billableHoursYear + row.annualBillableHours,
    }), {
      annualLabourCost: 0,
      annualRevenueGenerated: 0,
      grossProfitGenerated: 0,
      billableHoursYear: 0,
    });
  }, [labourPlannerRows]);

  const totalOverheadBudget = totalsByCategory.overhead.budgeted;
  const allocationTotalPct = overheadRecoveryAllocation.labourPercent
    + overheadRecoveryAllocation.equipmentPercent
    + overheadRecoveryAllocation.materialsPercent
    + overheadRecoveryAllocation.subcontractorsPercent;
  const allocationAmounts = {
    labour: totalOverheadBudget * (overheadRecoveryAllocation.labourPercent / 100),
    equipment: totalOverheadBudget * (overheadRecoveryAllocation.equipmentPercent / 100),
    materials: totalOverheadBudget * (overheadRecoveryAllocation.materialsPercent / 100),
    subcontractors: totalOverheadBudget * (overheadRecoveryAllocation.subcontractorsPercent / 100),
  };
  const labourOverheadRecoveryPerHour = labourPlannerTotalsAll.billableHoursYear > 0
    ? allocationAmounts.labour / labourPlannerTotalsAll.billableHoursYear
    : 0;
  const equipmentOverheadRecoveryPerHour = pricingInputs.equipmentUtilizationHours > 0
    ? allocationAmounts.equipment / pricingInputs.equipmentUtilizationHours
    : 0;
  const materialsOverheadRecoveryPercent = totalsByCategory.materials.budgeted > 0
    ? allocationAmounts.materials / totalsByCategory.materials.budgeted
    : 0;
  const subcontractorOverheadRecoveryPercent = totalsByCategory.subcontractors.budgeted > 0
    ? allocationAmounts.subcontractors / totalsByCategory.subcontractors.budgeted
    : 0;

  const getSuggestedSellPrice = (rate: BudgetRate) => {
    if (rate.category === 'labour') {
      const loadedCost = rate.unitCost * (1 + pricingInputs.payrollBurdenPct / 100);
      return (loadedCost + labourOverheadRecoveryPerHour) / marginDivisor;
    }

    if (rate.category === 'equipment') {
      return (rate.unitCost + equipmentOverheadRecoveryPerHour) / marginDivisor;
    }

    if (rate.category === 'material') {
      return rate.unitCost * (1 + materialsOverheadRecoveryPercent) / marginDivisor;
    }

    return rate.unitCost * (1 + subcontractorOverheadRecoveryPercent) / marginDivisor;
  };

  const getOverheadRecoverySummary = (rate: BudgetRate) => {
    if (rate.category === 'labour') {
      return labourPlannerTotalsAll.billableHoursYear > 0
        ? `${formatCurrency(labourOverheadRecoveryPerHour)}/${rate.unit}`
        : 'Add planned billable labour hours';
    }

    if (rate.category === 'equipment') {
      return pricingInputs.equipmentUtilizationHours > 0
        ? `${formatCurrency(equipmentOverheadRecoveryPerHour)}/${rate.unit}`
        : 'Add planned equipment utilization';
    }

    if (rate.category === 'material') {
      return totalsByCategory.materials.budgeted > 0
        ? `${(materialsOverheadRecoveryPercent * 100).toFixed(1)}% of cost`
        : 'Add expected material spend';
    }

    return totalsByCategory.subcontractors.budgeted > 0
      ? `${(subcontractorOverheadRecoveryPercent * 100).toFixed(1)}% of cost`
      : 'Add expected subcontractor spend';
  };

  const categoryAnalysisRows = useMemo(() => {
    const rows = [...categoryRows];
    const labourIndex = rows.findIndex((row) => row.category === 'labour');
    const plannerLabourBudgeted = labourPlannerTotalsAll.annualLabourCost;
    const plannerLabourCount = labourPlannerRows.length;

    if (labourIndex >= 0) {
      rows[labourIndex] = {
        ...rows[labourIndex],
        budgeted: plannerLabourBudgeted,
        count: Math.max(rows[labourIndex].count, plannerLabourCount),
      };
      return rows;
    }

    if (plannerLabourBudgeted > 0 || plannerLabourCount > 0) {
      rows.push({
        category: 'labour',
        budgeted: plannerLabourBudgeted,
        actual: 0,
        variance: plannerLabourBudgeted,
        count: plannerLabourCount,
      });
    }

    return rows;
  }, [categoryRows, labourPlannerRows.length, labourPlannerTotalsAll.annualLabourCost]);

  const persistLabourSortOrder = async (orderedPlanIds: string[]) => {
    const byPlanId = new Map(labourPlansForYear.map((plan) => [plan.id, plan]));
    for (let index = 0; index < orderedPlanIds.length; index += 1) {
      const planId = orderedPlanIds[index];
      const plan = byPlanId.get(planId);
      if (!plan) continue;
      if ((plan.sortOrder ?? Number.MAX_SAFE_INTEGER) === index) continue;
      const saved = await upsertLabourBudgetPlan({ ...plan, sortOrder: index });
      if (!saved) break;
    }
  };

  const handleLabourDrop = (targetPlanId: string) => {
    if (!draggedPlanId || draggedPlanId === targetPlanId) {
      setDraggedPlanId(null);
      setDragOverPlanId(null);
      return;
    }

    const currentOrder = labourPlannerRows.map((row) => row.plan.id);
    const draggedIndex = currentOrder.indexOf(draggedPlanId);
    const targetIndex = currentOrder.indexOf(targetPlanId);
    if (draggedIndex < 0 || targetIndex < 0) {
      setDraggedPlanId(null);
      setDragOverPlanId(null);
      return;
    }

    const nextOrder = [...currentOrder];
    const [dragged] = nextOrder.splice(draggedIndex, 1);
    nextOrder.splice(targetIndex, 0, dragged);

    setDraggedPlanId(null);
    setDragOverPlanId(null);
    void persistLabourSortOrder(nextOrder);
  };

  const renderLabourPlannerRow = (row: typeof labourPlannerRows[number]) => (
    <tr
      key={row.plan.id}
      draggable
      onDragStart={() => setDraggedPlanId(row.plan.id)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOverPlanId(row.plan.id);
      }}
      onDragLeave={() => {
        if (dragOverPlanId === row.plan.id) setDragOverPlanId(null);
      }}
      onDrop={() => handleLabourDrop(row.plan.id)}
      className={`hover:bg-gray-50 ${dragOverPlanId === row.plan.id ? 'bg-brand-50' : ''}`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="cursor-move text-gray-400" aria-label="Drag to reorder">::</div>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold uppercase text-brand-700">
            {row.employee.name
              .split(' ')
              .map((part) => part[0])
              .join('')
              .slice(0, 2)}
          </div>
          <div>
            <p className="font-medium text-gray-900 leading-tight">{row.employee.name}</p>
            <select
              value={row.employee.labourType ?? 'field_producing'}
              onChange={(e) => updatePlannerEmployeeLabourType(row.employee.id, e.target.value as EmployeeLabourType)}
              className="mt-1 border border-gray-300 rounded px-2 py-0.5 text-xs text-gray-600 bg-white"
            >
              {LABOUR_ITEM_TYPES.map((labourType) => (
                <option key={labourType} value={labourType}>{toOptionLabel(labourType)}</option>
              ))}
            </select>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <input
          type="text"
          value={row.description}
          onChange={(e) => updateLabourPlan(row.employee.id, 'description', e.target.value)}
          className="w-32 border border-gray-300 rounded px-2 py-1 text-xs"
        />
      </td>
      <td className="px-4 py-3 text-center">
        <div className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-white">
          <button
            type="button"
            onClick={() => updateLabourPlan(row.employee.id, 'compType', 'hourly')}
            className={`px-2 py-0.5 text-xs rounded ${row.plan.compType === 'hourly' ? 'bg-brand-100 text-brand-700' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            Hourly
          </button>
          <button
            type="button"
            onClick={() => updateLabourPlan(row.employee.id, 'compType', 'salaried')}
            className={`px-2 py-0.5 text-xs rounded ${isSalariedCompType(row.plan.compType) ? 'bg-accent-100 text-accent-700' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            Salary
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {(!isSalariedCompType(row.plan.compType) && row.employee.compensationType !== 'salary') ? (
          <input
            type="text"
            inputMode="decimal"
            min={0}
            value={formatNumericDisplayValue(row.plan.hourlyRate)}
            onChange={(e) => updateLabourPlan(row.employee.id, 'hourlyRate', parseNumericInputValue(e.target.value))}
            onFocus={(e) => e.currentTarget.select()}
            className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right"
          />
        ) : (
          <input
            type="text"
            inputMode="decimal"
            min={0}
            value={formatNumericDisplayValue(row.plan.annualSalary)}
            onChange={(e) => updateLabourPlan(row.employee.id, 'annualSalary', parseNumericInputValue(e.target.value))}
            onFocus={(e) => e.currentTarget.select()}
            className="w-28 border border-gray-300 rounded px-2 py-1 text-xs text-right"
          />
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <input
          type="text"
          inputMode="decimal"
          min={0}
          value={formatNumericDisplayValue(row.hoursPerYear)}
          onChange={(e) => updateLabourPlan(row.employee.id, 'hoursPerYear', parseNumericInputValue(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-4 py-3 text-center">
        <input
          type="text"
          inputMode="decimal"
          min={0}
          max={100}
          step={1}
          value={billablePctDrafts[row.employee.id] ?? String(row.plan.billablePct ?? row.billablePct)}
          onChange={(e) => {
            const next = e.target.value;
            if (!/^\d*\.?\d*$/.test(next)) return;
            setBillablePctDrafts((current) => ({ ...current, [row.employee.id]: next }));
            updateLabourPlan(row.employee.id, 'billablePct', parseNumericInputValue(next));
          }}
          onBlur={() => {
            setBillablePctDrafts((current) => {
              const next = { ...current };
              delete next[row.employee.id];
              return next;
            });
          }}
          onFocus={(e) => e.currentTarget.select()}
          className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <input
          type="text"
          inputMode="decimal"
          min={0}
          step={1}
          value={formatNumericDisplayValue(row.overtimeHoursYear)}
          onChange={(e) => updateLabourPlan(row.employee.id, 'overtimeHoursYear', parseNumericInputValue(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <input
          type="text"
          inputMode="decimal"
          min={1}
          step={0.1}
          value={formatNumericDisplayValue(row.overtimeMultiplier)}
          onChange={(e) => updateLabourPlan(row.employee.id, 'overtimeMultiplier', parseNumericInputValue(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <input
          type="text"
          inputMode="decimal"
          min={0}
          step={0.1}
          value={formatNumericDisplayValue(row.payrollBurdenPct)}
          onChange={(e) => updateLabourPlan(row.employee.id, 'payrollBurdenPct', parseNumericInputValue(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <input
          type="text"
          inputMode="decimal"
          min={0}
          value={formatNumericDisplayValue(row.benefitsExtraCost)}
          onChange={(e) => updateLabourPlan(row.employee.id, 'benefitsExtraCost', parseNumericInputValue(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <input
          type="text"
          inputMode="decimal"
          min={0}
          value={formatNumericDisplayValue(row.bonus)}
          onChange={(e) => updateLabourPlan(row.employee.id, 'bonus', parseNumericInputValue(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.totalEmployeeCostPerYear)}</td>
      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.hourlyRate)}</td>
      <td className="px-4 py-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <button type="button" className="text-gray-500 hover:text-brand-700" aria-label="Edit employee" onClick={() => setEditEmployeeId(row.employee.id)}>
            <Pencil size={14} />
          </button>
          <button type="button" className="text-accent-700 hover:text-accent-800" aria-label="Remove from budget" onClick={() => setRemovePlanId(row.plan.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );

  const renderCalculationDetails = () => (
    <details className="rounded-lg border border-gray-200 bg-white mt-4">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700">Show Calculation Details</summary>
      <div className="px-4 pb-4 text-sm text-gray-600 space-y-2">
        <p>Overtime Cost = Overtime Hours x Hourly Rate x (Overtime Multiplier - 1)</p>
        <p>Total Cost per Employee per Year = Annual Wage + Overtime Cost + Payroll Burden + Benefits/Extra Cost + Bonus</p>
        <p>Hourly Rate = Total Cost per Employee per Year / Hours per Year</p>
        <p>Labour Overhead Recovery = Labour Overhead Allocation / Planned Billable Labour Hours</p>
        <p>Suggested Labour Sell Rate = (Loaded Labour Cost + Labour Overhead Recovery) / (1 - Target Margin %)</p>
        <p>Annual Revenue Generated = Annual Billable Hours x Suggested Labour Sell Rate</p>
        <p>Gross Profit Generated = Annual Revenue Generated - Annual Labour Cost</p>
        <p className="text-xs text-gray-500 mt-2">Current assumptions: Labour {overheadRecoveryAllocation.labourPercent.toFixed(1)}%, Equipment {overheadRecoveryAllocation.equipmentPercent.toFixed(1)}%, Materials {overheadRecoveryAllocation.materialsPercent.toFixed(1)}%, Subcontractors {overheadRecoveryAllocation.subcontractorsPercent.toFixed(1)}%, Target Margin {pricingInputs.targetMarginPct.toFixed(1)}%.</p>
      </div>
    </details>
  );

  if (!activeBudgetId || !activeBudget) {
    return (
      <div>
        <PageHeader
          title="Budget Detail"
          subtitle="Select a budget first to open the full budgeting workspace."
          action={<Button onClick={() => navigate('/budgets')}>View Budgets</Button>}
        />
        <EmptyState
          title={budgets.length === 0 ? 'No budgets yet' : 'Budget not found'}
          description={budgets.length === 0
            ? 'Create your first budget from the Budgets page.'
            : 'The selected budget could not be found. Return to Budgets and choose another one.'}
          action={<Button onClick={() => navigate('/budgets')}>Go to Budgets</Button>}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={activeTab === 'labour' ? 'Labour Planner' : 'Budget'}
        subtitle={activeTab === 'labour'
          ? 'Plan your team, understand true cost, and set charge-out rates to hit your revenue goals.'
          : 'Track your company budget with category breakdowns for pricing and planning.'}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/budgets')}>Back to Budgets</Button>
            <Button variant="secondary" onClick={() => exportToPdf('budgeted')}><FileDown size={16} /> Export Budget PDF</Button>
            {activeTab === 'labour' ? (
              <Button className="lg:hidden" onClick={() => setMobileCatalogOpen(true)}><Plus size={16} /> Add Employees</Button>
            ) : activeTab === 'equipment' ? (
              <Button className="lg:hidden" onClick={() => setMobileEquipmentCatalogOpen(true)}><Plus size={16} /> Add Equipment</Button>
            ) : (
              <Button onClick={openNew}><Plus size={16} /> Add Budget Item</Button>
            )}
          </div>
        }
      />

      {/* Scope selector */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
            Budget: {activeBudget.name}
          </span>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
            {toOptionLabel(activeBudget.division)}
          </span>
          <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Yearly</span>
          <span className="text-xs text-gray-500">Current scope: {scopeLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Year:</label>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="w-32"
          />
          {allYears.length > 0 && (
            <select value={year} onChange={(e) => setYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-500">
              {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="inline-flex border border-gray-200 rounded-xl p-1 bg-white min-w-max" role="tablist" aria-label="Budget sections">
          {categoryTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'analysis' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="text-left rounded-xl">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Revenue</p>
                <p className="text-xl font-bold text-brand-700">{formatCurrency(totalBudgetedRevenue)}</p>
              </Card>
            </div>
            <button type="button" onClick={() => setAssumptionsModalOpen(true)} className="text-left rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500">
              <Card className="p-4 hover:border-brand-300 cursor-pointer">
                <p className="text-xs text-gray-500">Profit</p>
                <p className={`text-xl font-bold ${budgetedProfit >= 0 ? 'text-gray-800' : 'text-accent-700'}`}>{formatCurrency(budgetedProfit)}</p>
                <p className="text-[11px] text-gray-400 mt-2">Click to edit</p>
              </Card>
            </button>
            <div className="text-left rounded-xl">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Expenses</p>
                <p className="text-xl font-bold text-accent-700">{formatCurrency(totalBudgetedExpenses)}</p>
              </Card>
            </div>
          </div>

          <Card className="p-4 mb-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Overhead Recovery &amp; Pricing Strategy</h2>
              <p className="text-sm text-gray-500 mt-1">Choose how this budget&apos;s overhead should be recovered across labour, equipment, materials and subcontractors.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              <Input
                label="Labour %"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={overheadRecoveryAllocation.labourPercent}
                onChange={(e) => updateOverheadRecoveryAllocation('labourPercent', Number(e.target.value))}
              />
              <Input
                label="Equipment %"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={overheadRecoveryAllocation.equipmentPercent}
                onChange={(e) => updateOverheadRecoveryAllocation('equipmentPercent', Number(e.target.value))}
              />
              <Input
                label="Materials %"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={overheadRecoveryAllocation.materialsPercent}
                onChange={(e) => updateOverheadRecoveryAllocation('materialsPercent', Number(e.target.value))}
              />
              <Input
                label="Subcontractors %"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={overheadRecoveryAllocation.subcontractorsPercent}
                onChange={(e) => updateOverheadRecoveryAllocation('subcontractorsPercent', Number(e.target.value))}
              />
            </div>

            <div className={`rounded-xl border p-3 mb-4 ${Math.abs(allocationTotalPct - 100) <= 0.1 ? 'border-brand-100 bg-brand-50/50' : 'border-accent-200 bg-accent-50/60'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="font-semibold text-gray-900">Total Allocation: {allocationTotalPct.toFixed(1)}%</p>
                <p className={`font-medium ${Math.abs(allocationTotalPct - 100) <= 0.1 ? 'text-brand-700' : 'text-accent-700'}`}>
                  {Math.abs(allocationTotalPct - 100) <= 0.1
                    ? 'Allocation is balanced.'
                    : allocationTotalPct < 100
                      ? `Allocate the remaining ${(100 - allocationTotalPct).toFixed(1)}% of overhead.`
                      : `Reduce allocation by ${(allocationTotalPct - 100).toFixed(1)}%.`}
                </p>
              </div>
              <p className="mt-2 text-xs text-gray-500">Total budgeted overhead: {formatCurrency(totalOverheadBudget)}.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {([
                { key: 'labour', label: 'Labour', percent: overheadRecoveryAllocation.labourPercent, amount: allocationAmounts.labour },
                { key: 'equipment', label: 'Equipment', percent: overheadRecoveryAllocation.equipmentPercent, amount: allocationAmounts.equipment },
                { key: 'materials', label: 'Materials', percent: overheadRecoveryAllocation.materialsPercent, amount: allocationAmounts.materials },
                { key: 'subcontractors', label: 'Subcontractors', percent: overheadRecoveryAllocation.subcontractorsPercent, amount: allocationAmounts.subcontractors },
              ]).map((item) => (
                <Card key={item.key} className="p-3 bg-white border border-gray-100">
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-lg font-semibold text-gray-900">{item.percent.toFixed(1)}%</p>
                  <p className="text-sm text-gray-600 mt-1">{formatCurrency(item.amount)}</p>
                </Card>
              ))}
            </div>
          </Card>

          <Card className="p-4 mb-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Pricing / Rates</h2>
                <p className="text-sm text-gray-500 mt-1">Budget-scoped estimate rate catalog for labour, equipment, material, and subcontractor pricing.</p>
              </div>
              <Button onClick={openNewRate}><Plus size={14} /> Add Rate</Button>
            </div>

            {scopedBudgetRates.length === 0 ? (
              <EmptyState
                title="Your pricing catalog is empty"
                description="Add labour, equipment, material, and subcontractor rates so estimates can use your standard pricing."
                action={<Button onClick={openNewRate}><Plus size={14} /> Add Pricing Rate</Button>}
                helpText="Pricing rates belong to this budget and are used by estimate line items." 
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500 text-left">
                      <th className="py-2 font-medium">Category</th>
                      <th className="py-2 font-medium">Item</th>
                      <th className="py-2 font-medium">Unit</th>
                      <th className="py-2 font-medium text-right">Direct Cost</th>
                      <th className="py-2 font-medium text-right">Overhead Recovery</th>
                      <th className="py-2 font-medium text-right">Suggested Sell</th>
                      <th className="py-2 font-medium text-right">Final Sell</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {scopedBudgetRates.map((rate) => (
                      <tr key={rate.id} className="hover:bg-gray-50">
                        <td className="py-2 capitalize">{rate.category.replace('_', ' ')}</td>
                        <td className="py-2">{rate.itemName}</td>
                        <td className="py-2">{rate.unit}</td>
                        <td className="py-2 text-right">{formatCurrency(rate.unitCost)}</td>
                        <td className="py-2 text-right">{getOverheadRecoverySummary(rate)}</td>
                        <td className="py-2 text-right">{formatCurrency(getSuggestedSellPrice(rate))}</td>
                        <td className="py-2 text-right">{formatCurrency(rate.defaultSellPrice > 0 ? rate.defaultSellPrice : getSuggestedSellPrice(rate))}</td>
                        <td className="py-2">{rate.active ? 'Active' : 'Archived'}</td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEditRate(rate)}><Pencil size={13} /></Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteRate(rate.id)}><Trash2 size={13} className="text-accent-700" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {activeTab === 'labour' && (
        <>
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => setShowLabourCalcDetails((current) => !current)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {showLabourCalcDetails ? 'Hide calculation details' : 'Show calculation details'}
            </button>
          </div>

          {showLabourCalcDetails && renderCalculationDetails()}

          <div className="grid grid-cols-1 gap-4 mb-6">
            <Card className="p-4 border border-brand-100 bg-gradient-to-r from-brand-50 to-cream">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Total Annual Labour Cost</p>
                  <p className="text-3xl font-bold text-brand-700">{formatCurrency(labourPlannerTotalsAll.annualLabourCost)}</p>
                </div>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700"><Users size={18} /></span>
              </div>
            </Card>
          </div>

          <div className={`grid grid-cols-1 gap-5 mb-6 ${employeeCatalogCollapsed ? 'lg:grid-cols-[minmax(0,1fr)_auto]' : 'lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]'}`}>
            <div>
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-semibold text-gray-900">Employee Labour Planner</h2>
                      <p className="text-xs text-gray-500 mt-1">Rows are budget-specific entries. Drag rows to reorder and use remove to unlink from this budget only.</p>
                    </div>
                    <div className="inline-flex border border-gray-200 rounded-lg p-0.5 self-start">
                      <button
                        type="button"
                        onClick={() => setLabourTableView('all')}
                        className={`px-3 py-1 text-xs rounded ${labourTableView === 'all' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        All ({labourPlannerRows.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setLabourTableView('hourly')}
                        className={`px-3 py-1 text-xs rounded ${labourTableView === 'hourly' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        Hourly ({labourPlannerRows.filter((row) => row.plan.compType === 'hourly').length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setLabourTableView('salaried')}
                        className={`px-3 py-1 text-xs rounded ${labourTableView === 'salaried' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        Salaried ({labourPlannerRows.filter((row) => isSalariedCompType(row.plan.compType)).length})
                      </button>
                    </div>
                  </div>
                </div>
                {labourPlannerRows.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">
                    <p>No employees in this labour plan yet.</p>
                    <p className="text-xs mt-1">Add employees from the Employee Catalog.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[1980px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                          <th className="px-4 py-3 font-medium">Employee</th>
                          <th className="px-4 py-3 font-medium text-right">Description</th>
                          <th className="px-4 py-3 font-medium text-center">Wage Type</th>
                          <th className="px-4 py-3 font-medium text-right">Wage</th>
                          <th className="px-4 py-3 font-medium text-right">Hours per Year</th>
                          <th className="px-4 py-3 font-medium text-center">Billable %</th>
                          <th className="px-4 py-3 font-medium text-right">Overtime Hours</th>
                          <th className="px-4 py-3 font-medium text-right">Overtime Multiplier</th>
                          <th className="px-4 py-3 font-medium text-right">Payroll Burden (%)</th>
                          <th className="px-4 py-3 font-medium text-right">Benefits / Extra Cost</th>
                          <th className="px-4 py-3 font-medium text-right">Bonus</th>
                          <th className="px-4 py-3 font-medium text-right">Total Cost per Year</th>
                          <th className="px-4 py-3 font-medium text-right">Hourly Rate</th>
                          <th className="px-4 py-3 font-medium text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {labourTableView === 'all' ? (
                          <>
                            <tr className="bg-gray-50">
                              <td className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500" colSpan={14}>Hourly Employees</td>
                            </tr>
                            {labourPlannerRows.filter((row) => row.plan.compType === 'hourly').map((row) => renderLabourPlannerRow(row))}
                            <tr className="bg-gray-50">
                              <td className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500" colSpan={14}>Salaried Employees</td>
                            </tr>
                            {labourPlannerRows.filter((row) => isSalariedCompType(row.plan.compType)).map((row) => renderLabourPlannerRow(row))}
                          </>
                        ) : (
                          visibleLabourPlannerRows.map((row) => renderLabourPlannerRow(row))
                        )}
                        {visibleLabourPlannerRows.length === 0 && (
                          <tr>
                            <td className="px-4 py-4 text-sm text-gray-400" colSpan={14}>No employees in this compensation type view yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            <div className="hidden lg:block">
              {employeeCatalogCollapsed ? (
                <button
                  type="button"
                  onClick={() => setEmployeeCatalogCollapsed(false)}
                  className="flex h-full min-h-[220px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-4 text-sm font-medium text-gray-600 shadow-sm hover:border-brand-200 hover:text-brand-700"
                >
                  <ChevronLeft size={16} />
                  <span className="[writing-mode:vertical-rl] rotate-180">Employee Catalog</span>
                </button>
              ) : (
                <Card className="h-full">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">Employee Catalog</h3>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => setCreateEmployeeOpen(true)}><Plus size={13} /> New Employee</Button>
                        <button
                          type="button"
                          onClick={() => setEmployeeCatalogCollapsed(true)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-brand-200 hover:text-brand-700"
                          aria-label="Collapse employee catalog"
                          title="Collapse employee catalog"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                    <Input
                      className="mt-3"
                      value={employeeCatalogSearch}
                      onChange={(event) => setEmployeeCatalogSearch(event.target.value)}
                      placeholder="Search employees..."
                    />
                    {plannerEmployeeError && <p className="mt-2 text-xs text-accent-700">{plannerEmployeeError}</p>}
                  </div>
                  <div className="p-3 space-y-2 max-h-[680px] overflow-y-auto">
                    {activeEmployees.length === 0 ? (
                      <div className="text-sm text-gray-500 p-2">
                        <p>No employees yet.</p>
                        <p className="text-xs mt-1">Create an employee to add them to this labour plan.</p>
                      </div>
                    ) : filteredCatalogEmployees.length === 0 ? (
                      <p className="text-sm text-gray-500 p-2">No employees match your search.</p>
                    ) : filteredCatalogEmployees.every((employee) => Boolean(plansByEmployeeId[employee.id])) ? (
                      <p className="text-sm text-gray-500 p-2">All active employees are included in this labour plan.</p>
                    ) : (
                      filteredCatalogEmployees.map((employee) => {
                        const added = Boolean(plansByEmployeeId[employee.id]);
                        return (
                          <div key={employee.id} className="rounded-lg border border-gray-100 p-3 bg-white">
                            <p className="text-sm font-medium text-gray-900 leading-tight">{employee.name}</p>
                            <p className="text-xs text-gray-500 mt-1">{toOptionLabel(employee.role ?? 'crew_member')}</p>
                            <div className="mt-2">
                              {added ? (
                                <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Added</span>
                              ) : (
                                <Button size="sm" onClick={() => void handleAddPlannerEmployee(employee.id)}><Plus size={12} /> Add</Button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500 flex items-center gap-1 -mt-2 mb-4"><Info size={12} /> Hourly Rate = Total Cost of Employee per Year / Hours per Year.</p>
        </>
      )}

      {activeTab === 'revenue' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="text-left rounded-xl">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Sales / Revenue</p>
                <p className="text-xl font-bold text-brand-700">{formatCurrency(totalsByCategory.revenue.budgeted)}</p>
              </Card>
            </div>
          </div>

          <Card className="p-4 mb-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Revenue Goal Planner</h2>
              <p className="text-sm text-gray-500 mt-1">Set a revenue goal and working days for {scopeLabel} to see daily revenue required to hit target.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <Input
                label="Revenue Goal"
                type="number"
                min={0}
                value={currentRevenuePlan.goalRevenue}
                onChange={(e) => updateRevenuePlan('goalRevenue', Number(e.target.value))}
              />
              <Input
                label="Working Days"
                type="number"
                min={1}
                value={currentRevenuePlan.workingDays}
                onChange={(e) => updateRevenuePlan('workingDays', Number(e.target.value))}
              />
              <Card className="p-3 border border-gray-100">
                <p className="text-xs text-gray-500">Revenue / Day Needed</p>
                <p className="text-lg font-semibold text-gray-900">{formatCurrency(revenuePerDayNeeded)}</p>
              </Card>
              <Card className="p-3 border border-gray-100">
                <p className="text-xs text-gray-500">Working Days</p>
                <p className="text-lg font-semibold text-gray-900">{currentRevenuePlan.workingDays}</p>
              </Card>
            </div>
          </Card>
        </>
      )}

      {activeTab === 'materials' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="text-left rounded-xl">
            <Card className="p-4">
              <p className="text-xs text-gray-500">Materials</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(totalsByCategory.materials.budgeted)}</p>
            </Card>
          </div>
          <button type="button" onClick={() => setAssumptionsModalOpen(true)} className="text-left rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500">
            <Card className="p-4 hover:border-brand-300 cursor-pointer">
              <p className="text-xs text-gray-500">Materials Recovery</p>
              <p className="text-xl font-bold text-brand-700">{overheadRecoveryAllocation.materialsPercent.toFixed(1)}%</p>
              <p className="text-sm text-gray-600 mt-1">{formatCurrency(allocationAmounts.materials)}</p>
              <p className="text-[11px] text-gray-400 mt-2">Click to edit</p>
            </Card>
          </button>
        </div>
      )}

      {activeTab === 'equipment' && (
        <>
          <div className="grid grid-cols-1 gap-4 mb-4">
            <div className="text-left rounded-xl">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Equipment</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(totalsByCategory.equipment.budgeted)}</p>
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="text-left rounded-xl">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Financed Equipment</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(equipmentByCostType.financed.budgeted)}</p>
              </Card>
            </div>
            <div className="text-left rounded-xl">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Leased Equipment</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(equipmentByCostType.leased.budgeted)}</p>
              </Card>
            </div>
            <div className="text-left rounded-xl">
              <Card className="p-4">
                <p className="text-xs text-gray-500">Owned Equipment</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(equipmentByCostType.owned.budgeted)}</p>
              </Card>
            </div>
          </div>

          <div className="mb-6">
            <div className="inline-flex border border-gray-200 rounded-lg p-0.5 bg-white">
              <button
                type="button"
                onClick={() => setEquipmentTableView('all')}
                className={`px-3 py-1 text-xs rounded ${equipmentTableView === 'all' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                All Equipment
              </button>
              <button
                type="button"
                onClick={() => setEquipmentTableView('financed')}
                className={`px-3 py-1 text-xs rounded ${equipmentTableView === 'financed' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Financed
              </button>
              <button
                type="button"
                onClick={() => setEquipmentTableView('leased')}
                className={`px-3 py-1 text-xs rounded ${equipmentTableView === 'leased' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Leased
              </button>
              <button
                type="button"
                onClick={() => setEquipmentTableView('owned')}
                className={`px-3 py-1 text-xs rounded ${equipmentTableView === 'owned' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Owned
              </button>
            </div>
          </div>

          <div className={`grid grid-cols-1 gap-5 mb-6 ${equipmentCatalogCollapsed ? 'lg:grid-cols-[minmax(0,1fr)_auto]' : 'lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]'}`}>
            <div>
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <div>
                    <h2 className="font-semibold text-gray-900">Current Budget Equipment Plan</h2>
                    <p className="text-xs text-gray-500 mt-1">Budget-specific assumptions for equipment linked to this budget.</p>
                  </div>
                </div>
                {equipmentFilteredItems.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">
                    <p>No equipment in this budget yet.</p>
                    <p className="text-xs mt-1">Add existing equipment from your Equipment Catalog.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[1240px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                          <th className="px-4 py-3 font-medium">Equipment</th>
                          <th className="px-4 py-3 font-medium">Cost Type</th>
                          <th className="px-4 py-3 font-medium text-right">Cost / Year</th>
                          <th className="px-4 py-3 font-medium text-right">Cost / Day</th>
                          <th className="px-4 py-3 font-medium text-right">Cost / Hour</th>
                          <th className="px-4 py-3 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {equipmentFilteredItems.map((item) => {
                          const linkedAsset = item.equipmentId ? equipmentAssetsById[item.equipmentId] : undefined;
                          const billableHoursPerYear = Math.max(0, item.sellableHoursPerYear ?? 0);
                          const equipmentHoursPerDay = Math.max(0, item.equipmentHoursPerDay ?? 0);
                          const costPerHour = billableHoursPerYear > 0 ? item.budgeted / billableHoursPerYear : 0;
                          const costPerDay = equipmentHoursPerDay > 0 ? costPerHour * equipmentHoursPerDay : 0;
                          return (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-gray-700">
                                <p className="font-medium text-gray-900">{linkedAsset?.name ?? item.description}</p>
                                <p className="text-xs text-gray-500 mt-1">{linkedAsset ? [linkedAsset.type, linkedAsset.serialNumber].filter(Boolean).join(' • ') : 'Unlinked custom budget row'}</p>
                              </td>
                              <td className="px-4 py-2">
                                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 capitalize">
                                  {normalizeEquipmentCostType(item.equipmentCostType).replace('_', ' ')}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right">{formatCurrency(item.budgeted)}</td>
                              <td className="px-4 py-2 text-right">{formatCurrency(costPerDay)}</td>
                              <td className="px-4 py-2 text-right">{formatCurrency(costPerHour)}</td>
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-end gap-2">
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}><Pencil size={13} /></Button>
                                  <button
                                    type="button"
                                    className="text-accent-700 hover:text-accent-800 text-xs font-medium"
                                    onClick={() => setConfirmDelete(item.id)}
                                  >
                                    Remove from Budget
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            <div className="hidden lg:block">
              {equipmentCatalogCollapsed ? (
                <button
                  type="button"
                  onClick={() => setEquipmentCatalogCollapsed(false)}
                  className="flex h-full min-h-[220px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-4 text-sm font-medium text-gray-600 shadow-sm hover:border-brand-200 hover:text-brand-700"
                >
                  <ChevronLeft size={16} />
                  <span className="[writing-mode:vertical-rl] rotate-180">Equipment Catalog</span>
                </button>
              ) : (
                <Card className="h-full">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Equipment Catalog</h3>
                        <p className="text-xs text-gray-500 mt-1">Add existing equipment to this budget.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => openNewCategoryItem('equipment', { createCatalogAssetOnSave: true })}><Plus size={13} /> New Equipment</Button>
                        <button
                          type="button"
                          onClick={() => setEquipmentCatalogCollapsed(true)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-brand-200 hover:text-brand-700"
                          aria-label="Collapse equipment catalog"
                          title="Collapse equipment catalog"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                    <Input
                      className="mt-3"
                      value={equipmentCatalogSearch}
                      onChange={(event) => setEquipmentCatalogSearch(event.target.value)}
                      placeholder="Search equipment..."
                    />
                    {equipmentCatalogError && <p className="mt-2 text-xs text-accent-700">{equipmentCatalogError}</p>}
                  </div>
                  <div className="p-3 space-y-2 max-h-[680px] overflow-y-auto">
                    {sortedEquipmentAssets.filter((asset) => asset.status !== 'inactive').length === 0 ? (
                      <div className="text-sm text-gray-500 p-2">
                        <p>No equipment in your catalog yet.</p>
                        <div className="mt-2">
                          <Button size="sm" onClick={() => openNewCategoryItem('equipment', { createCatalogAssetOnSave: true })}><Plus size={12} /> New Equipment</Button>
                        </div>
                      </div>
                    ) : filteredCatalogEquipment.length === 0 && normalizedEquipmentCatalogSearch.length > 0 ? (
                      <p className="text-sm text-gray-500 p-2">No equipment match your search.</p>
                    ) : (
                      <>
                        {allAvailableEquipmentIncluded && normalizedEquipmentCatalogSearch.length === 0 && (
                          <p className="text-sm text-gray-500 p-2">All available equipment is included in this budget.</p>
                        )}
                        {filteredCatalogEquipment.map((asset) => {
                          const added = Boolean(equipmentBudgetItemByEquipmentId[asset.id]);
                          return (
                            <div key={asset.id} className="rounded-lg border border-gray-100 p-3 bg-white">
                              <p className="text-sm font-medium text-gray-900 leading-tight">{asset.name}</p>
                              <p className="text-xs text-gray-500 mt-1">{[asset.type, asset.serialNumber].filter(Boolean).join(' • ') || 'Equipment'}</p>
                              <div className="mt-2">
                                {added ? (
                                  <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Added</span>
                                ) : (
                                  <Button size="sm" onClick={() => addEquipmentToCurrentBudget(asset.id)}><Plus size={12} /> Add</Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'subcontractors' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="text-left rounded-xl">
            <Card className="p-4">
              <p className="text-xs text-gray-500">Subcontractors</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(totalsByCategory.subcontractors.budgeted)}</p>
            </Card>
          </div>
          <button type="button" onClick={() => setAssumptionsModalOpen(true)} className="text-left rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500">
            <Card className="p-4 hover:border-brand-300 cursor-pointer">
              <p className="text-xs text-gray-500">Subcontractor Recovery</p>
              <p className="text-xl font-bold text-brand-700">{overheadRecoveryAllocation.subcontractorsPercent.toFixed(1)}%</p>
              <p className="text-sm text-gray-600 mt-1">{formatCurrency(allocationAmounts.subcontractors)}</p>
              <p className="text-[11px] text-gray-400 mt-2">Click to edit</p>
            </Card>
          </button>
        </div>
      )}

      {activeTab === 'overhead' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="text-left rounded-xl">
            <Card className="p-4">
              <p className="text-xs text-gray-500">Overhead</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(totalsByCategory.overhead.budgeted)}</p>
            </Card>
          </div>
          <button type="button" onClick={() => setAssumptionsModalOpen(true)} className="text-left rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500">
            <Card className="p-4 hover:border-brand-300 cursor-pointer">
              <p className="text-xs text-gray-500">Overhead Recovery Total</p>
              <p className="text-xl font-bold text-brand-700">{formatCurrency(totalOverheadBudget)}</p>
              <p className="text-sm text-gray-600 mt-1">{allocationTotalPct.toFixed(1)}% allocated</p>
              <p className="text-[11px] text-gray-400 mt-2">Click to edit</p>
            </Card>
          </button>
        </div>
      )}

      {activeTab !== 'labour' && activeTab !== 'equipment' && (items.length === 0 ? (
        <EmptyState title={`No budget items for ${scopeLabel}`} />
      ) : activeTab === 'analysis' ? (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Category Analysis ({scopeLabel})</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Budgeted</th>
                  <th className="px-4 py-3 font-medium text-right">Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categoryAnalysisRows.map((row) => (
                  <tr key={row.category} className="hover:bg-gray-50">
                    <td className="px-4 py-2 capitalize">{row.category}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(row.budgeted)}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Budget Items ({scopeLabel})</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Cost Code</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium text-right">Budgeted</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((b) => {
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 capitalize">{b.category}</td>
                      <td className="px-4 py-2 text-gray-700">{b.costCode?.trim() ? b.costCode : '—'}</td>
                      <td className="px-4 py-2 text-gray-700">
                        <div className="flex items-center gap-2">
                          <span>{b.description}</span>
                          {b.category === 'equipment' && (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 capitalize">
                              {normalizeEquipmentCostType(b.equipmentCostType).replace('_', ' ')}
                            </span>
                          )}
                        </div>
                        {b.category === 'equipment' && (() => {
                          const allocationStatus = equipmentAllocationStatusByItemId[b.id];
                          const linkedAsset = b.equipmentId ? equipmentAssetsById[b.equipmentId] : undefined;
                          return (
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                              {linkedAsset && (
                                <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                                  Linked: {linkedAsset.name}
                                </span>
                              )}
                              {allocationStatus && (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${allocationStatus.isBalanced ? 'bg-brand-50 text-brand-700' : allocationStatus.isOverAllocated ? 'bg-accent-50 text-accent-700' : 'bg-gray-100 text-gray-700'}`}>
                                  {allocationStatus.isBalanced
                                    ? `Allocated ${allocationStatus.totalAllocatedPercent.toFixed(1)}% · Fully allocated`
                                    : allocationStatus.isOverAllocated
                                      ? `Allocated ${allocationStatus.totalAllocatedPercent.toFixed(1)}% · Over by ${allocationStatus.overAllocatedPercent.toFixed(1)}%`
                                      : `Allocated ${allocationStatus.totalAllocatedPercent.toFixed(1)}% · ${allocationStatus.unallocatedPercent.toFixed(1)}% unallocated`}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2 text-right">{formatCurrency(b.budgeted)}</td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(b)}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(b.id)}><Trash2 size={13} className="text-accent-700" /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {activeTab !== 'revenue' && (
            <div className="grid grid-cols-1 sm:grid-cols-1 gap-4">
              <Card className="p-4">
                <p className="text-xs text-gray-500">{formatBudgetTabLabel(activeTab)}</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(selectedCategoryTotals.budgeted)}</p>
              </Card>
            </div>
          )}

          {displayCategoryItems.length === 0 ? (
            <EmptyState title={`No ${activeTab} items for ${scopeLabel}`} />
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                    <th className="px-4 py-3 font-medium">Cost Code</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium text-right">Budgeted</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {displayCategoryItems.map((b) => {
                    return (
                      <tr key={b.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-700">{b.costCode?.trim() ? b.costCode : '—'}</td>
                        <td className="px-4 py-2 text-gray-700">
                          <div className="flex items-center gap-2">
                            <span>{b.description}</span>
                            {b.category === 'equipment' && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 capitalize">
                                  {normalizeEquipmentCostType(b.equipmentCostType).replace('_', ' ')}
                              </span>
                            )}
                          </div>
                          {b.category === 'equipment' && (() => {
                            const allocationStatus = equipmentAllocationStatusByItemId[b.id];
                            const linkedAsset = b.equipmentId ? equipmentAssetsById[b.equipmentId] : undefined;
                            return (
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                                {linkedAsset && (
                                  <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                                    Linked: {linkedAsset.name}
                                  </span>
                                )}
                                {allocationStatus && (
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${allocationStatus.isBalanced ? 'bg-brand-50 text-brand-700' : allocationStatus.isOverAllocated ? 'bg-accent-50 text-accent-700' : 'bg-gray-100 text-gray-700'}`}>
                                    {allocationStatus.isBalanced
                                      ? `Allocated ${allocationStatus.totalAllocatedPercent.toFixed(1)}% · Fully allocated`
                                      : allocationStatus.isOverAllocated
                                        ? `Allocated ${allocationStatus.totalAllocatedPercent.toFixed(1)}% · Over by ${allocationStatus.overAllocatedPercent.toFixed(1)}%`
                                        : `Allocated ${allocationStatus.totalAllocatedPercent.toFixed(1)}% · ${allocationStatus.unallocatedPercent.toFixed(1)}% unallocated`}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2 text-right">{formatCurrency(b.budgeted)}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(b)}><Pencil size={13} /></Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(b.id)}><Trash2 size={13} className="text-accent-700" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      ))}

      {/* Form modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Budget Item' : 'New Budget Item'}
        footer={<>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleSave()}>Save</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Category"
              value={form.category.charAt(0).toUpperCase() + form.category.slice(1)}
              disabled
            />
            <Input label="Year" value={year} disabled />
          </div>
          <Input label="Description *" required value={form.description} onChange={(e) => set('description', e.target.value)} />
          <Input
            label="Cost Code"
            value={form.costCode ?? ''}
            onChange={(e) => set('costCode', e.target.value)}
            placeholder="e.g. 06-200"
          />
          {form.category === 'equipment' && createCatalogEquipmentOnSave && !editing && (
            <fieldset className="border border-gray-200 rounded-lg p-3">
              <legend className="text-sm font-medium text-gray-700 px-1">Canonical Equipment Asset</legend>
              <p className="mb-3 text-xs text-gray-500">This machine record is saved to the company equipment catalog and linked to this budget row.</p>
              <EquipmentAssetForm
                value={canonicalEquipmentForm}
                onChange={(next) => {
                  setCanonicalEquipmentForm(next);
                  setForm((current) => ({
                    ...current,
                    description: current.description.trim() ? current.description : next.name,
                    equipmentCostType: next.costType,
                    costCode: current.costCode?.trim() ? current.costCode : next.serialNumber,
                  }));
                }}
              />
            </fieldset>
          )}
          {form.category === 'equipment' && (
            <div className="space-y-4">
              <Select
                label="Equipment Cost Type"
                value={form.equipmentCostType ?? 'financed'}
                onChange={(e) => set('equipmentCostType', e.target.value as EquipmentCostType)}
              >
                {EQUIPMENT_COST_TYPES.map((costType) => (
                  <option key={costType} value={costType}>{costType.charAt(0).toUpperCase() + costType.slice(1)}</option>
                ))}
              </Select>
              <fieldset className="border border-gray-200 rounded-lg p-3">
                <legend className="text-sm font-medium text-gray-700 px-1">Equipment Info</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">Payment</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                      <Input
                        type="number"
                        min={0}
                        value={form.equipmentPayment ?? 0}
                        className="pl-7"
                        onChange={(e) => set('equipmentPayment', Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <Input
                    label="Payment Frequency (# per year)"
                    type="number"
                    min={0}
                    value={form.equipmentPaymentFrequencyPerYear ?? 0}
                    onChange={(e) => set('equipmentPaymentFrequencyPerYear', Number(e.target.value))}
                  />
                  <div className="space-y-2 sm:col-span-2">
                    <p className="text-sm font-medium text-gray-700">Fuel Price Unit</p>
                    <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white">
                      {(['L', 'gal'] as const).map((unit) => (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => set('fuelPriceUnit', unit)}
                          className={`px-3 py-1 text-xs rounded ${
                            (form.fuelPriceUnit ?? 'L') === unit
                              ? 'bg-brand-600 text-white'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {unit}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">Fuel Price (/{form.fuelPriceUnit ?? 'L'})</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={averageFuelPriceInput}
                        className="pl-7"
                        onChange={(e) => {
                          setAverageFuelPriceInput(e.target.value);
                          set('averageFuelPrice', parseNumericInputValue(e.target.value));
                        }}
                      />
                    </div>
                  </div>
                  <Input
                    label={`Fuel Burned per Hour (${form.fuelPriceUnit ?? 'L'}/hr)`}
                    type="number"
                    min={0}
                    step={0.01}
                    value={averageFuelBurnPerHourInput}
                    onChange={(e) => {
                      setAverageFuelBurnPerHourInput(e.target.value);
                      set('averageFuelBurnPerHour', parseNumericInputValue(e.target.value));
                    }}
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">Fuel Cost per Hour</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={calculatedFuelCostPerHour}
                        className="pl-7"
                        disabled
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">Yearly Insurance Cost</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.yearlyInsuranceCost ?? 0}
                        className="pl-7"
                        onChange={(e) => set('yearlyInsuranceCost', Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">Yearly Maintenance Cost</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.yearlyMaintenanceCost ?? 0}
                        className="pl-7"
                        onChange={(e) => set('yearlyMaintenanceCost', Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:col-span-2">
                    <Input
                      label="Billable Hours per Year"
                      type="number"
                      min={0}
                      value={form.sellableHoursPerYear ?? 0}
                      onChange={(e) => set('sellableHoursPerYear', Number(e.target.value))}
                    />
                    <Input
                      label="Hours per Day"
                      type="number"
                      min={0}
                      step={0.25}
                      value={form.equipmentHoursPerDay ?? 0}
                      onChange={(e) => set('equipmentHoursPerDay', Number(e.target.value))}
                    />
                    <Input
                      label="Months Used per Year (Planning)"
                      type="number"
                      min={1}
                      max={12}
                      step={1}
                      value={form.monthsUsedPerYear ?? 12}
                      onChange={(e) => set('monthsUsedPerYear', Number(e.target.value))}
                    />
                    <Input
                      label="Cost Allocation % (Fixed Ownership)"
                      type="number"
                      min={0}
                      step={0.1}
                      value={form.equipmentCostAllocationPercent ?? 100}
                      onChange={(e) => set('equipmentCostAllocationPercent', Number(e.target.value))}
                    />
                  </div>
                  <p className="text-xs text-gray-500 sm:col-span-2">
                    Months Used per Year is operational planning context only. Fixed ownership allocation is calculated from Cost Allocation %.
                  </p>
                  {equipmentAllocationPreview && (
                    <div className={`sm:col-span-2 rounded-xl border p-3 ${equipmentAllocationPreview.isBalanced ? 'border-brand-100 bg-brand-50/50' : equipmentAllocationPreview.totalAllocatedPercent > 100 ? 'border-accent-200 bg-accent-50/60' : 'border-gray-200 bg-gray-50'}`}>
                      <p className="text-sm font-semibold text-gray-900">Allocated: {equipmentAllocationPreview.totalAllocatedPercent.toFixed(1)}%</p>
                      <p className={`mt-1 text-xs font-medium ${equipmentAllocationPreview.isBalanced ? 'text-brand-700' : equipmentAllocationPreview.totalAllocatedPercent > 100 ? 'text-accent-700' : 'text-gray-700'}`}>
                        {equipmentAllocationPreview.isBalanced
                          ? 'Fully allocated.'
                          : equipmentAllocationPreview.totalAllocatedPercent > 100
                            ? `Warning: Over-allocated by ${equipmentAllocationPreview.overAllocatedPercent.toFixed(1)}%.`
                            : `${equipmentAllocationPreview.unallocatedPercent.toFixed(1)}% Unallocated.`}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">Across active budgets in fiscal year {year}. Saving above 100% remains allowed.</p>
                    </div>
                  )}
                </div>
              </fieldset>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            {form.category === 'equipment' ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Total Equipment Cost per Year</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                  <Input
                    type="number"
                    min={0}
                    value={calculatedTotalEquipmentCostPerYear}
                    className="pl-7"
                    disabled
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Cost per Hour</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                      <Input type="number" min={0} step={0.01} value={calculatedTotalEquipmentCostPerHour} className="pl-7" disabled />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Cost per Day</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                      <Input type="number" min={0} step={0.01} value={calculatedTotalEquipmentCostPerDay} className="pl-7" disabled />
                    </div>
                  </div>
                </div>
                <div className="mt-1">
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    onClick={() => setShowEquipmentCalcDetails((value) => !value)}
                  >
                    {showEquipmentCalcDetails ? 'Hide calculation details' : 'Show calculation details'}
                  </button>
                </div>
                {showEquipmentCalcDetails && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
                    <p>
                      Annual Payments: {formatCurrency(normalizedEquipmentPayment)} x {formatNumericDisplayValue(normalizedEquipmentPaymentFrequencyPerYear)} = {formatCurrency(calculatedAnnualPaymentCost)}
                    </p>
                    <p>
                      Fixed Ownership Base: {formatCurrency(calculatedAnnualPaymentCost)} + {formatCurrency(calculatedAnnualInsuranceCost)} + {formatCurrency(calculatedAnnualMaintenanceCost)} = {formatCurrency(calculatedFixedOwnershipCostBasePerYear)}
                    </p>
                    <p>
                      Allocated Fixed Ownership: {formatCurrency(calculatedFixedOwnershipCostBasePerYear)} x {formatNumericDisplayValue(normalizedEquipmentCostAllocationPercent)}% = {formatCurrency(calculatedAllocatedFixedOwnershipCostPerYear)}
                    </p>
                    <p>
                      Variable Operating Cost: {formatCurrency(calculatedFuelCostPerHour)} x {formatNumericDisplayValue(normalizedBillableHoursPerYear)} hrs = {formatCurrency(calculatedAnnualFuelCost)}
                    </p>
                    <p>
                      Yearly Insurance: {formatCurrency(calculatedAnnualInsuranceCost)}
                    </p>
                    <p>
                      Yearly Maintenance: {formatCurrency(calculatedAnnualMaintenanceCost)}
                    </p>
                    <p className="pt-1 border-t border-gray-200 font-semibold text-gray-900">
                      Total Equipment Cost per Year: {formatCurrency(calculatedTotalEquipmentCostPerYear)}
                    </p>
                    <p>
                      Total Cost per Hour: {formatCurrency(calculatedTotalEquipmentCostPerHour)}
                    </p>
                    <p>
                      Total Cost per Day: {formatCurrency(calculatedTotalEquipmentCostPerDay)} ({formatNumericDisplayValue(normalizedEquipmentHoursPerDay)} hrs/day)
                    </p>
                    <p>
                      Planning Months (not used in allocation formula): {formatNumericDisplayValue(normalizedMonthsUsedPerYear)}
                    </p>
                  </div>
                )}
              </div>
            ) : form.category === 'overhead' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">Monthly Cost</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={overheadMonthlyCost}
                      className="pl-7"
                      onChange={(e) => set('budgeted', parseNumericInputValue(e.target.value) * 12)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">Yearly Cost</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.budgeted}
                      className="pl-7"
                      disabled
                    />
                  </div>
                </div>
              </div>
            ) : (
              <Input
                label="Budgeted ($)"
                type="number"
                min={0}
                value={form.budgeted}
                onChange={(e) => set('budgeted', Number(e.target.value))}
              />
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={mobileCatalogOpen}
        onClose={() => setMobileCatalogOpen(false)}
        title="Employee Catalog"
        footer={<Button variant="secondary" onClick={() => setMobileCatalogOpen(false)}>Close</Button>}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-gray-600">Add active employees to this labour plan.</p>
            <Button size="sm" onClick={() => setCreateEmployeeOpen(true)}><Plus size={13} /> New Employee</Button>
          </div>
          <Input
            value={employeeCatalogSearch}
            onChange={(event) => setEmployeeCatalogSearch(event.target.value)}
            placeholder="Search employees..."
          />
          {plannerEmployeeError && <p className="text-xs text-accent-700">{plannerEmployeeError}</p>}
          <div className="max-h-[65vh] overflow-y-auto space-y-2 pr-1">
            {activeEmployees.length === 0 ? (
              <p className="text-sm text-gray-500">No employees yet.</p>
            ) : filteredCatalogEmployees.length === 0 ? (
              <p className="text-sm text-gray-500">No employees match your search.</p>
            ) : (
              filteredCatalogEmployees.map((employee) => {
                const added = Boolean(plansByEmployeeId[employee.id]);
                return (
                  <div key={employee.id} className="rounded-lg border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-900 leading-tight">{employee.name}</p>
                    <p className="text-xs text-gray-500 mt-1">{toOptionLabel(employee.role ?? 'crew_member')}</p>
                    <div className="mt-2">
                      {added ? (
                        <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Added</span>
                      ) : (
                        <Button size="sm" onClick={() => void handleAddPlannerEmployee(employee.id)}><Plus size={12} /> Add</Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={mobileEquipmentCatalogOpen}
        onClose={() => setMobileEquipmentCatalogOpen(false)}
        title="Equipment Catalog"
        footer={<Button variant="secondary" onClick={() => setMobileEquipmentCatalogOpen(false)}>Close</Button>}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-gray-600">Add existing equipment to this budget.</p>
            <Button size="sm" onClick={() => openNewCategoryItem('equipment', { createCatalogAssetOnSave: true })}><Plus size={13} /> New Equipment</Button>
          </div>
          <Input
            value={equipmentCatalogSearch}
            onChange={(event) => setEquipmentCatalogSearch(event.target.value)}
            placeholder="Search equipment..."
          />
          {equipmentCatalogError && <p className="text-xs text-accent-700">{equipmentCatalogError}</p>}
          <div className="max-h-[65vh] overflow-y-auto space-y-2 pr-1">
            {sortedEquipmentAssets.filter((asset) => asset.status !== 'inactive').length === 0 ? (
              <div className="text-sm text-gray-500 p-2">
                <p>No equipment in your catalog yet.</p>
                <div className="mt-2">
                  <Button size="sm" onClick={() => openNewCategoryItem('equipment', { createCatalogAssetOnSave: true })}><Plus size={12} /> New Equipment</Button>
                </div>
              </div>
            ) : filteredCatalogEquipment.length === 0 && normalizedEquipmentCatalogSearch.length > 0 ? (
              <p className="text-sm text-gray-500 p-2">No equipment match your search.</p>
            ) : (
              <>
                {allAvailableEquipmentIncluded && normalizedEquipmentCatalogSearch.length === 0 && (
                  <p className="text-sm text-gray-500 p-2">All available equipment is included in this budget.</p>
                )}
                {filteredCatalogEquipment.map((asset) => {
                  const added = Boolean(equipmentBudgetItemByEquipmentId[asset.id]);
                  return (
                    <div key={asset.id} className="rounded-lg border border-gray-100 p-3 bg-white">
                      <p className="text-sm font-medium text-gray-900 leading-tight">{asset.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{[asset.type, asset.serialNumber].filter(Boolean).join(' • ') || 'Equipment'}</p>
                      <div className="mt-2">
                        {added ? (
                          <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Added</span>
                        ) : (
                          <Button size="sm" onClick={() => addEquipmentToCurrentBudget(asset.id)}><Plus size={12} /> Add</Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </Modal>

      <EmployeeCreateModal
        open={createEmployeeOpen}
        onClose={() => setCreateEmployeeOpen(false)}
      />

      <EmployeeEditModal open={Boolean(editEmployeeId)} employeeId={editEmployeeId} onClose={() => setEditEmployeeId(null)} />

      <Modal
        open={Boolean(removePlanId)}
        onClose={() => setRemovePlanId(null)}
        title="Remove from Budget"
        footer={<>
          <Button variant="secondary" onClick={() => setRemovePlanId(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!removePlanId) return;
              void deleteLabourBudgetPlan(removePlanId);
              setRemovePlanId(null);
            }}
          >
            Remove
          </Button>
        </>}
      >
        <p className="text-gray-600">This removes the employee row from this budget only. The employee record will not be deleted.</p>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={confirmDeleteItem?.category === 'equipment' ? 'Remove from Budget' : 'Delete Budget Item'}
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { deleteBudgetItem(confirmDelete!); setConfirmDelete(null); }}>{confirmDeleteItem?.category === 'equipment' ? 'Remove' : 'Delete'}</Button>
        </>}
      >
        <p className="text-gray-600">
          {confirmDeleteItem?.category === 'equipment'
            ? 'This removes the equipment from this budget only. The equipment record and other budget links are not deleted.'
            : 'Delete this budget item?'}
        </p>
      </Modal>

      <Modal
        open={ratesModalOpen}
        onClose={() => setRatesModalOpen(false)}
        title={editingRate ? 'Edit Budget Rate' : 'New Budget Rate'}
        footer={<>
          <Button variant="secondary" onClick={() => setRatesModalOpen(false)}>Cancel</Button>
          <Button onClick={saveRate}>Save Rate</Button>
        </>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Category" value={rateForm.category} onChange={(e) => setRateForm((previous) => ({ ...previous, category: e.target.value as BudgetRate['category'] }))}>
              {RATE_CATEGORIES.map((category) => <option key={category} value={category}>{toOptionLabel(category)}</option>)}
            </Select>
            <Input label="Item Name" required value={rateForm.itemName} onChange={(e) => setRateForm((previous) => ({ ...previous, itemName: e.target.value }))} />
          </div>
          <TextArea label="Description" value={rateForm.description} onChange={(e) => setRateForm((previous) => ({ ...previous, description: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Unit" required value={rateForm.unit} onChange={(e) => setRateForm((previous) => ({ ...previous, unit: e.target.value }))} />
            <Input label="Sort Order" type="number" min={0} value={rateForm.sortOrder} onChange={(e) => setRateForm((previous) => ({ ...previous, sortOrder: Number(e.target.value) }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Unit Cost" type="number" min={0} value={rateForm.unitCost} onChange={(e) => setRateForm((previous) => ({ ...previous, unitCost: Number(e.target.value) }))} />
            <Input label="Default Markup %" type="number" min={0} value={rateForm.defaultMarkupPercent} onChange={(e) => setRateForm((previous) => ({ ...previous, defaultMarkupPercent: Number(e.target.value) }))} />
            <Input label="Default Sell Price" type="number" min={0} value={rateForm.defaultSellPrice} onChange={(e) => setRateForm((previous) => ({ ...previous, defaultSellPrice: Number(e.target.value) }))} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={rateForm.active} onChange={(e) => setRateForm((previous) => ({ ...previous, active: e.target.checked }))} />
            Active
          </label>
        </div>
      </Modal>

      <Modal
        open={!!confirmDeleteRate}
        onClose={() => setConfirmDeleteRate(null)}
        title="Delete Budget Rate"
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDeleteRate(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { deleteBudgetRate(confirmDeleteRate!); setConfirmDeleteRate(null); }}>Delete</Button>
        </>}
      >
        <p className="text-gray-600">Delete this pricing rate?</p>
      </Modal>

      <Modal
        open={assumptionsModalOpen}
        onClose={() => setAssumptionsModalOpen(false)}
        title="Edit Pricing Assumptions"
        footer={<>
          <Button variant="secondary" onClick={() => setAssumptionsModalOpen(false)}>Close</Button>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Payroll Burden (%)"
            type="number"
            min={0}
            value={pricingInputs.payrollBurdenPct}
            onChange={(e) => updatePricingInput('payrollBurdenPct', Number(e.target.value))}
          />
          <Input
            label="Target Margin (%)"
            type="number"
            min={0}
            max={95}
            value={pricingInputs.targetMarginPct}
            onChange={(e) => updatePricingInput('targetMarginPct', Number(e.target.value))}
          />
          <Input
            label="Machine Utilization (hrs/year)"
            type="number"
            min={1}
            value={pricingInputs.equipmentUtilizationHours}
            onChange={(e) => updatePricingInput('equipmentUtilizationHours', Number(e.target.value))}
          />
        </div>
      </Modal>

    </div>
  );
}



