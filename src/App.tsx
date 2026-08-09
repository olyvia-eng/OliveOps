import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import type { BusinessUserSummary, SessionUser } from './auth/types';
import { useStore } from './store';
import type { Budget, BudgetItem, BudgetRate, Customer, Employee, EquipmentAsset, Estimate, EstimateTemplate, Expense, FormField, FormRecord, FormResponse, FormSubmission, Invoice, Job, LabourBudgetPlan, LabourHoursSalesGoal, MaterialCatalogItem, RevenueSalesGoal, Task, TimeCorrectionRequest, TimeEntry, UnbillableTimeCategory } from './types';
import { APP_TOAST_EVENT, type AppToastDetail, emitAppToast } from './toast';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const HomePage = lazy(() => import('./pages/home/HomePage'));
const CRMPage = lazy(() => import('./pages/crm/CRMPage'));
const EstimatesPage = lazy(() => import('./pages/estimates/EstimatesPage'));
const EstimateWorkspacePage = lazy(() => import('./pages/estimates/EstimateWorkspacePage'));
const EstimateWorkAreaBuilderPage = lazy(() => import('./pages/estimates/EstimateWorkAreaBuilderPage'));
const TemplatesPage = lazy(() => import('./pages/estimates/TemplatesPage'));
const JobsPage = lazy(() => import('./pages/jobs/JobsPage'));
const JobDetailPage = lazy(() => import('./pages/jobs/JobDetailPage'));
const BudgetPage = lazy(() => import('./pages/budget/BudgetPage'));
const BudgetsPage = lazy(() => import('./pages/budget/BudgetsPage'));
const CombinedBudgetPage = lazy(() => import('./pages/budget/CombinedBudgetPage'));
const EmployeesPage = lazy(() => import('./pages/employees/EmployeesPage'));
const DataCenterPage = lazy(() => import('./pages/datacenter/DataCenterPage'));
const TimeReportsPage = lazy(() => import('./pages/reports/TimeReportsPage'));
const EmployeePortalPage = lazy(() => import('./pages/employees/EmployeePortalPage'));
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const SignupPage = lazy(() => import('./pages/auth/SignupPage'));
const UserAccessPage = lazy(() => import('./pages/users/UserAccessPage'));
const RevenueDashboardPage = lazy(() => import('./pages/department-dashboards/RevenueDashboardPage'));
const FinanceDashboardPage = lazy(() => import('./pages/department-dashboards/FinanceDashboardPage'));
const OperationsDashboardPage = lazy(() => import('./pages/department-dashboards/OperationsDashboardPage'));
const EmployeesDashboardPage = lazy(() => import('./pages/department-dashboards/EmployeesDashboardPage'));
const DataCenterDashboardPage = lazy(() => import('./pages/department-dashboards/DataCenterDashboardPage'));
const ModulePlaceholderPage = lazy(() => import('./pages/placeholders/ModulePlaceholderPage'));
const InvoicesPage = lazy(() => import('./pages/finance/InvoicesPage'));
const MaterialsEquipmentCatalogPage = lazy(() => import('./pages/data-center/EquipmentCatalogPage'));
const EquipmentPage = lazy(() => import('./pages/data-center/EquipmentCatalogPage'));
const FormsPage = lazy(() => import('./pages/operations/FormsPage'));
const DocumentsPage = lazy(() => import('./pages/data-center/DocumentsPage'));
const UnbillableTimeCategoriesPage = lazy(() => import('./pages/settings/UnbillableTimeCategoriesPage'));

const STORE_OWNER_KEY = 'oliveops.store.ownerBusinessId';

