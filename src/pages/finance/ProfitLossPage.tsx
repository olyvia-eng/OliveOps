import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDown, FilterX, Wallet } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Button, Card, EmptyState, PageHeader, Select } from '../../components/ui';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import type { Budget, BudgetCategory, BudgetItem } from '../../types';

const CATEGORIES: BudgetCategory[] = ['revenue', 'labour', 'materials', 'equipment', 'subcontractors', 'overhead', 'marketing', 'insurance', 'other'];
const currentYear = () => new Date().toISOString().slice(0, 4);

type ExportColumnMode = 'budgeted';

export default function ProfitLossPage() {
  const navigate = useNavigate();
  const { budgets, budgetItems } = useStore();
  const [selectedBudgetId, setSelectedBudgetId] = useState('');
  const [year, setYear] = useState(currentYear());

  const sortedBudgets = useMemo(() => {
    return budgets
      .slice()
      .sort((a: Budget, b: Budget) => b.updatedAt.localeCompare(a.updatedAt));
  }, [budgets]);

  useEffect(() => {
    if (!selectedBudgetId && sortedBudgets.length > 0) {
      setSelectedBudgetId(sortedBudgets[0].id);
    }
  }, [selectedBudgetId, sortedBudgets]);

  const selectedBudget = selectedBudgetId
    ? (budgets.find((budget) => budget.id === selectedBudgetId) ?? null)
    : null;

  const legacyOwnerBudgetId = useMemo(() => {
    if (budgets.length === 0) return null;
    const oldestBudget = budgets
      .slice()
      .sort((a: Budget, b: Budget) => (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt))[0];
    return oldestBudget?.id ?? null;
  }, [budgets]);

  const hasAnyScopedBudgetData = useMemo(() => budgetItems.some((item) => Boolean(item.budgetId)), [budgetItems]);
  const includeLegacyUnscopedData = Boolean(selectedBudgetId)
    && !hasAnyScopedBudgetData
    && selectedBudgetId === legacyOwnerBudgetId;

  const scopedBudgetItems = useMemo(() => {
    if (!selectedBudgetId) return [];
    return budgetItems.filter((item) => item.budgetId === selectedBudgetId || (includeLegacyUnscopedData && !item.budgetId));
  }, [budgetItems, includeLegacyUnscopedData, selectedBudgetId]);

  const allYears = useMemo(() => {
    const years = [...new Set(scopedBudgetItems.map((item) => item.period.slice(0, 4)))].sort().reverse();
    return years.length > 0 ? years : [currentYear()];
  }, [scopedBudgetItems]);

  useEffect(() => {
    if (!allYears.includes(year)) {
      setYear(allYears[0]);
    }
  }, [allYears, year]);

  const items = useMemo(() => {
    return scopedBudgetItems.filter((item) => item.period.startsWith(`${year}-`));
  }, [scopedBudgetItems, year]);
  const hasCompanyBudgetData = scopedBudgetItems.length > 0;

  const grouped = useMemo(() => {
    return CATEGORIES.reduce<Record<BudgetCategory, BudgetItem[]>>((acc, category) => {
      acc[category] = items.filter((item) => item.category === category);
      return acc;
    }, {} as Record<BudgetCategory, BudgetItem[]>);
  }, [items]);

  const directCostCategories: BudgetCategory[] = ['labour', 'materials', 'equipment', 'subcontractors'];
  const operatingExpenseCategories: BudgetCategory[] = ['overhead', 'marketing', 'insurance', 'other'];

  const revenueItems = items.filter((item) => item.category === 'revenue');
  const directCostItems = items.filter((item) => directCostCategories.includes(item.category));
  const operatingExpenseItems = items.filter((item) => operatingExpenseCategories.includes(item.category));

  const totalBudgetedRevenue = revenueItems.reduce((sum, item) => sum + item.budgeted, 0);
  const budgetedDirectCosts = directCostItems.reduce((sum, item) => sum + item.budgeted, 0);
  const budgetedOperatingExpenses = operatingExpenseItems.reduce((sum, item) => sum + item.budgeted, 0);

  const budgetedGrossProfit = totalBudgetedRevenue - budgetedDirectCosts;
  const budgetedNetProfit = budgetedGrossProfit - budgetedOperatingExpenses;

  const budgetedGrossMarginPct = totalBudgetedRevenue > 0 ? (budgetedGrossProfit / totalBudgetedRevenue) * 100 : 0;
  const budgetedNetMarginPct = totalBudgetedRevenue > 0 ? (budgetedNetProfit / totalBudgetedRevenue) * 100 : 0;

  const exportMetricHeaders = () => ['Budgeted'];
  const exportMetricCells = (budgeted: number) => [formatCurrency(budgeted)];
  const exportMarginCells = (budgetedPct: number) => [`${budgetedPct.toFixed(1)}%`];

  const exportProfitAndLossPdf = (condensed = false, mode: ExportColumnMode = 'budgeted') => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const scopeTypeLabel = 'Yearly';
    const generatedAt = new Date().toLocaleString();

    doc.setFontSize(16);
    doc.text(`OliveOps Profit & Loss Statement${condensed ? ' (1-Page)' : ''}`, 40, 42);
    doc.setFontSize(10);
    doc.text(`Budget: ${selectedBudget?.name ?? 'Unknown'}`, 40, 60);
    doc.text(`Scope: ${scopeTypeLabel} (${year})`, 40, 74);
    doc.text(`Generated: ${generatedAt}`, 40, 88);

    autoTable(doc, {
      startY: 106,
      head: [['P&L Summary', ...exportMetricHeaders()]],
      body: [
        ['Revenue', ...exportMetricCells(totalBudgetedRevenue)],
        ['Direct Costs (Labour + Materials + Equipment + Subcontractors)', ...exportMetricCells(budgetedDirectCosts)],
        ['Gross Profit', ...exportMetricCells(budgetedGrossProfit)],
        ['Operating Expenses', ...exportMetricCells(budgetedOperatingExpenses)],
        ['Net Profit', ...exportMetricCells(budgetedNetProfit)],
      ],
      styles: { fontSize: 9 },
    });

    autoTable(doc, {
      startY: 246,
      head: [['Margin Analysis', ...exportMetricHeaders()]],
      body: [
        ['Gross Margin %', ...exportMarginCells(budgetedGrossMarginPct)],
        ['Net Margin %', ...exportMarginCells(budgetedNetMarginPct)],
      ],
      styles: { fontSize: 9 },
    });

    if (condensed) {
      autoTable(doc, {
        startY: 328,
        head: [['Cost Category Snapshot', ...exportMetricHeaders()]],
        body: [
          ['Labour', ...exportMetricCells(grouped.labour.reduce((sum, item) => sum + item.budgeted, 0))],
          ['Materials', ...exportMetricCells(grouped.materials.reduce((sum, item) => sum + item.budgeted, 0))],
          ['Equipment', ...exportMetricCells(grouped.equipment.reduce((sum, item) => sum + item.budgeted, 0))],
          ['Subcontractors', ...exportMetricCells(grouped.subcontractors.reduce((sum, item) => sum + item.budgeted, 0))],
          ['Overhead', ...exportMetricCells(grouped.overhead.reduce((sum, item) => sum + item.budgeted, 0))],
        ],
        styles: { fontSize: 9 },
      });

      doc.save(`profit-loss-${scopeTypeLabel.toLowerCase()}-${year}-1-page-${mode}.pdf`);
      return;
    }

    autoTable(doc, {
      startY: 328,
      head: [['Cost Code', 'Revenue Description', ...exportMetricHeaders()]],
      body: revenueItems.map((item) => [
        item.costCode ?? '—',
        item.description,
        ...exportMetricCells(item.budgeted),
      ]),
      styles: { fontSize: 8 },
    });

    const cogsStartY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY
      ? ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 328) + 16
      : 444;

    autoTable(doc, {
      startY: cogsStartY,
      head: [['Cost Code', 'Direct Cost Description', 'Category', ...exportMetricHeaders()]],
      body: directCostItems.map((item) => [
        item.costCode ?? '—',
        item.description,
        item.category.replace(/_/g, ' '),
        ...exportMetricCells(item.budgeted),
      ]),
      styles: { fontSize: 8 },
    });

    const opexStartY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY
      ? ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cogsStartY) + 16
      : cogsStartY + 120;

    autoTable(doc, {
      startY: opexStartY,
      head: [['Cost Code', 'Operating Expense Description', 'Category', ...exportMetricHeaders()]],
      body: operatingExpenseItems.map((item) => [
        item.costCode ?? '—',
        item.description,
        item.category.replace(/_/g, ' '),
        ...exportMetricCells(item.budgeted),
      ]),
      styles: { fontSize: 8 },
    });

    doc.save(`profit-loss-${scopeTypeLabel.toLowerCase()}-${year}-${mode}.pdf`);
  };

  if (sortedBudgets.length === 0) {
    return (
      <div>
        <PageHeader
          title="Profit & Loss"
          subtitle="Export contractor-friendly P&L statements by budget and year."
          action={<Button onClick={() => navigate('/budgets')}>View Budgets</Button>}
        />
        <EmptyState
          icon={<Wallet aria-hidden="true" />}
          title="No budgets yet"
          description="Create a budget first, then return here to export Profit & Loss reports."
          action={<Button onClick={() => navigate('/budgets')}>Go to Budgets</Button>}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Profit & Loss"
        subtitle="Are we profitable this period, and what is driving the result?"
        action={(
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => exportProfitAndLossPdf(true)}>
              <FileDown size={16} /> Export P&L 1-Page
            </Button>
            <Button variant="secondary" onClick={() => exportProfitAndLossPdf(false)}>
              <FileDown size={16} /> Export P&L PDF
            </Button>
          </div>
        )}
      />

      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Budget" value={selectedBudgetId} onChange={(e) => setSelectedBudgetId(e.target.value)}>
            {sortedBudgets.map((budget) => (
              <option key={budget.id} value={budget.id}>{budget.name}</option>
            ))}
          </Select>
          <Select label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
            {allYears.map((optionYear) => (
              <option key={optionYear} value={optionYear}>{optionYear}</option>
            ))}
          </Select>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-xl font-bold text-brand-700">{formatCurrency(totalBudgetedRevenue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Direct Costs</p>
          <p className="text-xl font-bold text-accent-700">{formatCurrency(budgetedDirectCosts)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Gross Profit</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(budgetedGrossProfit)}</p>
          <p className="text-xs text-gray-500 mt-1">{budgetedGrossMarginPct.toFixed(1)}% margin</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Operating Expenses</p>
          <p className="text-xl font-bold text-accent-700">{formatCurrency(budgetedOperatingExpenses)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Net Profit</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(budgetedNetProfit)}</p>
          <p className="text-xs text-gray-500 mt-1">{budgetedNetMarginPct.toFixed(1)}% margin</p>
        </Card>
      </div>

      {items.length === 0 && (
        <EmptyState
          icon={hasCompanyBudgetData ? <FilterX aria-hidden="true" /> : <Wallet aria-hidden="true" />}
          title={hasCompanyBudgetData ? `No data for ${year}` : 'Not enough data yet'}
          description={hasCompanyBudgetData
            ? 'This Profit & Loss report will populate after budget items are added for the selected year.'
            : 'This report will populate as budget items and operating data are created.'}
          action={<Button onClick={() => navigate(selectedBudgetId ? `/budgets/${selectedBudgetId}` : '/budgets')}>{hasCompanyBudgetData ? 'Open Budget' : 'Set Up Budget'}</Button>}
        />
      )}
    </div>
  );
}
