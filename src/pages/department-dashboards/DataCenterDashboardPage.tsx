import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BriefcaseBusiness,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  HardHat,
  Receipt,
  TrendingUp,
  Truck,
  Users,
  WalletCards,
  Wrench,
} from 'lucide-react';
import { Card, Input, PageHeader, Select, StatCard } from '../../components/ui';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import { formatTimeEntryDuration, getTimeEntryWorkLabel, sortTimeEntriesNewestFirst } from '../../utils/timeEntryPresentation.js';
import { customerStatusLabel } from '../../config/customer.js';
import {
  filterDataCenterRecords,
  getDataCenterDateRange,
  getEstimateValue,
  getTimeEntryHours,
  isInDataCenterDateRange,
  type DataCenterDatePreset,
  type FilteredDataCenterRecords,
} from './dataCenterDashboardModel';

const DASHBOARD_TABS = ['overview', 'sales', 'jobs', 'labour', 'equipment', 'financial', 'customers'] as const;
type DashboardTab = typeof DASHBOARD_TABS[number];
const REPORT_CATEGORIES = ['overview', 'sales-jobs', 'operations', 'financial'] as const;
type ReportCategory = typeof REPORT_CATEGORIES[number];

const CATEGORY_DEFAULT_TAB: Record<ReportCategory, DashboardTab> = {
  overview: 'overview',
  'sales-jobs': 'sales',
  operations: 'labour',
  financial: 'financial',
};

const categoryForTab = (tab: DashboardTab): ReportCategory => {
  if (tab === 'sales' || tab === 'jobs' || tab === 'customers') return 'sales-jobs';
  if (tab === 'labour' || tab === 'equipment') return 'operations';
  return tab;
};

const DATE_OPTIONS: Array<{ id: DataCenterDatePreset; label: string }> = [
  { id: 'month', label: 'This Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'ytd', label: 'YTD' },
  { id: 'last_year', label: 'Last Year' },
  { id: 'custom', label: 'Custom' },
];

const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const sum = <T,>(items: T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0);
const percent = (value: number, total: number) => total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';
const formatHours = (value: number) => `${value.toFixed(1)}h`;

interface Metric {
  label: string;
  value: string | number;
  sub: string;
  icon: ReactNode;
  color?: string;
}

interface BreakdownItem {
  label: string;
  value: number;
  display?: string;
  colour?: string;
}

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => <StatCard key={metric.label} {...metric} />)}
    </div>
  );
}