async function readApiJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default function App() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<BusinessUserSummary[]>([]);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingBusinessData, setLoadingBusinessData] = useState(false);
  const [hasLoadedBusinessData, setHasLoadedBusinessData] = useState(false);
  const [businessDataError, setBusinessDataError] = useState('');
  const [toasts, setToasts] = useState<Array<AppToastDetail & { id: number }>>([]);

  const canManageUsers =
    sessionUser?.role === 'owner' || sessionUser?.role === 'admin';
  const canViewReports = sessionUser?.role === 'owner' || sessionUser?.role === 'admin';

  const loadBusinessData = async (user: SessionUser | null = sessionUser) => {
    if (!user) {
      setHasLoadedBusinessData(false);
      setBusinessDataError('');
      return;
    }

    setLoadingBusinessData(true);
    setBusinessDataError('');

    try {
      const response = await fetch('/api/bootstrap', {
        method: 'GET',
        credentials: 'include',
      });

      const payload = await readApiJson<{
        ok: boolean;
        forms?: FormRecord[];
        formFields?: FormField[];
        formSubmissions?: FormSubmission[];
        formResponses?: FormResponse[];
        budgets?: Budget[];
        customers?: Customer[];
        jobs?: Job[];
        estimates?: Estimate[];
        invoices?: Invoice[];
        expenses?: Expense[];
        equipmentAssets?: EquipmentAsset[];
        unbillableTimeCategories?: UnbillableTimeCategory[];
        materialCatalogItems?: MaterialCatalogItem[];
        templates?: EstimateTemplate[];
        budgetItems?: BudgetItem[];
        budgetRates?: BudgetRate[];
        labourBudgetPlans?: LabourBudgetPlan[];
        labourHoursSalesGoals?: LabourHoursSalesGoal[];
        revenueSalesGoals?: RevenueSalesGoal[];
        employees?: Employee[];
        tasks?: Task[];
        timeEntries?: TimeEntry[];
        timeCorrections?: TimeCorrectionRequest[];
      }>(response);

      if (!response.ok || !payload?.ok) {
        setBusinessDataError('Could not load business data. Please retry.');
        return;
      }

      useStore.setState((state) => ({
        ...state,
        forms: payload.forms ?? [],
        formFields: payload.formFields ?? [],
        formSubmissions: payload.formSubmissions ?? [],
        formResponses: payload.formResponses ?? [],
        budgets: payload.budgets ?? [],
        customers: payload.customers ?? [],
        jobs: payload.jobs ?? [],
        estimates: payload.estimates ?? [],
        invoices: payload.invoices ?? [],
        expenses: payload.expenses ?? [],
        equipmentAssets: payload.equipmentAssets ?? [],
        unbillableTimeCategories: payload.unbillableTimeCategories ?? [],
        materialCatalogItems: payload.materialCatalogItems ?? [],
        templates: payload.templates ?? [],
        budgetItems: payload.budgetItems ?? [],
        budgetRates: payload.budgetRates ?? [],
        labourBudgetPlans: payload.labourBudgetPlans ?? [],
        labourHoursSalesGoals: payload.labourHoursSalesGoals ?? [],
        revenueSalesGoals: payload.revenueSalesGoals ?? [],
        employees: payload.employees ?? [],
        tasks: payload.tasks ?? [],
        timeEntries: payload.timeEntries ?? [],
        timeCorrections: payload.timeCorrections ?? [],
      }));
      setBusinessDataError('');
    } catch {
      setBusinessDataError('Could not load business data. Please retry.');
    } finally {
      setLoadingBusinessData(false);
      setHasLoadedBusinessData(true);
    }
  };

  const loadUsers = async (user: SessionUser | null = sessionUser) => {
    const canManage = user?.role === 'owner' || user?.role === 'admin';
    if (!user || !canManage) {
      setUsers([]);
      return;
    }

    const response = await fetch('/api/users', {
      method: 'GET',
      credentials: 'include',
    });
    const payload = await readApiJson<{ ok: boolean; users?: BusinessUserSummary[] }>(response);

    if (!response.ok || !payload?.ok || !Array.isArray(payload.users)) {
      setUsers([]);
      return;
    }

    setUsers(payload.users);
  };

  useEffect(() => {
    const loadSession = async () => {
      const response = await fetch('/api/auth?action=session', {
        method: 'GET',
        credentials: 'include',
      });

      const payload = await readApiJson<{ ok: boolean; user?: SessionUser }>(response);
      if (response.ok && payload?.ok && payload.user) {
        setSessionUser(payload.user);
      } else {
        setSessionUser(null);
      }

      setLoadingSession(false);
    };

    void loadSession();
  }, []);

  useEffect(() => {
    const handleToast = (event: Event) => {
      const custom = event as CustomEvent<AppToastDetail>;
      const detail = custom.detail;
      if (!detail?.message) return;

      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current, { id, tone: 'error', ...detail }]);

      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 3500);
    };

    window.addEventListener(APP_TOAST_EVENT, handleToast as EventListener);
    return () => window.removeEventListener(APP_TOAST_EVENT, handleToast as EventListener);
  }, []);

  useEffect(() => {
    if (!sessionUser) {
      setUsers([]);
      setHasLoadedBusinessData(false);
      return;
    }

    setHasLoadedBusinessData(false);
    void loadUsers(sessionUser);
    void loadBusinessData(sessionUser);
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser) return;

    const previousOwner = localStorage.getItem(STORE_OWNER_KEY);
    if (previousOwner === sessionUser.businessId) return;

    useStore.setState({
      forms: [],
      formFields: [],
      formSubmissions: [],
      formResponses: [],
      budgets: [],
      budgetRates: [],
      customers: [],
      estimates: [],
      expenses: [],
      equipmentAssets: [],
      unbillableTimeCategories: [],
      materialCatalogItems: [],
      invoices: [],
      templates: [],
      jobs: [],
      employees: [],
      tasks: [],
      timeEntries: [],
      timeCorrections: [],
      budgetItems: [],
      labourBudgetPlans: [],
      labourHoursSalesGoals: [],
      revenueSalesGoals: [],
    });
    localStorage.setItem(STORE_OWNER_KEY, sessionUser.businessId);
  }, [sessionUser]);

  const login = async (email: string, password: string): Promise<boolean> => {
    const response = await fetch('/api/auth?action=login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    const payload = await readApiJson<{ ok: boolean; user?: SessionUser }>(response);
    if (!response.ok || !payload?.ok || !payload.user) {
      return false;
    }

    setSessionUser(payload.user);
    await loadUsers(payload.user);
    await loadBusinessData(payload.user);
    return true;
  };

  const signup = async (payload: {
    businessName: string;
    ownerName: string;
    email: string;
    password: string;
  }) => {
    const response = await fetch('/api/auth?action=signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const body = await readApiJson<{ ok: boolean; user?: SessionUser; error?: string }>(response);
    if (!response.ok || !body?.ok || !body.user) {
      return { ok: false, error: body?.error ?? 'Could not create account.' };
    }

    setSessionUser(body.user);
    await loadUsers(body.user);
    await loadBusinessData(body.user);
    return { ok: true };
  };

  const createUser = async (payload: {
    name: string;
    email: string;
    password: string;
    role: 'admin' | 'foreman' | 'crew_member';
  }) => {
    let response: Response;
    try {
      response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
    } catch {
      return { ok: false, error: 'Could not reach the API. Run npm run dev:full for local API routes.' };
    }

    const body = await readApiJson<{ ok: boolean; error?: string }>(response);

    if (!response.ok || !body?.ok) {
      if (!body?.error && response.status === 404) {
        return { ok: false, error: 'API route unavailable. Run npm run dev:full for local API routes.' };
      }
      if (!body?.error && response.status === 401) {
        return { ok: false, error: 'Your session expired. Please log in again.' };
      }
      if (!body?.error && response.status === 403) {
        return { ok: false, error: 'You do not have permission to create users.' };
      }
      if (!body?.error) {
        return { ok: false, error: `Could not create user (HTTP ${response.status}).` };
      }
      return { ok: false, error: body.error };
    }

    await loadUsers();
    emitAppToast({ tone: 'success', message: 'User created successfully.' });
    return { ok: true };
  };

  const updateUser = async (userId: string, data: { role?: 'admin' | 'foreman' | 'crew_member'; active?: boolean }) => {
    const response = await fetch(`/api/users?id=${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ data }),
    });
    const body = await readApiJson<{ ok: boolean; error?: string }>(response);

    if (!response.ok || !body?.ok) {
      return { ok: false, error: body?.error ?? 'Could not update user.' };
    }

    await loadUsers();
    emitAppToast({ tone: 'success', message: 'User updated successfully.' });
    return { ok: true };
  };

  const deleteUser = async (userId: string) => {
    const response = await fetch(`/api/users?id=${userId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const body = await readApiJson<{ ok: boolean; error?: string }>(response);

    if (!response.ok || !body?.ok) {
      return { ok: false, error: body?.error ?? 'Could not delete user.' };
    }

    await loadUsers();
    emitAppToast({ tone: 'success', message: 'User deleted successfully.' });
    return { ok: true };
  };

  const logout = async () => {
    await fetch('/api/auth?action=logout', {
      method: 'POST',
      credentials: 'include',
    });
    setSessionUser(null);
    setHasLoadedBusinessData(false);
    setBusinessDataError('');
    setUsers([]);
  };

  const showBusinessDataLoading = Boolean(sessionUser) && (loadingBusinessData || !hasLoadedBusinessData);

  if (loadingSession || showBusinessDataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream text-brand-400 text-sm">
        Loading business data...
      </div>
    );
  }

  return (
    <>
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`min-w-64 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${
              toast.tone === 'success'
                ? 'border-brand-200 bg-brand-50 text-brand-800'
                : 'border-accent-100 bg-accent-50 text-accent-700'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
      {sessionUser && businessDataError && (
        <div className="fixed top-4 left-4 right-4 z-[90] sm:left-auto sm:right-4 sm:max-w-md">
          <div className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-800 shadow-lg">
            <p className="font-medium">Business data could not be loaded.</p>
            <p className="mt-1 text-accent-700">{businessDataError}</p>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void loadBusinessData(sessionUser)}
                className="inline-flex items-center rounded-md bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loadingBusinessData}
              >
                {loadingBusinessData ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          </div>
        </div>
      )}
      <BrowserRouter>
      <Suspense
        fallback={(
          <div className="min-h-screen flex items-center justify-center bg-cream text-brand-400 text-sm">
            Loading page...
          </div>
        )}
      >
      <Routes>
        <Route
          path="employee-login"
          element={
            sessionUser?.role === 'crew_member' || sessionUser?.role === 'foreman' ? (
              <EmployeePortalPage
                sessionEmployeeEmail={sessionUser.email}
                onLogout={logout}
              />
            ) : (
              <Navigate to={sessionUser ? '/' : '/login'} replace />
            )
          }
        />

        {sessionUser ? (
          sessionUser.role === 'crew_member' || sessionUser.role === 'foreman' ? (
            <>
              <Route path="login" element={<Navigate to="/employee-login" replace />} />
              <Route path="signup" element={<Navigate to="/employee-login" replace />} />
              <Route path="*" element={<Navigate to="/employee-login" replace />} />
            </>
          ) : (
          <>
              <Route path="login" element={<Navigate to="/home" replace />} />
              <Route path="signup" element={<Navigate to="/home" replace />} />
            <Route
              path="/"
              element={
                <AppLayout
                  userName={sessionUser.name}
                  userEmail={sessionUser.email}
                  businessName={sessionUser.businessName}
                  userRole={sessionUser.role}
                  onLogout={logout}
                />
              }
            >
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home" element={<HomePage currentUserId={sessionUser.id} currentUserName={sessionUser.name} />} />
              <Route path="company-dashboard" element={<Dashboard businessId={sessionUser.businessId} businessName={sessionUser.businessName} />} />
              <Route path="crm" element={<CRMPage />} />
              <Route path="revenue/dashboard" element={<RevenueDashboardPage />} />
              <Route
                path="revenue/leads"
                element={
                  <ModulePlaceholderPage
                    title="Leads"
                    question="Which leads should we prioritize this week to protect future revenue?"
                    summary="Track and rank pipeline opportunities by value, close probability, and urgency so sales focus stays clear and measurable."
                  />
                }
              />
              <Route
                path="revenue/change-orders"
                element={
                  <ModulePlaceholderPage
                    title="Change Orders"
                    question="Which scope changes are waiting for approval and what revenue is at risk?"
                    summary="Review pending and approved change orders in one place to keep job margin and billing aligned with real field work."
                  />
                }
              />
              <Route path="finance/dashboard" element={<FinanceDashboardPage />} />
              <Route path="finance/invoices" element={<InvoicesPage />} />
              <Route path="operations/dashboard" element={<OperationsDashboardPage />} />
              <Route path="operations/equipment" element={<EquipmentPage />} />
              <Route path="operations/forms" element={<FormsPage />} />
              <Route
                path="operations/inventory"
                element={
                  <ModulePlaceholderPage
                    title="Inventory"
                    question="Which materials are running low and could delay upcoming work?"
                    summary="Monitor key stock levels and reorder signals to prevent job delays while avoiding over-purchasing."
                  />
                }
              />
              <Route
                path="materials/catalog"
                element={<MaterialsEquipmentCatalogPage />}
              />
              <Route
                path="operations/purchase-orders"
                element={
                  <ModulePlaceholderPage
                    title="Purchase Orders"
                    question="What purchases are approved, pending, and tied to active jobs?"
                    summary="Track PO lifecycle clearly so project commitments, vendor communication, and budget control stay in sync."
                  />
                }
              />
              <Route path="employees/dashboard" element={<EmployeesDashboardPage />} />
              <Route
                path="employees/payroll"
                element={
                  <ModulePlaceholderPage
                    title="Payroll"
                    question="Are labour hours and pay ready for accurate payroll processing?"
                    summary="Review payable hours, adjustments, and payroll readiness so finance can process confidently without manual reconciliation."
                  />
                }
              />
              <Route
                path="employees/certifications"
                element={
                  <ModulePlaceholderPage
                    title="Certifications"
                    question="Who is certified for upcoming work and who needs renewal soon?"
                    summary="Surface expiration risk and qualification coverage so job staffing decisions remain compliant and practical."
                  />
                }
              />
              <Route path="data-center/dashboard" element={<DataCenterDashboardPage />} />
              <Route
                path="data-center/documents"
                element={<DocumentsPage />}
              />
              <Route
                path="data-center/forms"
                element={
                  <ModulePlaceholderPage
                    title="Forms"
                    question="Which operational forms are required and are they being completed consistently?"
                    summary="Standardize field and office form workflows to improve accountability and reduce missed compliance steps."
                  />
                }
              />
              <Route
                path="data-center/photos"
                element={
                  <ModulePlaceholderPage
                    title="Photos"
                    question="Do we have visual records of project progress and key field conditions?"
                    summary="Organize photo evidence by job and timeline so teams can quickly reference progress, quality, and issues."
                  />
                }
              />
              <Route path="estimates" element={<EstimatesPage />} />
              <Route
                path="estimates/:id"
                element={<EstimateWorkspacePage currentUserRole={sessionUser.role} />}
              />
              <Route
                path="estimates/:id/work-areas/:workAreaId"
                element={<EstimateWorkAreaBuilderPage currentUserRole={sessionUser.role} />}
              />
              <Route path="estimates/templates" element={<TemplatesPage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="jobs/:id" element={<JobDetailPage currentUserRole={sessionUser.role} />} />
              <Route path="calendar" element={<CalendarPage currentUserRole={sessionUser.role} />} />
              <Route path="budgets" element={<BudgetsPage />} />
              <Route path="budgets/combined" element={<CombinedBudgetPage />} />
              <Route path="budgets/:budgetId" element={<BudgetPage />} />
              <Route path="budget" element={<BudgetPage />} />
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="data-center" element={<DataCenterPage />} />
              <Route
                path="time-reports"
                element={
                  canViewReports ? (
                    <TimeReportsPage
                      currentUserRole={sessionUser.role}
                      currentUserId={sessionUser.id}
                      currentUserName={sessionUser.name}
                      currentUserEmail={sessionUser.email}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="reports/time"
                element={
                  canViewReports ? (
                    <TimeReportsPage
                      currentUserRole={sessionUser.role}
                      currentUserId={sessionUser.id}
                      currentUserName={sessionUser.name}
                      currentUserEmail={sessionUser.email}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="user-access"
                element={
                  canManageUsers ? (
                    <UserAccessPage
                      users={users}
                      currentUserRole={sessionUser.role}
                      onCreateUser={createUser}
                      onUpdateUser={updateUser}
                      onDeleteUser={deleteUser}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="settings/unbillable-time-categories"
                element={
                  canManageUsers ? (
                    <UnbillableTimeCategoriesPage />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
          )
        ) : (
          <>
            <Route path="login" element={<LoginPage onLogin={login} />} />
            <Route path="signup" element={<SignupPage onSignup={signup} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
      </Suspense>
    </BrowserRouter>
    </>
  );
}
