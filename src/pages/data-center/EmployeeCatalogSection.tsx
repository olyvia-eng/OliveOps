import { useMemo, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2, Search, UserRound, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import DetailWorkspace from '../../components/detail-workspace/DetailWorkspace';
import {
  closeDetailWorkspace,
  openDetailWorkspace,
  readDetailWorkspaceQuery,
  setDetailWorkspaceMode,
} from '../../components/detail-workspace/detailWorkspaceQuery';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { useStore } from '../../store';
import { formatCurrency } from '../../utils';
import { calculateEmployeeLabourCost } from '../../utils/employeeLabourCost';

const EMPLOYEE_WORKSPACE_QUERY = { recordParam: 'employee', tabParam: 'employeeTab', defaultTab: 'cost' } as const;

export default function EmployeeCatalogSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const employees = useStore((state) => state.employees);
  const crews = useStore((state) => state.crews);
  const divisions = useStore((state) => state.divisions);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const workspace = readDetailWorkspaceQuery(searchParams, EMPLOYEE_WORKSPACE_QUERY);
  const selectedEmployee = employees.find((employee) => employee.id === workspace.recordId) ?? null;

  const divisionIdsByEmployee = useMemo(() => {
    const result = new Map<string, Set<string>>();
    crews.filter((crew) => crew.active && crew.defaultDivisionId).forEach((crew) => {
      [crew.leadEmployeeId, ...crew.memberIds].filter((id): id is string => Boolean(id)).forEach((employeeId) => {
        const employeeDivisionIds = result.get(employeeId) ?? new Set<string>();
        employeeDivisionIds.add(crew.defaultDivisionId!);
        result.set(employeeId, employeeDivisionIds);
      });
    });
    return result;
  }, [crews]);

  const sortedEmployees = useMemo(() => [...employees].sort((left, right) => left.name.localeCompare(right.name)), [employees]);
  const visibleEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortedEmployees.filter((employee) => {
      const employeeDivisionIds = divisionIdsByEmployee.get(employee.id) ?? new Set<string>();
      const matchesQuery = !normalizedQuery || [employee.name, employee.role].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? employee.active : !employee.active);
      const matchesDivision = divisionFilter === 'all' || employeeDivisionIds.has(divisionFilter);
      return matchesQuery && matchesStatus && matchesDivision;
    });
  }, [divisionFilter, divisionIdsByEmployee, query, sortedEmployees, statusFilter]);

  const divisionNamesFor = (employeeId: string) => divisions
    .filter((division) => divisionIdsByEmployee.get(employeeId)?.has(division.id))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    .map((division) => division.name);

  const closeEmployee = () => setSearchParams(closeDetailWorkspace(searchParams, EMPLOYEE_WORKSPACE_QUERY));
  const list = (
    <Card className="overflow-hidden">
      <div className="border-b border-brand-100 p-4 dark:border-brand-600 sm:p-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">Employee Catalog</h2>
          <p className="text-sm text-gray-500 dark:text-brand-200">{visibleEmployees.length} of {sortedEmployees.length} labour resources</p>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees..." aria-label="Search employees" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50" />
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter employees by status" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50">
            <option value="all">All Statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
          <select value={divisionFilter} onChange={(event) => setDivisionFilter(event.target.value)} aria-label="Filter employees by division" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-brand-500 dark:bg-brand-700 dark:text-brand-50">
            <option value="all">All Divisions</option>{divisions.filter((division) => division.active).sort((a, b) => a.sortOrder - b.sortOrder).map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
          </select>
        </div>
      </div>
      {sortedEmployees.length === 0 ? <div className="p-5"><EmptyState title="No employees yet" description="Add employees from Team to make them available for labour planning." /></div> : visibleEmployees.length === 0 ? <div className="p-5"><EmptyState title="No employees match these filters" description="Try a different search, status, or Division." action={<Button variant="secondary" onClick={() => { setQuery(''); setStatusFilter('all'); setDivisionFilter('all'); }}>Clear Filters</Button>} /></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-sm">
          <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500 dark:border-brand-600 dark:bg-brand-600 dark:text-brand-200"><th className="px-4 py-3 font-medium">Employee</th><th className="px-4 py-3 font-medium">Role</th><th className="px-4 py-3 text-right font-medium">Base Wage</th><th className="px-4 py-3 text-right font-medium">Burden</th><th className="px-4 py-3 text-right font-medium">Labour Cost</th><th className="px-4 py-3 font-medium">Divisions</th><th className="px-4 py-3 font-medium">Status</th></tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-brand-600">{visibleEmployees.map((employee) => {
            const cost = calculateEmployeeLabourCost(employee);
            const divisionNames = divisionNamesFor(employee.id);
            return <tr key={employee.id} tabIndex={0} aria-selected={workspace.recordId === employee.id} onClick={() => setSearchParams(openDetailWorkspace(searchParams, EMPLOYEE_WORKSPACE_QUERY, employee.id))} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSearchParams(openDetailWorkspace(searchParams, EMPLOYEE_WORKSPACE_QUERY, employee.id)); }} className={`cursor-pointer transition-colors ${workspace.recordId === employee.id ? 'bg-brand-50 dark:bg-brand-600' : 'hover:bg-gray-50 dark:hover:bg-brand-600/60'}`}>
              <td className="px-4 py-3 font-semibold text-gray-900 dark:text-brand-50">{employee.name}</td><td className="px-4 py-3 text-gray-600 dark:text-brand-100">{employee.role}</td><td className="px-4 py-3 text-right text-gray-800 dark:text-brand-50">{cost.compType === 'salaried' ? `${formatCurrency(cost.annualSalary)}/yr` : `${formatCurrency(cost.hourlyRate)}/hr`}</td><td className="px-4 py-3 text-right text-gray-800 dark:text-brand-50">{cost.payrollBurdenPct.toFixed(1)}%</td><td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-brand-50">{formatCurrency(cost.labourCostPerPaidHour)}/hr</td><td className="max-w-52 truncate px-4 py-3 text-gray-600 dark:text-brand-100" title={divisionNames.join(', ')}>{divisionNames.length ? divisionNames.join(', ') : 'Unassigned'}</td><td className="px-4 py-3"><Badge label={employee.active ? 'Active' : 'Inactive'} className={employee.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </Card>
  );

  const selectedCost = selectedEmployee ? calculateEmployeeLabourCost(selectedEmployee) : null;
  const selectedDivisionNames = selectedEmployee ? divisionNamesFor(selectedEmployee.id) : [];
  const detail = selectedEmployee && selectedCost ? <div className="min-h-full bg-white dark:bg-brand-700">
    <div className="flex items-start justify-between gap-3 border-b border-brand-100 p-5 dark:border-brand-600"><div><div className="flex items-center gap-2"><UserRound size={18} className="text-brand-600" /><h2 className="text-lg font-semibold text-gray-900 dark:text-brand-50">{selectedEmployee.name}</h2></div><p className="mt-1 text-sm text-gray-500 dark:text-brand-200">{selectedEmployee.role} · Labour cost resource</p></div><div className="flex gap-1"><button type="button" title={workspace.mode === 'expanded' ? 'Show panel' : 'Expand'} onClick={() => setSearchParams(setDetailWorkspaceMode(searchParams, EMPLOYEE_WORKSPACE_QUERY, workspace.mode === 'expanded' ? 'panel' : 'expanded'))} className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-brand-600">{workspace.mode === 'expanded' ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button type="button" title="Close" onClick={closeEmployee} className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-brand-600"><X size={18} /></button></div></div>
    <div className="space-y-6 p-5"><div className="flex flex-wrap gap-2"><Badge label={selectedEmployee.active ? 'Active' : 'Inactive'} className={selectedEmployee.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'} /><Badge label={selectedEmployee.labourType === 'overhead' ? 'Overhead' : 'Field Producing'} className="bg-brand-50 text-brand-700" /></div>
      <section><h3 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Cost Inputs</h3><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt className="text-gray-500">Base compensation</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{selectedCost.compType === 'salaried' ? `${formatCurrency(selectedCost.annualSalary)}/year` : `${formatCurrency(selectedCost.hourlyRate)}/hour`}</dd></div><div><dt className="text-gray-500">Payroll burden</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{selectedCost.payrollBurdenPct.toFixed(1)}%</dd></div><div><dt className="text-gray-500">Annual benefits / extra</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{formatCurrency(selectedCost.benefitsExtraCost)}</dd></div><div><dt className="text-gray-500">Annual bonus</dt><dd className="font-medium text-gray-900 dark:text-brand-50">{formatCurrency(selectedCost.bonus)}</dd></div></dl></section>
      <section className="border-y border-brand-100 py-4 dark:border-brand-600"><h3 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Calculated Cost</h3><dl className="mt-3 grid grid-cols-2 gap-3"><div><dt className="text-xs text-gray-500">Employer cost / paid hour</dt><dd className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(selectedCost.employerCostPerPaidHour)}</dd></div><div><dt className="text-xs text-gray-500">Labour cost / paid hour</dt><dd className="mt-1 text-xl font-semibold text-gray-900 dark:text-brand-50">{formatCurrency(selectedCost.labourCostPerPaidHour)}</dd></div></dl><p className="mt-3 text-xs text-gray-500">Uses 2,080 paid hours for this Catalog view. Budget pricing uses the same inputs with that Budget's planned hours, overtime, and billable assumptions.</p></section>
      <section><h3 className="text-sm font-semibold text-gray-900 dark:text-brand-50">Available Divisions</h3><p className="mt-2 text-sm text-gray-600 dark:text-brand-100">{selectedDivisionNames.length ? selectedDivisionNames.join(', ') : 'No Division assigned through an active Crew.'}</p></section>
      <Link to={`/employees/${selectedEmployee.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-900 dark:text-brand-100"><ExternalLink size={15} />View Employee Profile</Link>
    </div>
  </div> : <div className="p-6"><p className="text-sm text-gray-500">Employee not found or no longer available.</p><Button className="mt-4" variant="secondary" onClick={closeEmployee}>Close</Button></div>;

  return <DetailWorkspace open={Boolean(workspace.recordId)} expanded={workspace.mode === 'expanded'} detailKey={workspace.recordId} list={list} detail={detail} />;
}