function Breakdown({ title, subtitle, items, emptyText }: { title: string; subtitle: string; items: BreakdownItem[]; emptyText: string }) {
  const maximum = Math.max(...items.map((item) => item.value), 0);
  return (
    <Card className="rounded-lg p-5">
      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">{title}</h2>
      <p className="mt-1 text-xs text-brand-400 dark:text-brand-200">{subtitle}</p>
      {items.length === 0 || maximum === 0 ? <p className="py-10 text-center text-sm text-brand-400 dark:text-brand-300">{emptyText}</p> : (
        <div className="mt-5 space-y-4">
          {items.map((item) => (
            <div key={item.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-brand-800 dark:text-brand-100">{item.label}</span>
                <span className="tabular-nums text-brand-500 dark:text-brand-200">{item.display ?? item.value.toLocaleString()}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-brand-50 dark:bg-brand-600">
                <div className={`h-full rounded-full ${item.colour ?? 'bg-accent-500'}`} style={{ width: `${Math.max(3, (item.value / maximum) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecordList({ title, subtitle, rows, emptyText }: { title: string; subtitle: string; rows: Array<{ id: string; title: string; meta: string; value?: string }>; emptyText: string }) {
  return (
    <Card className="rounded-lg overflow-hidden">
      <div className="border-b border-brand-100 px-5 py-4 dark:border-brand-600">
        <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">{title}</h2>
        <p className="mt-1 text-xs text-brand-400 dark:text-brand-200">{subtitle}</p>
      </div>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-brand-400 dark:text-brand-300">{emptyText}</p> : (
        <div className="divide-y divide-brand-50 dark:divide-brand-600">
          {rows.slice(0, 7).map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-900 dark:text-brand-50">{row.title}</p>
                <p className="mt-0.5 truncate text-xs text-brand-400 dark:text-brand-300">{row.meta}</p>
              </div>
              {row.value ? <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-100">{row.value}</span> : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function FinancialSummary({ invoiced, collected, expenses }: { invoiced: number; collected: number; expenses: number }) {
  const rows = [
    { label: 'Invoiced', value: formatCurrency(invoiced) },
    { label: 'Collected', value: formatCurrency(collected) },
    { label: 'Recorded expenses', value: formatCurrency(expenses) },
    { label: 'Collection rate', value: percent(collected, invoiced) },
  ];
  return <Card className="rounded-lg p-5"><h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Period financials</h2><p className="mt-1 text-xs text-brand-400 dark:text-brand-200">Recorded activity for the selected reporting period.</p><dl className="mt-4 divide-y divide-brand-50 dark:divide-brand-600">{rows.map((row) => <div key={row.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><dt className="text-sm text-brand-500 dark:text-brand-200">{row.label}</dt><dd className="font-semibold tabular-nums text-brand-900 dark:text-brand-50">{row.value}</dd></div>)}</dl></Card>;
}

function DashboardContent({ activeTab, records, range }: { activeTab: DashboardTab; records: FilteredDataCenterRecords; range: { start: Date; end: Date } }) {
  const invoiceValue = sum(records.invoices, (invoice) => invoice.amount);
  const paidInvoices = records.invoices.filter((invoice) => invoice.status === 'paid');
  const paidValue = sum(paidInvoices, (invoice) => invoice.amount);
  const outstandingValue = invoiceValue - paidValue;
  const expenseValue = sum(records.expenses, (expense) => expense.amount);
  const estimateValue = sum(records.estimates, getEstimateValue);
  const labourHours = sum(records.timeEntries, (entry) => getTimeEntryHours(entry, range));
  const completedJobs = records.jobs.filter((job) => job.status === 'completed');
  const activeJobs = records.jobs.filter((job) => job.status === 'scheduled' || job.status === 'in_progress' || job.status === 'on_hold');
  const customerById = new Map(records.customers.map((customer) => [customer.id, customer]));
  const employeeById = new Map(records.employees.map((employee) => [employee.id, employee]));

  if (activeTab === 'sales') {
    const statusItems = ['draft', 'sent', 'accepted', 'converted', 'declined'].map((status) => ({ label: titleCase(status), value: records.estimates.filter((estimate) => estimate.status === status).length }));
    const decided = records.estimates.filter((estimate) => estimate.status === 'accepted' || estimate.status === 'converted' || estimate.status === 'declined');
    const won = decided.filter((estimate) => estimate.status === 'accepted' || estimate.status === 'converted');
    return <>
      <MetricGrid metrics={[
        { label: 'Estimate Value', value: formatCurrency(estimateValue), sub: `${records.estimates.length} estimates created`, icon: <FileText /> },
        { label: 'Open Pipeline', value: formatCurrency(sum(records.estimates.filter((estimate) => estimate.status === 'draft' || estimate.status === 'sent'), getEstimateValue)), sub: 'Draft and sent estimates', icon: <TrendingUp /> },
        { label: 'Win Rate', value: percent(won.length, decided.length), sub: `${won.length} of ${decided.length} decided`, icon: <FileCheck2 /> },
        { label: 'Average Estimate', value: formatCurrency(records.estimates.length ? estimateValue / records.estimates.length : 0), sub: 'Average opportunity size', icon: <CircleDollarSign /> },
      ]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Breakdown title="Pipeline by stage" subtitle="Estimate volume moving through sales" items={statusItems} emptyText="No estimates in this period." />
        <RecordList title="Latest estimates" subtitle="Most recently updated opportunities" emptyText="No estimate activity in this period." rows={[...records.estimates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((estimate) => ({ id: estimate.id, title: estimate.title, meta: `${titleCase(estimate.status)} · ${customerById.get(estimate.customerId)?.name ?? 'Customer'}`, value: formatCurrency(getEstimateValue(estimate)) }))} />
      </div>
    </>;
  }

  if (activeTab === 'jobs') {
    const contractValue = sum(records.jobs, (job) => job.contractValue);
    const completedActualCost = sum(completedJobs, (job) => sum(job.actualCosts ?? [], (cost) => cost.total));
    return <>
      <MetricGrid metrics={[
        { label: 'Active Jobs', value: activeJobs.length, sub: `${records.jobs.filter((job) => job.status === 'in_progress').length} in progress`, icon: <HardHat /> },
        { label: 'Completed', value: completedJobs.length, sub: 'Completed in selected period', icon: <FileCheck2 /> },
        { label: 'Contract Value', value: formatCurrency(contractValue), sub: `${records.jobs.length} jobs in view`, icon: <WalletCards /> },
        { label: 'Realized Margin', value: formatCurrency(sum(completedJobs, (job) => job.contractValue) - completedActualCost), sub: `${formatCurrency(completedActualCost)} completed job cost`, icon: <TrendingUp /> },
      ]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Breakdown title="Jobs by status" subtitle="Current flow of work in the selected period" items={['scheduled', 'in_progress', 'on_hold', 'completed'].map((status) => ({ label: titleCase(status), value: records.jobs.filter((job) => job.status === status).length }))} emptyText="No jobs in this period." />
        <RecordList title="Jobs requiring attention" subtitle="Active work, ordered by start date" emptyText="No active jobs in this period." rows={[...activeJobs].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((job) => ({ id: job.id, title: job.title, meta: `${titleCase(job.status)} · ${job.startDate}`, value: formatCurrency(job.contractValue) }))} />
      </div>
    </>;
  }

  if (activeTab === 'labour') {
    const jobHours = sum(records.timeEntries.filter((entry) => entry.workType === 'job'), (entry) => getTimeEntryHours(entry, range));
    const driveHours = sum(records.timeEntries.filter((entry) => entry.workType === 'drive_time'), (entry) => getTimeEntryHours(entry, range));
    const nonBillableHours = sum(records.timeEntries.filter((entry) => entry.workType === 'non_billable'), (entry) => getTimeEntryHours(entry, range));
    const hoursByEmployee = records.employees.map((employee) => ({ label: employee.name, value: sum(records.timeEntries.filter((entry) => entry.employeeId === employee.id), (entry) => getTimeEntryHours(entry, range)) })).sort((a, b) => b.value - a.value);
    return <>
      <MetricGrid metrics={[
        { label: 'Hours Logged', value: formatHours(labourHours), sub: `${records.timeEntries.length} time entries`, icon: <Clock3 /> },
        { label: 'Job Time', value: formatHours(jobHours), sub: `${percent(jobHours, labourHours)} of recorded hours`, icon: <BriefcaseBusiness /> },
        { label: 'Drive Time', value: formatHours(driveHours), sub: `${percent(driveHours, labourHours)} of recorded hours`, icon: <Truck /> },
        { label: 'Non-billable', value: formatHours(nonBillableHours), sub: `${percent(nonBillableHours, labourHours)} of recorded hours`, icon: <Users /> },
      ]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Breakdown title="Hours by employee" subtitle="Who contributed time in this period" items={hoursByEmployee.map((item) => ({ ...item, display: formatHours(item.value) }))} emptyText="No labour hours in this period." />
        <RecordList title="Recent time activity" subtitle={`${records.employees.length} employees active in this view`} emptyText="No time entries in this period." rows={sortTimeEntriesNewestFirst(records.timeEntries).map((entry) => ({ id: entry.id, title: employeeById.get(entry.employeeId)?.name ?? 'Employee', meta: `${getTimeEntryWorkLabel(entry, records.jobs)} · ${new Date(entry.clockIn).toLocaleDateString('en-CA')}`, value: formatTimeEntryDuration(getTimeEntryHours(entry, range)) }))} />
      </div>
    </>;
  }

  if (activeTab === 'equipment') {
    const hourlyCost = sum(records.equipmentAssets, (asset) => asset.hourlyCost);
    return <>
      <MetricGrid metrics={[
        { label: 'Equipment Assigned', value: records.equipmentAssets.length, sub: 'Supporting jobs in this view', icon: <Truck /> },
        { label: 'In Use', value: records.equipmentAssets.filter((asset) => asset.status === 'in_use').length, sub: 'Currently marked in use', icon: <HardHat /> },
        { label: 'Maintenance', value: records.equipmentAssets.filter((asset) => asset.status === 'maintenance').length, sub: 'Needs service attention', icon: <Wrench />, color: 'text-accent-700' },
        { label: 'Combined Hourly Cost', value: formatCurrency(hourlyCost), sub: 'Assigned fleet operating cost', icon: <CircleDollarSign /> },
      ]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Breakdown title="Assigned equipment by status" subtitle="Fleet supporting jobs in the selected view" items={['available', 'in_use', 'maintenance', 'inactive'].map((status) => ({ label: titleCase(status), value: records.equipmentAssets.filter((asset) => asset.status === status).length }))} emptyText="No equipment is assigned to jobs in this period." />
        <RecordList title="Equipment in view" subtitle="Assigned fleet and current condition" emptyText="No assigned equipment in this period." rows={records.equipmentAssets.map((asset) => ({ id: asset.id, title: asset.name, meta: `${asset.type} · ${titleCase(asset.status)}`, value: `${formatCurrency(asset.hourlyCost)}/hr` }))} />
      </div>
    </>;
  }

  if (activeTab === 'financial') {
    return <>
      <MetricGrid metrics={[
        { label: 'Invoiced', value: formatCurrency(invoiceValue), sub: `${records.invoices.length} invoices issued`, icon: <Receipt /> },
        { label: 'Collected', value: formatCurrency(paidValue), sub: `${percent(paidValue, invoiceValue)} of invoiced value`, icon: <CircleDollarSign /> },
        { label: 'Outstanding', value: formatCurrency(outstandingValue), sub: `${records.invoices.filter((invoice) => invoice.status !== 'paid').length} open invoices`, icon: <WalletCards />, color: outstandingValue > 0 ? 'text-accent-700' : 'text-brand-700' },
        { label: 'Recorded Expenses', value: formatCurrency(expenseValue), sub: `${records.expenses.length} expense records`, icon: <FileText /> },
      ]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Breakdown title="Invoice value by status" subtitle="Where issued revenue currently stands" items={['draft', 'sent', 'overdue', 'paid'].map((status) => { const value = sum(records.invoices.filter((invoice) => invoice.status === status), (invoice) => invoice.amount); return { label: titleCase(status), value, display: formatCurrency(value) }; })} emptyText="No invoices in this period." />
        <RecordList title="Open invoices" subtitle="Outstanding receivables ordered by due date" emptyText="No outstanding invoices in this period." rows={records.invoices.filter((invoice) => invoice.status !== 'paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((invoice) => ({ id: invoice.id, title: `Invoice ${invoice.number}`, meta: `${titleCase(invoice.status)} · due ${invoice.dueDate}`, value: formatCurrency(invoice.amount) }))} />
      </div>
    </>;
  }

  if (activeTab === 'customers') {
    const newCustomers = records.customers.filter((customer) => isInDataCenterDateRange(customer.createdAt, range));
    const customerRevenue = records.customers.map((customer) => ({ label: customer.name || customer.company || 'Unnamed customer', value: sum(records.invoices.filter((invoice) => invoice.customerId === customer.id), (invoice) => invoice.amount) })).sort((a, b) => b.value - a.value);
    return <>
      <MetricGrid metrics={[
        { label: 'Customers Active', value: records.customers.length, sub: 'With activity in this view', icon: <Users /> },
        { label: 'New Customers', value: newCustomers.length, sub: 'Created during this period', icon: <Users /> },
        { label: 'Revenue per Customer', value: formatCurrency(records.customers.length ? invoiceValue / records.customers.length : 0), sub: 'Average invoiced value', icon: <CircleDollarSign /> },
        { label: 'Customers with Jobs', value: new Set(records.jobs.map((job) => job.customerId)).size, sub: `${records.jobs.length} jobs in view`, icon: <BriefcaseBusiness /> },
      ]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Breakdown title="Revenue by customer" subtitle="Invoiced value in the selected period" items={customerRevenue.slice(0, 7).map((item) => ({ ...item, display: formatCurrency(item.value) }))} emptyText="No customer revenue in this period." />
        <RecordList title="Customers in view" subtitle="Customers with sales or job activity" emptyText="No customer activity in this period." rows={records.customers.map((customer) => ({ id: customer.id, title: customer.name || customer.company || 'Unnamed customer', meta: `${customerStatusLabel(customer.status)} · ${customer.email || 'No email'}`, value: `${records.jobs.filter((job) => job.customerId === customer.id).length} jobs` }))} />
      </div>
    </>;
  }

  return <>
    <MetricGrid metrics={[
      { label: 'Sales Pipeline', value: formatCurrency(estimateValue), sub: `${records.estimates.length} estimates created`, icon: <TrendingUp /> },
      { label: 'Active Jobs', value: activeJobs.length, sub: `${completedJobs.length} completed in period`, icon: <HardHat /> },
      { label: 'Labour Logged', value: formatHours(labourHours), sub: `${records.employees.length} employees active`, icon: <Clock3 /> },
      { label: 'Outstanding', value: formatCurrency(outstandingValue), sub: `${records.invoices.filter((invoice) => invoice.status !== 'paid').length} open invoices`, icon: <Receipt />, color: outstandingValue > 0 ? 'text-accent-700' : 'text-brand-700' },
    ]} />
    <div className="grid gap-4 xl:grid-cols-2">
      <FinancialSummary invoiced={invoiceValue} collected={paidValue} expenses={expenseValue} />
      <RecordList title="Work in motion" subtitle="Current jobs ordered by start date" emptyText="No active jobs in this period." rows={[...activeJobs].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((job) => ({ id: job.id, title: job.title, meta: `${titleCase(job.status)} · ${customerById.get(job.customerId)?.name ?? 'Customer'}`, value: formatCurrency(job.contractValue) }))} />
    </div>
  </>;
}

export default function DataCenterDashboardPage() {
  const { divisions, budgets, customers, estimates, jobs, invoices, expenses, employees, timeEntries, equipmentAssets } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DashboardTab | null;
  const rangeParam = searchParams.get('range') as DataCenterDatePreset | null;
  const activeTab = tabParam && DASHBOARD_TABS.includes(tabParam) ? tabParam : 'overview';
  const activeCategory = categoryForTab(activeTab);
  const datePreset = rangeParam && DATE_OPTIONS.some((option) => option.id === rangeParam) ? rangeParam : 'month';
  const divisionId = searchParams.get('division') || 'all';
  const customStart = searchParams.get('start') || '';
  const customEnd = searchParams.get('end') || '';
  const range = useMemo(() => getDataCenterDateRange(datePreset, new Date(), customStart, customEnd), [customEnd, customStart, datePreset]);
  const records = useMemo(() => filterDataCenterRecords({ divisionId, range, divisions, budgets, customers, estimates, jobs, invoices, expenses, employees, timeEntries, equipmentAssets }), [budgets, customers, divisionId, divisions, employees, equipmentAssets, estimates, expenses, invoices, jobs, range, timeEntries]);
  const activeDivision = divisions.find((division) => division.id === divisionId);
  const rangeEnd = new Date(range.end.getTime() - 1);
  const dateLabel = `${range.start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} – ${rangeEnd.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const [customRangeOpen, setCustomRangeOpen] = useState(datePreset === 'custom');

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all' || (key === 'tab' && value === 'overview') || (key === 'range' && value === 'month')) next.delete(key);
    else next.set(key, value);
    if (key === 'range' && value !== 'custom') {
      next.delete('start');
      next.delete('end');
    }
    setSearchParams(next, { replace: true });
  };

  const selectDatePreset = (value: DataCenterDatePreset) => {
    updateFilter('range', value);
    setCustomRangeOpen(value === 'custom');
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Business performance and reporting." />

      <div className="relative flex flex-wrap items-center gap-2">
        <Select aria-label="Reporting period" value={datePreset} onChange={(event) => selectDatePreset(event.target.value as DataCenterDatePreset)} className="w-auto min-w-36">
          {DATE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </Select>
        <Select aria-label="Division" value={divisionId} onChange={(event) => updateFilter('division', event.target.value)} className="w-auto min-w-40">
          <option value="all">All Divisions</option>
          {divisions.filter((division) => division.active).sort((a, b) => a.sortOrder - b.sortOrder).map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
        </Select>
        <p className="text-xs text-brand-400 dark:text-brand-300 sm:ml-auto">{activeDivision?.name ? `${activeDivision.name} · ` : ''}{dateLabel}</p>
        {datePreset === 'custom' && customRangeOpen ? <div className="absolute left-0 top-12 z-20 grid w-full gap-3 rounded-lg border border-brand-100 bg-white p-4 shadow-lg dark:border-brand-600 dark:bg-brand-700 sm:w-auto sm:grid-cols-2" role="dialog" aria-label="Custom reporting period">
          <Input type="date" label="From" value={customStart} onChange={(event) => updateFilter('start', event.target.value)} />
          <Input type="date" label="To" value={customEnd} min={customStart} onChange={(event) => updateFilter('end', event.target.value)} />
        </div> : null}
      </div>

      <div className="overflow-x-auto border-b border-brand-100 dark:border-brand-600" role="tablist" aria-label="Reports">
        <div className="flex min-w-max gap-6">
          {REPORT_CATEGORIES.map((category) => <button key={category} type="button" role="tab" aria-selected={activeCategory === category} onClick={() => updateFilter('tab', CATEGORY_DEFAULT_TAB[category])} className={`border-b-2 px-1 pb-2 text-sm font-semibold transition-colors ${activeCategory === category ? 'border-accent-500 text-brand-900 dark:text-brand-50' : 'border-transparent text-brand-400 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-100'}`}>{category === 'sales-jobs' ? 'Sales & Jobs' : titleCase(category)}</button>)}
        </div>
      </div>

      {activeCategory === 'sales-jobs' ? <div className="inline-flex rounded-lg bg-brand-50 p-1 dark:bg-brand-800" role="tablist" aria-label="Sales and Jobs reports">{(['sales', 'jobs', 'customers'] as DashboardTab[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => updateFilter('tab', tab)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeTab === tab ? 'bg-white text-brand-900 shadow-sm dark:bg-brand-600 dark:text-brand-50' : 'text-brand-500 dark:text-brand-200'}`}>{titleCase(tab)}</button>)}</div> : null}
      {activeCategory === 'operations' ? <div className="inline-flex rounded-lg bg-brand-50 p-1 dark:bg-brand-800" role="tablist" aria-label="Operations reports">{(['labour', 'equipment'] as DashboardTab[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => updateFilter('tab', tab)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeTab === tab ? 'bg-white text-brand-900 shadow-sm dark:bg-brand-600 dark:text-brand-50' : 'text-brand-500 dark:text-brand-200'}`}>{titleCase(tab)}</button>)}</div> : null}

      <DashboardContent activeTab={activeTab} records={records} range={range} />
    </div>
  );
}
