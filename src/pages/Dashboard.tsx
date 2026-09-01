import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { CalendarDays, Briefcase, DollarSign, FileText, TrendingUp, Users, Wallet } from 'lucide-react';
import DashboardOnboardingCard from '../components/dashboard/DashboardOnboardingCard';
import { buildDashboardOnboardingItems, calculateDashboardOnboardingProgress } from '../components/dashboard/onboardingProgress';
import { Card, PageHeader, StatCard } from '../components/ui';
import { useStore } from '../store';
import { formatCurrency } from '../utils';
import { getTimeEntryWorkLabel } from '../utils/timeEntryPresentation.js';

type ActivityEvent = {
  id: string;
  label: string;
  timestamp: string;
  sortAt: number;
  activeTimeEntry?: boolean;
  timeEntryCreatedAt?: number;
};

const parseTimestamp = (value?: string) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const relativeTime = (value: string) => {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return 'Unknown time';
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
};

interface DashboardProps {
  businessId?: string;
  businessName?: string;
}

export default function Dashboard({ businessId = '', businessName = '' }: DashboardProps) {
  const { customers, estimates, jobs, employees, timeEntries, expenses, budgets, budgetRates } = useStore();

  const openEstimates = estimates.filter((estimate) => estimate.status === 'draft' || estimate.status === 'sent');
  const jobsInProgress = jobs.filter((job) => job.status === 'in_progress');
  const completedJobs = jobs.filter((job) => job.status === 'completed');

  const totalRevenue = completedJobs.reduce((sum, job) => sum + job.contractValue, 0);
  const completedActualCost = completedJobs.reduce(
    (sum, job) => sum + job.actualCosts.reduce((entrySum, entry) => entrySum + entry.total, 0),
    0
  );
  const grossProfit = totalRevenue - completedActualCost;

  const openEstimateValue = openEstimates.reduce((sum, estimate) => {
    const lineTotal = estimate.lineItems.reduce((lineSum, item) => lineSum + item.total, 0);
    const taxMultiplier = 1 + (estimate.taxRate ?? 0) / 100;
    return sum + lineTotal * taxMultiplier;
  }, 0);

  const upcomingJobs = useMemo(() => {
    const now = new Date();

    return jobs
      .filter((job) => {
        if (job.status !== 'scheduled' && job.status !== 'in_progress') return false;
        const start = parseTimestamp(job.startDate);
        return start > 0 && (job.status === 'in_progress' || start >= now.getTime());
      })
      .sort((a, b) => parseTimestamp(a.startDate) - parseTimestamp(b.startDate))
      .slice(0, 6);
  }, [jobs]);

  const recentActivity = useMemo(() => {
    const estimateEvents: ActivityEvent[] = estimates.map((estimate) => ({
      id: `estimate-${estimate.id}`,
      label: `Estimate ${estimate.title || estimate.id} updated`,
      timestamp: estimate.updatedAt,
      sortAt: parseTimestamp(estimate.updatedAt),
    }));

    const jobEvents: ActivityEvent[] = jobs.map((job) => ({
      id: `job-${job.id}`,
      label: `Job ${job.title || job.id} updated`,
      timestamp: job.updatedAt,
      sortAt: parseTimestamp(job.updatedAt),
    }));

    const timeEntryEvents: ActivityEvent[] = timeEntries.map((entry) => {
      const employee = employees.find((value) => value.id === entry.employeeId);
      const workLabel = getTimeEntryWorkLabel(entry, jobs);
      return {
        id: `time-${entry.id}`,
        label: entry.status === 'clocked_in'
          ? `${employee?.name ?? 'Employee'} — ${workLabel}`
          : `${employee?.name ?? 'Employee'} · ${workLabel}`,
        timestamp: entry.clockOut ?? entry.clockIn,
        sortAt: parseTimestamp(entry.clockIn),
        activeTimeEntry: entry.status === 'clocked_in',
        timeEntryCreatedAt: parseTimestamp(entry.createdAt),
      };
    });

    return [...estimateEvents, ...jobEvents, ...timeEntryEvents]
      .filter((event) => event.sortAt > 0)
      .sort((a, b) => Number(b.activeTimeEntry) - Number(a.activeTimeEntry) || b.sortAt - a.sortAt || (b.timeEntryCreatedAt ?? 0) - (a.timeEntryCreatedAt ?? 0) || a.id.localeCompare(b.id))
      .slice(0, 8);
  }, [employees, estimates, jobs, timeEntries]);

  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const activeEmployees = employees.filter((employee) => employee.active).length;
  const scheduledJobs = jobs.filter((job) => job.status === 'scheduled').length;
  const onboardingItems = useMemo(() => buildDashboardOnboardingItems({
    businessId,
    businessName,
    employees,
    customers,
    estimates,
    jobs,
    budgets,
    budgetRates,
  }), [budgets, budgetRates, businessId, businessName, customers, employees, estimates, jobs]);
  const onboardingProgress = useMemo(() => calculateDashboardOnboardingProgress(onboardingItems), [onboardingItems]);
  const hasOperationalData = estimates.length > 0 || jobs.length > 0 || timeEntries.length > 0 || expenses.length > 0;
  const showFirstRunWelcome = !hasOperationalData && onboardingProgress.completeCount <= 1;
  const showOnboardingCard = showFirstRunWelcome || !onboardingProgress.isComplete || onboardingProgress.optionalCompleteCount < onboardingProgress.optionalTotalCount;

  return (
    <div>
      <PageHeader
        title="Company Dashboard"
        subtitle={showFirstRunWelcome ? 'Set up the essentials so OliveOps can start reflecting real company activity.' : 'Executive overview of business performance.'}
      />

      {showOnboardingCard ? (
        <div className="mb-6">
          <DashboardOnboardingCard items={onboardingItems} businessId={businessId || 'global'} prominent={showFirstRunWelcome} />
        </div>
      ) : null}

      {showFirstRunWelcome ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-800 dark:text-brand-200">
                  <Users size={18} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-brand-50">Start with a client</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Clients unlock estimates, properties, and the rest of your work pipeline.</p>
                  <Link to="/crm" className="mt-3 inline-flex text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline">Open Clients</Link>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-800 dark:text-brand-200">
                  <Wallet size={18} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-brand-50">Set up pricing</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Budgets and pricing rates give your estimates consistent labour, equipment, material, and subcontractor pricing.</p>
                  <Link to="/budgets" className="mt-3 inline-flex text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline">Open Budgets</Link>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-800 dark:text-brand-200">
                  <FileText size={18} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-brand-50">Build your first estimate</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Once a client and pricing budget exist, create an estimate and organize the scope into Work Areas.</p>
                  <Link to="/estimates" className="mt-3 inline-flex text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline">Open Estimates</Link>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-800 dark:text-brand-200">
                <CalendarDays size={18} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-brand-50">Your dashboard will populate as work is created</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-brand-200">Upcoming jobs, recent activity, and financial summaries will appear here after you create estimates, convert jobs, and start recording operational data.</p>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Revenue"
              value={formatCurrency(totalRevenue)}
              icon={<DollarSign size={32} />}
              color="text-brand-700"
            />
            <StatCard
              label="Gross Profit"
              value={formatCurrency(grossProfit)}
              sub={`${grossMarginPct.toFixed(1)}% margin`}
              icon={<TrendingUp size={32} />}
              color={grossProfit >= 0 ? 'text-brand-700' : 'text-accent-700'}
            />
            <StatCard
              label="Open Estimates"
              value={openEstimates.length}
              sub={formatCurrency(openEstimateValue)}
              icon={<FileText size={32} />}
              color="text-accent-700"
            />
            <StatCard
              label="Jobs In Progress"
              value={jobsInProgress.length}
              sub={`${scheduledJobs} scheduled next`}
              icon={<Briefcase size={32} />}
              color="text-brand-600"
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <Card>
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Upcoming Jobs</h2>
                <Link to="/jobs" className="text-xs text-brand-600 hover:underline">Open Operations Dashboard</Link>
              </div>
              {upcomingJobs.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">No upcoming jobs scheduled yet.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {upcomingJobs.map((job) => {
                    const customer = customers.find((customerValue) => customerValue.id === job.customerId);
                    return (
                      <li key={job.id} className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{job.title}</p>
                          <p className="text-xs text-gray-500">{customer?.name ?? 'Unassigned customer'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-700">{new Date(job.startDate).toLocaleDateString()}</p>
                          <p className="text-[11px] text-gray-500 capitalize">{job.status.replace('_', ' ')}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Recent Activity</h2>
                <Link to="/data-center" className="text-xs text-brand-600 hover:underline">Open Data Center</Link>
              </div>
              {recentActivity.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">Recent activity will appear here as estimates, jobs, and time entries are created.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recentActivity.map((event) => (
                    <li key={event.id} className="p-4 flex items-start justify-between gap-4">
                      <p className="text-sm text-gray-800">{event.label}</p>
                      <p className="text-xs text-gray-500 whitespace-nowrap">{relativeTime(event.timestamp)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">Financial Summary</h2>
              <Link to="/budget" className="text-xs text-brand-600 hover:underline">Open Finance Dashboard</Link>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500">Revenue</p>
                <p className="text-xl font-semibold text-gray-900">{formatCurrency(totalRevenue)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Gross Profit</p>
                <p className={`text-xl font-semibold ${grossProfit >= 0 ? 'text-brand-700' : 'text-accent-700'}`}>{formatCurrency(grossProfit)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Active Employees</p>
                <p className="text-xl font-semibold text-gray-900">{activeEmployees}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Completed Jobs</p>
                <p className="text-xl font-semibold text-gray-900">{completedJobs.length}</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
