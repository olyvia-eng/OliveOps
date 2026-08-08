import { create } from 'zustand';
import type {
  Budget,
  BudgetRate,
  FormField,
  FormRecord,
  FormResponse,
  FormSubmission,
  Customer,
  Estimate,
  EstimateTemplate,
  EquipmentAsset,
  Expense,
  Invoice,
  Job,
  Employee,
  UnbillableTimeCategory,
  TimeEntry,
  TimeEntryWorkType,
  MaterialCatalogItem,
  BudgetItem,
  LabourBudgetPlan,
  LabourHoursSalesGoal,
  RevenueSalesGoal,
  TimeCorrectionRequest,
  CostEntry,
  ID,
} from '../types';
import {
  generateId,
  nowISO,
} from '../utils';
import { emitAppToast } from '../toast';
import {
  beginClockOutSubmission,
  createClockOutRequestMeta,
  endClockOutSubmission,
} from '../utils/clockOutSubmission';

async function ensureOk(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  if (!response.ok) {
    let detail = '';
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload?.error === 'string') {
        detail = payload.error;
      }
    } catch {
      // Ignore response parse errors; use status fallback.
    }

    if (!detail) {
      if (response.status === 401) detail = 'Unauthorized. Please log in again.';
      else if (response.status === 403) detail = 'Forbidden. Only owner/admin can change customer data.';
      else detail = `Request failed with status ${response.status}`;
    }

    throw new Error(detail);
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function dataUrl(entity: string, id?: string) {
  const query = id ? `?entity=${entity}&id=${id}` : `?entity=${entity}`;
  return `/api/data${query}`;
}

// ─── Store definition ─────────────────────────────────────────────────────────

interface AppState {
  budgets: Budget[];
  customers: Customer[];
  estimates: Estimate[];
  templates: EstimateTemplate[];
  expenses: Expense[];
  equipmentAssets: EquipmentAsset[];
  unbillableTimeCategories: UnbillableTimeCategory[];
  materialCatalogItems: MaterialCatalogItem[];
  invoices: Invoice[];
  jobs: Job[];
  employees: Employee[];
  timeEntries: TimeEntry[];
  timeCorrections: TimeCorrectionRequest[];
  clockInInFlightEmployeeIds: ID[];
  clockOutInFlightEntryIds: ID[];
  budgetItems: BudgetItem[];
  budgetRates: BudgetRate[];
  labourBudgetPlans: LabourBudgetPlan[];
  labourHoursSalesGoals: LabourHoursSalesGoal[];
  revenueSalesGoals: RevenueSalesGoal[];
  forms: FormRecord[];
  formFields: FormField[];
  formSubmissions: FormSubmission[];
  formResponses: FormResponse[];

  // CRM
  addCustomer: (c: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateCustomer: (id: ID, data: Partial<Customer>) => void;
  deleteCustomer: (id: ID) => void;

  // Estimates
  addEstimate: (e: Omit<Estimate, 'id' | 'createdAt' | 'updatedAt'>) => ID;
  updateEstimate: (id: ID, data: Partial<Estimate>) => void;
  deleteEstimate: (id: ID) => void;
  sendEstimate: (id: ID) => void;
  convertEstimateToJob: (estimateId: ID, options?: { title?: string; startDate?: string; endDate?: string }) => Promise<{ ok: boolean; jobId?: ID; error?: string }>;

  // Templates
  addTemplate: (t: Omit<EstimateTemplate, 'id' | 'createdAt'>) => void;
  updateTemplate: (id: ID, data: Partial<EstimateTemplate>) => void;
  deleteTemplate: (id: ID) => void;

  // Invoices
  addInvoice: (i: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateInvoice: (id: ID, data: Partial<Invoice>) => void;
  deleteInvoice: (id: ID) => void;

  // Expenses
  addExpense: (e: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ ok: boolean; expense?: Expense; error?: string }>;
  updateExpense: (id: ID, data: Partial<Expense>) => void;
  deleteExpense: (id: ID) => void;

  // Equipment
  addEquipmentAsset: (e: Omit<EquipmentAsset, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateEquipmentAsset: (id: ID, data: Partial<EquipmentAsset>) => void;
  deleteEquipmentAsset: (id: ID) => void;
  addUnbillableTimeCategory: (category: Omit<UnbillableTimeCategory, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateUnbillableTimeCategory: (id: ID, data: Partial<UnbillableTimeCategory>) => void;
  archiveUnbillableTimeCategory: (id: ID) => void;
  addMaterialCatalogItem: (item: Omit<MaterialCatalogItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateMaterialCatalogItem: (id: ID, data: Partial<MaterialCatalogItem>) => void;
  deleteMaterialCatalogItem: (id: ID) => void;

  // Jobs
  addJob: (j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateJob: (id: ID, data: Partial<Job>) => void;
  deleteJob: (id: ID) => void;
  addCostEntry: (jobId: ID, entry: Omit<CostEntry, 'id'>) => void;

  // Employees
  addEmployee: (e: Omit<Employee, 'id' | 'createdAt'>) => void;
  updateEmployee: (id: ID, data: Partial<Employee>) => void;
  deleteEmployee: (id: ID) => void;

  // Time Entries
  clockIn: (employeeId: ID, options: { workType: TimeEntryWorkType; jobIds?: ID[]; unbillableCategoryId?: ID }) => Promise<{ ok: boolean; error?: string; timeEntry?: TimeEntry }>;
  clockOut: (entryId: ID, breakMinutes?: number, notes?: string, photoAttachmentFileId?: string) => Promise<{ ok: boolean; error?: string }>;
  addTimeEntry: (e: Omit<TimeEntry, 'id'>) => void;
  updateTimeEntry: (id: ID, data: Partial<TimeEntry>) => void;
  deleteTimeEntry: (id: ID) => void;
  submitTimeCorrectionRequest: (payload: {
    employeeId?: ID;
    timeEntryId?: ID;
    requestType: TimeCorrectionRequest['requestType'];
    requestedClockInAt?: string;
    requestedClockOutAt?: string;
    requestedJobId?: ID;
    requestedActivityType?: TimeCorrectionRequest['requestedActivityType'];
    requestedUnbillableCategoryId?: ID;
    requestedSegments?: TimeCorrectionRequest['requestedSegments'];
    reason: string;
  }) => Promise<{ ok: boolean; error?: string; correction?: TimeCorrectionRequest }>;
  approveTimeCorrectionRequest: (id: ID, reviewNote?: string) => Promise<{ ok: boolean; error?: string; correction?: TimeCorrectionRequest }>;
  rejectTimeCorrectionRequest: (id: ID, reviewNote?: string) => Promise<{ ok: boolean; error?: string; correction?: TimeCorrectionRequest }>;

  // Budget
  addBudget: (budget: Omit<Budget, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Budget | null>;
  updateBudget: (id: ID, data: Partial<Budget>) => void;
  deleteBudget: (id: ID) => void;
  addBudgetItem: (item: Omit<BudgetItem, 'id'>) => void;
  updateBudgetItem: (id: ID, data: Partial<BudgetItem>) => void;
  deleteBudgetItem: (id: ID) => void;
  addBudgetRate: (rate: Omit<BudgetRate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateBudgetRate: (id: ID, data: Partial<BudgetRate>) => void;
  deleteBudgetRate: (id: ID) => void;
  upsertLabourBudgetPlan: (plan: LabourBudgetPlan) => void;
  deleteLabourBudgetPlan: (id: ID) => void;
  upsertLabourHoursSalesGoal: (goal: LabourHoursSalesGoal) => void;
  deleteLabourHoursSalesGoal: (id: ID) => void;
  upsertRevenueSalesGoal: (goal: RevenueSalesGoal) => void;
  deleteRevenueSalesGoal: (id: ID) => void;

  // Forms
  addForm: (form: Omit<FormRecord, 'id' | 'createdAt' | 'updatedAt'>) => FormRecord;
  updateForm: (id: ID, data: Partial<FormRecord>) => void;
  deleteForm: (id: ID) => void;
  addFormField: (field: Omit<FormField, 'id'>) => FormField;
  updateFormField: (id: ID, data: Partial<FormField>) => void;
  deleteFormField: (id: ID) => void;
  addFormSubmission: (submission: Omit<FormSubmission, 'id'>) => FormSubmission;
  updateFormSubmission: (id: ID, data: Partial<FormSubmission>) => void;
  deleteFormSubmission: (id: ID) => void;
  upsertFormResponse: (response: FormResponse) => void;
  deleteFormResponse: (id: ID) => void;
}

export const useStore = create<AppState>()((set, get) => ({
  budgets: [],
      customers: [],
      estimates: [],
      templates: [],
      expenses: [],
      equipmentAssets: [],
      unbillableTimeCategories: [],
      materialCatalogItems: [],
      invoices: [],
      jobs: [],
      employees: [],
      timeEntries: [],
      timeCorrections: [],
      clockInInFlightEmployeeIds: [],
      clockOutInFlightEntryIds: [],
      budgetItems: [],
      budgetRates: [],
      labourBudgetPlans: [],
      labourHoursSalesGoals: [],
      revenueSalesGoals: [],
      forms: [],
      formFields: [],
      formSubmissions: [],
      formResponses: [],

      // ── CRM ──────────────────────────────────────────────────────────────
      addCustomer: (c) => {
        const previous = get().customers;
        const customer = { ...c, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({
          customers: [...s.customers, customer],
        }));

        void ensureOk(fetch(dataUrl('customers'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: customer }),
        })).catch((error: unknown) => {
          set({ customers: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Customer could not be saved.') });
        });
      },
      updateCustomer: (id, data) => {
        const previous = get().customers;
        const updatedAt = nowISO();
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === id ? { ...c, ...data, updatedAt } : c
          ),
        }));

        void ensureOk(fetch(dataUrl('customers', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ customers: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Customer changes could not be saved.') });
        });
      },
      deleteCustomer: (id) => {
        const previous = get().customers;
        set((s) => ({ customers: s.customers.filter((c) => c.id !== id) }));

        void ensureOk(fetch(dataUrl('customers', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ customers: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Customer could not be deleted.') });
        });
      },

      // ── Estimates ─────────────────────────────────────────────────────────
      addEstimate: (e) => {
        const previous = get().estimates;
        const estimate = { ...e, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({ estimates: [...s.estimates, estimate] }));

        void ensureOk(fetch(dataUrl('estimates'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: estimate }),
        })).catch((error: unknown) => {
          set({ estimates: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Estimate could not be saved.') });
        });

        return estimate.id;
      },
      updateEstimate: (id, data) => {
        const previous = get().estimates;
        const updatedAt = nowISO();
        set((s) => ({
          estimates: s.estimates.map((e) =>
            e.id === id ? { ...e, ...data, updatedAt } : e
          ),
        }));

        void ensureOk(fetch(dataUrl('estimates', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ estimates: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Estimate changes could not be saved.') });
        });
      },
      deleteEstimate: (id) => {
        const previous = get().estimates;
        set((s) => ({ estimates: s.estimates.filter((e) => e.id !== id) }));

        void ensureOk(fetch(dataUrl('estimates', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ estimates: previous });
          emitAppToast({ tone: 'error', message: 'Estimate could not be deleted.' });
        });
      },
      sendEstimate: (id) => {
        const previous = get().estimates;
        const sentAt = nowISO();
        const updatedAt = sentAt;
        set((s) => ({
          estimates: s.estimates.map((e) =>
            e.id === id ? { ...e, status: 'sent', sentAt, updatedAt } : e
          ),
        }));

        void ensureOk(fetch(dataUrl('estimates', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { status: 'sent', sentAt, updatedAt } }),
        })).catch(() => {
          set({ estimates: previous });
          emitAppToast({ tone: 'error', message: 'Estimate status could not be updated.' });
        });
      },
      convertEstimateToJob: async (estimateId, options) => {
        try {
          const response = await fetch('/api/estimates?action=convert-to-job', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              estimateId,
              title: options?.title,
              startDate: options?.startDate,
              endDate: options?.endDate,
            }),
          });

          const payload = (await response.json()) as {
            ok?: boolean;
            error?: string;
            convertedToJobId?: ID;
            job?: Job;
            estimate?: {
              id: ID;
              status: 'converted';
              convertedToJobId: ID;
              convertedAt?: string;
              updatedAt?: string;
            };
          };

          if (!response.ok || !payload?.ok || !payload.job || !payload.estimate) {
            const message = typeof payload?.error === 'string' && payload.error.trim()
              ? payload.error
              : 'Estimate could not be converted to a job.';
            return {
              ok: false,
              error: message,
              jobId: payload?.convertedToJobId,
            };
          }

          set((state) => ({
            ...state,
            jobs: [...state.jobs, payload.job as Job],
            estimates: state.estimates.map((estimate) => {
              if (estimate.id !== payload.estimate?.id) return estimate;
              return {
                ...estimate,
                status: 'converted',
                convertedToJobId: payload.estimate.convertedToJobId,
                convertedAt: payload.estimate.convertedAt,
                updatedAt: payload.estimate.updatedAt ?? estimate.updatedAt,
              };
            }),
          }));

          return { ok: true, jobId: payload.job.id };
        } catch (error: unknown) {
          return {
            ok: false,
            error: errorMessage(error, 'Estimate could not be converted to a job.'),
          };
        }
      },

      // ── Templates ─────────────────────────────────────────────────────────
      addTemplate: (t) => {
        const previous = get().templates;
        const template = { ...t, id: generateId(), createdAt: nowISO() };
        set((s) => ({
          templates: [...s.templates, template],
        }));

        void ensureOk(fetch(dataUrl('templates'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: template }),
        })).catch(() => {
          set({ templates: previous });
          emitAppToast({ tone: 'error', message: 'Template could not be saved.' });
        });
      },
      updateTemplate: (id, data) => {
        const previous = get().templates;
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, ...data } : t
          ),
        }));

        void ensureOk(fetch(dataUrl('templates', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data }),
        })).catch(() => {
          set({ templates: previous });
          emitAppToast({ tone: 'error', message: 'Template changes could not be saved.' });
        });
      },
      deleteTemplate: (id) => {
        const previous = get().templates;
        set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));

        void ensureOk(fetch(dataUrl('templates', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ templates: previous });
          emitAppToast({ tone: 'error', message: 'Template could not be deleted.' });
        });
      },

      // ── Invoices ─────────────────────────────────────────────────────────
      addInvoice: (i) => {
        const previous = get().invoices;
        const invoice = { ...i, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({ invoices: [invoice, ...s.invoices] }));

        void ensureOk(fetch(dataUrl('invoices'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: invoice }),
        })).catch((error: unknown) => {
          set({ invoices: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Invoice could not be saved.') });
        });
      },
      updateInvoice: (id, data) => {
        const previous = get().invoices;
        const updatedAt = nowISO();
        set((s) => ({
          invoices: s.invoices.map((invoice) =>
            invoice.id === id ? { ...invoice, ...data, updatedAt } : invoice
          ),
        }));

        void ensureOk(fetch(dataUrl('invoices', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ invoices: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Invoice changes could not be saved.') });
        });
      },
      deleteInvoice: (id) => {
        const previous = get().invoices;
        set((s) => ({ invoices: s.invoices.filter((invoice) => invoice.id !== id) }));

        void ensureOk(fetch(dataUrl('invoices', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ invoices: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Invoice could not be deleted.') });
        });
      },

      // ── Expenses ─────────────────────────────────────────────────────────
      addExpense: async (e) => {
        const expense = { ...e, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };

        try {
          await ensureOk(fetch(dataUrl('expenses'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: expense }),
          }));
          set((s) => ({ expenses: [expense, ...s.expenses] }));
          return { ok: true, expense };
        } catch (error: unknown) {
          const message = errorMessage(error, 'Expense could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      updateExpense: (id, data) => {
        const previous = get().expenses;
        const updatedAt = nowISO();
        set((s) => ({
          expenses: s.expenses.map((expense) =>
            expense.id === id ? { ...expense, ...data, updatedAt } : expense
          ),
        }));

        void ensureOk(fetch(dataUrl('expenses', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ expenses: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Expense changes could not be saved.') });
        });
      },
      deleteExpense: (id) => {
        const previous = get().expenses;
        set((s) => ({ expenses: s.expenses.filter((expense) => expense.id !== id) }));

        void ensureOk(fetch(dataUrl('expenses', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ expenses: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Expense could not be deleted.') });
        });
      },

      // ── Equipment ────────────────────────────────────────────────────────
      addEquipmentAsset: (e) => {
        const previous = get().equipmentAssets;
        const equipmentAsset = { ...e, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({ equipmentAssets: [equipmentAsset, ...s.equipmentAssets] }));

        void ensureOk(fetch(dataUrl('equipment-assets'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: equipmentAsset }),
        })).catch((error: unknown) => {
          set({ equipmentAssets: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Equipment asset could not be saved.') });
        });
      },
      updateEquipmentAsset: (id, data) => {
        const previous = get().equipmentAssets;
        const updatedAt = nowISO();
        set((s) => ({
          equipmentAssets: s.equipmentAssets.map((equipmentAsset) =>
            equipmentAsset.id === id ? { ...equipmentAsset, ...data, updatedAt } : equipmentAsset
          ),
        }));

        void ensureOk(fetch(dataUrl('equipment-assets', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ equipmentAssets: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Equipment changes could not be saved.') });
        });
      },
      deleteEquipmentAsset: (id) => {
        const previous = get().equipmentAssets;
        set((s) => ({ equipmentAssets: s.equipmentAssets.filter((equipmentAsset) => equipmentAsset.id !== id) }));

        void ensureOk(fetch(dataUrl('equipment-assets', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ equipmentAssets: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Equipment asset could not be deleted.') });
        });
      },

      // ── Unbillable Categories ───────────────────────────────────────────
      addUnbillableTimeCategory: (categoryInput) => {
        const previous = get().unbillableTimeCategories;
        const now = nowISO();
        const category: UnbillableTimeCategory = {
          ...categoryInput,
          id: generateId(),
          createdAt: now,
          updatedAt: now,
        };

        set((s) => ({
          unbillableTimeCategories: [...s.unbillableTimeCategories, category]
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        }));

        void ensureOk(fetch(dataUrl('unbillable-time-categories'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: category }),
        })).catch((error: unknown) => {
          set({ unbillableTimeCategories: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Category could not be saved.') });
        });
      },
      updateUnbillableTimeCategory: (id, data) => {
        const previous = get().unbillableTimeCategories;
        const updatedAt = nowISO();
        set((s) => ({
          unbillableTimeCategories: s.unbillableTimeCategories
            .map((item) => (item.id === id ? { ...item, ...data, updatedAt } : item))
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        }));

        void ensureOk(fetch(dataUrl('unbillable-time-categories', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ unbillableTimeCategories: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Category changes could not be saved.') });
        });
      },
      archiveUnbillableTimeCategory: (id) => {
        get().updateUnbillableTimeCategory(id, { active: false });
      },

      // ── Material Catalog ─────────────────────────────────────────────────
      addMaterialCatalogItem: (item) => {
        const previous = get().materialCatalogItems;
        const materialCatalogItem = { ...item, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({ materialCatalogItems: [materialCatalogItem, ...s.materialCatalogItems] }));

        void ensureOk(fetch(dataUrl('material-catalog-items'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: materialCatalogItem }),
        })).catch((error: unknown) => {
          set({ materialCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Material catalog item could not be saved.') });
        });
      },
      updateMaterialCatalogItem: (id, data) => {
        const previous = get().materialCatalogItems;
        const updatedAt = nowISO();
        set((s) => ({
          materialCatalogItems: s.materialCatalogItems.map((item) =>
            item.id === id ? { ...item, ...data, updatedAt } : item
          ),
        }));

        void ensureOk(fetch(dataUrl('material-catalog-items', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ materialCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Material catalog changes could not be saved.') });
        });
      },
      deleteMaterialCatalogItem: (id) => {
        const previous = get().materialCatalogItems;
        set((s) => ({ materialCatalogItems: s.materialCatalogItems.filter((item) => item.id !== id) }));

        void ensureOk(fetch(dataUrl('material-catalog-items', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ materialCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Material catalog item could not be deleted.') });
        });
      },

      // ── Jobs ──────────────────────────────────────────────────────────────
      addJob: (j) => {
        const previous = get().jobs;
        const job = { ...j, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({
          jobs: [...s.jobs, job],
        }));

        void ensureOk(fetch(dataUrl('jobs'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: job }),
        })).catch(() => {
          set({ jobs: previous });
          emitAppToast({ tone: 'error', message: 'Job could not be saved.' });
        });
      },
      updateJob: (id, data) => {
        const previous = get().jobs;
        const updatedAt = nowISO();
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id ? { ...j, ...data, updatedAt } : j
          ),
        }));

        void ensureOk(fetch(dataUrl('jobs', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch(() => {
          set({ jobs: previous });
          emitAppToast({ tone: 'error', message: 'Job changes could not be saved.' });
        });
      },
      deleteJob: (id) => {
        const previous = get().jobs;
        set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));

        void ensureOk(fetch(dataUrl('jobs', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ jobs: previous });
          emitAppToast({ tone: 'error', message: 'Job could not be deleted.' });
        });
      },
      addCostEntry: (jobId, entry) => {
        const previous = get().jobs;
        const id = generateId();
        const updatedAt = nowISO();
        let nextJob: Job | null = null;

        set((s) => ({
          jobs: s.jobs.map((j) => {
            if (j.id !== jobId) return j;

            nextJob = {
              ...j,
              actualCosts: [...j.actualCosts, { ...entry, id }],
              updatedAt,
            };

            return nextJob;
          }),
        }));

        if (!nextJob) return;

        void ensureOk(fetch(dataUrl('jobs', jobId), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: nextJob }),
        })).catch(() => {
          set({ jobs: previous });
          emitAppToast({ tone: 'error', message: 'Cost entry could not be saved.' });
        });
      },

      // ── Employees ─────────────────────────────────────────────────────────
      addEmployee: (e) => {
        const previous = get().employees;
        const employee = { ...e, id: generateId(), createdAt: nowISO() };
        set((s) => ({ employees: [...s.employees, employee] }));

        void ensureOk(fetch(dataUrl('employees'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: employee }),
        })).catch(() => {
          set({ employees: previous });
          emitAppToast({ tone: 'error', message: 'Employee could not be saved.' });
        });
      },
      updateEmployee: (id, data) => {
        const previous = get().employees;
        set((s) => ({
          employees: s.employees.map((e) =>
            e.id === id ? { ...e, ...data } : e
          ),
        }));

        void ensureOk(fetch(dataUrl('employees', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data }),
        })).catch(() => {
          set({ employees: previous });
          emitAppToast({ tone: 'error', message: 'Employee changes could not be saved.' });
        });
      },
      deleteEmployee: (id) => {
        const previous = get().employees;
        set((s) => ({ employees: s.employees.filter((e) => e.id !== id) }));

        void ensureOk(fetch(dataUrl('employees', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ employees: previous });
          emitAppToast({ tone: 'error', message: 'Employee could not be deleted.' });
        });
      },

      // ── Time Entries ──────────────────────────────────────────────────────
      clockIn: async (employeeId, options) => {
        if (get().clockInInFlightEmployeeIds.includes(employeeId)) {
          return { ok: false, error: 'Clock-in already in progress.' };
        }

        const workType = options.workType;
        const requestedUnbillableCategoryId = typeof options.unbillableCategoryId === 'string'
          ? options.unbillableCategoryId.trim()
          : '';
        const selectedJobIds = Array.isArray(options.jobIds)
          ? options.jobIds.filter((value, index, all) => !!value && all.indexOf(value) === index)
          : [];

        if (workType === 'job' && selectedJobIds.length === 0) {
          const message = 'Select at least one job to clock in.';
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }

        if (workType === 'non_billable') {
          const activeCategories = get().unbillableTimeCategories.filter((item) => item.active);
          if (activeCategories.length === 0) {
            const message = 'No active unbillable categories are configured.';
            emitAppToast({ tone: 'error', message });
            return { ok: false, error: message };
          }

          if (!requestedUnbillableCategoryId || !activeCategories.some((item) => item.id === requestedUnbillableCategoryId)) {
            const message = 'Select an active unbillable category to clock in.';
            emitAppToast({ tone: 'error', message });
            return { ok: false, error: message };
          }
        }

        set((state) => ({
          clockInInFlightEmployeeIds: [...state.clockInInFlightEmployeeIds, employeeId],
        }));

        const requestId = `${employeeId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const idempotencyKey = `${employeeId}:${requestId}`;

        try {
          const response = await fetch('/api/clocking?action=clock-in', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              employeeId,
              workType,
              jobIds: workType === 'job' ? selectedJobIds : [],
              unbillableCategoryId: workType === 'non_billable' ? requestedUnbillableCategoryId : undefined,
              requestId,
              idempotencyKey,
            }),
          });

          const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; timeEntry?: TimeEntry } | null;
          if (!response.ok || !payload?.ok || !payload.timeEntry) {
            const message = payload?.error ?? `Clock-in failed (HTTP ${response.status}).`;
            emitAppToast({ tone: 'error', message });
            return { ok: false, error: message };
          }

          const incoming = payload.timeEntry;
          set((state) => ({
            timeEntries: [
              ...state.timeEntries.filter((entry) => (
                entry.id !== incoming.id
                && !(entry.employeeId === incoming.employeeId && entry.status === 'clocked_in')
              )),
              incoming,
            ],
          }));

          return { ok: true, timeEntry: incoming };
        } catch (error) {
          const message = errorMessage(error, 'Clock-in could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        } finally {
          set((state) => ({
            clockInInFlightEmployeeIds: state.clockInInFlightEmployeeIds.filter((id) => id !== employeeId),
          }));
        }
      },
      clockOut: async (entryId, breakMinutes = 0, notes = '', photoAttachmentFileId = '') => {
        const begin = beginClockOutSubmission(get().clockOutInFlightEntryIds, entryId);
        if (!begin.allowed) {
          return { ok: false, error: 'Clock-out already in progress.' };
        }

        const previous = get().timeEntries;
        const clockOutAt = nowISO();
        const normalizedPhotoAttachmentFileId = typeof photoAttachmentFileId === 'string' ? photoAttachmentFileId.trim() : '';

        set({ clockOutInFlightEntryIds: begin.nextInFlightEntryIds });

        set((s) => ({
          timeEntries: s.timeEntries.map((te) =>
            te.id === entryId
              ? {
                  ...te,
                  clockOut: clockOutAt,
                  breakMinutes,
                  notes,
                  photoAttachmentFileId: normalizedPhotoAttachmentFileId || te.photoAttachmentFileId,
                  clockOutPhotoFileId: normalizedPhotoAttachmentFileId || te.clockOutPhotoFileId || te.photoAttachmentFileId,
                  status: 'clocked_out',
                }
              : te
          ),
        }));

        const { requestId, idempotencyKey } = createClockOutRequestMeta(entryId);

        try {
          await ensureOk(fetch('/api/clocking?action=clock-out', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              entryId,
              breakMinutes,
              notes,
              requestId,
              idempotencyKey,
              ...(normalizedPhotoAttachmentFileId ? { photoAttachmentFileId: normalizedPhotoAttachmentFileId } : {}),
            }),
          }));
          return { ok: true };
        } catch (error) {
          set({ timeEntries: previous });
          const message = errorMessage(error, 'Clock-out could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        } finally {
          set((state) => ({
            clockOutInFlightEntryIds: endClockOutSubmission(state.clockOutInFlightEntryIds, entryId),
          }));
        }
      },
      addTimeEntry: (e) => {
        const previous = get().timeEntries;
        const timeEntry: TimeEntry = { ...e, id: generateId() };
        set((s) => ({ timeEntries: [...s.timeEntries, timeEntry] }));

        void ensureOk(fetch(dataUrl('time-entries'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: timeEntry }),
        })).catch(() => {
          set({ timeEntries: previous });
          emitAppToast({ tone: 'error', message: 'Time entry could not be saved.' });
        });
      },
      updateTimeEntry: (id, data) => {
        const previous = get().timeEntries;
        set((s) => ({
          timeEntries: s.timeEntries.map((te) =>
            te.id === id ? { ...te, ...data } : te
          ),
        }));

        void ensureOk(fetch(dataUrl('time-entries', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data }),
        })).catch(() => {
          set({ timeEntries: previous });
          emitAppToast({ tone: 'error', message: 'Time entry could not be updated.' });
        });
      },
      deleteTimeEntry: (id) => {
        const previous = get().timeEntries;
        set((s) => ({ timeEntries: s.timeEntries.filter((te) => te.id !== id) }));

        void ensureOk(fetch(dataUrl('time-entries', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ timeEntries: previous });
          emitAppToast({ tone: 'error', message: 'Time entry could not be deleted.' });
        });
      },
      submitTimeCorrectionRequest: async (payload) => {
        try {
          const response = await fetch('/api/time-corrections?action=create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(payload),
          });

          const body = await response.json().catch(() => null) as {
            ok?: boolean;
            error?: string;
            correction?: TimeCorrectionRequest;
          } | null;

          if (!response.ok || !body?.ok || !body.correction) {
            return {
              ok: false,
              error: body?.error ?? `Could not submit correction request (HTTP ${response.status}).`,
            };
          }

          set((state) => ({
            timeCorrections: [...state.timeCorrections, body.correction as TimeCorrectionRequest],
          }));

          return { ok: true, correction: body.correction };
        } catch (error: unknown) {
          return {
            ok: false,
            error: errorMessage(error, 'Could not submit correction request.'),
          };
        }
      },
      approveTimeCorrectionRequest: async (id, reviewNote = '') => {
        try {
          const response = await fetch('/api/time-corrections?action=approve', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ id, reviewNote }),
          });

          const body = await response.json().catch(() => null) as {
            ok?: boolean;
            error?: string;
            correction?: TimeCorrectionRequest;
            createdTimeEntry?: TimeEntry;
          } | null;

          if (!response.ok || !body?.ok || !body.correction) {
            return {
              ok: false,
              error: body?.error ?? `Could not approve correction request (HTTP ${response.status}).`,
            };
          }

          set((state) => ({
            timeCorrections: state.timeCorrections.map((item) => (
              item.id === id ? (body.correction as TimeCorrectionRequest) : item
            )),
            timeEntries: body.createdTimeEntry
              ? [...state.timeEntries, body.createdTimeEntry]
              : state.timeEntries,
          }));

          return { ok: true, correction: body.correction };
        } catch (error: unknown) {
          return {
            ok: false,
            error: errorMessage(error, 'Could not approve correction request.'),
          };
        }
      },
      rejectTimeCorrectionRequest: async (id, reviewNote = '') => {
        try {
          const response = await fetch('/api/time-corrections?action=reject', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ id, reviewNote }),
          });

          const body = await response.json().catch(() => null) as {
            ok?: boolean;
            error?: string;
            correction?: TimeCorrectionRequest;
          } | null;

          if (!response.ok || !body?.ok || !body.correction) {
            return {
              ok: false,
              error: body?.error ?? `Could not reject correction request (HTTP ${response.status}).`,
            };
          }

          set((state) => ({
            timeCorrections: state.timeCorrections.map((item) => (
              item.id === id ? (body.correction as TimeCorrectionRequest) : item
            )),
          }));

          return { ok: true, correction: body.correction };
        } catch (error: unknown) {
          return {
            ok: false,
            error: errorMessage(error, 'Could not reject correction request.'),
          };
        }
      },

      // ── Forms ─────────────────────────────────────────────────────────────
      addForm: (formInput) => {
        const previous = get().forms;
        const form = {
          ...formInput,
          id: generateId(),
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        set((state) => ({ forms: [...state.forms, form] }));

        void ensureOk(fetch(dataUrl('forms'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: form }),
        })).catch((error: unknown) => {
          set({ forms: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form could not be saved.') });
        });

        return form;
      },
      updateForm: (id, data) => {
        const previous = get().forms;
        const updatedAt = nowISO();
        set((state) => ({
          forms: state.forms.map((form) => (form.id === id ? { ...form, ...data, updatedAt } : form)),
        }));

        void ensureOk(fetch(dataUrl('forms', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ forms: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form changes could not be saved.') });
        });
      },
      deleteForm: (id) => {
        const previousForms = get().forms;
        const previousFields = get().formFields;
        const previousSubmissions = get().formSubmissions;
        const previousResponses = get().formResponses;
        const submissionIds = previousSubmissions.filter((submission) => submission.formId === id).map((submission) => submission.id);

        set((state) => ({
          forms: state.forms.filter((form) => form.id !== id),
          formFields: state.formFields.filter((field) => field.formId !== id),
          formSubmissions: state.formSubmissions.filter((submission) => submission.formId !== id),
          formResponses: state.formResponses.filter((response) => !submissionIds.includes(response.submissionId)),
        }));

        void ensureOk(fetch(dataUrl('forms', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({
            forms: previousForms,
            formFields: previousFields,
            formSubmissions: previousSubmissions,
            formResponses: previousResponses,
          });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form could not be deleted.') });
        });
      },
      addFormField: (fieldInput) => {
        const previous = get().formFields;
        const field = {
          ...fieldInput,
          id: generateId(),
        };
        set((state) => ({ formFields: [...state.formFields, field] }));

        void ensureOk(fetch(dataUrl('form-fields'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: field }),
        })).catch((error: unknown) => {
          set({ formFields: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form field could not be saved.') });
        });

        return field;
      },
      updateFormField: (id, data) => {
        const previous = get().formFields;
        set((state) => ({
          formFields: state.formFields.map((field) => (field.id === id ? { ...field, ...data } : field)),
        }));

        void ensureOk(fetch(dataUrl('form-fields', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data }),
        })).catch((error: unknown) => {
          set({ formFields: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form field could not be updated.') });
        });
      },
      deleteFormField: (id) => {
        const previous = get().formFields;
        set((state) => ({ formFields: state.formFields.filter((field) => field.id !== id) }));

        void ensureOk(fetch(dataUrl('form-fields', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ formFields: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form field could not be deleted.') });
        });
      },
      addFormSubmission: (submissionInput) => {
        const previous = get().formSubmissions;
        const submission = {
          ...submissionInput,
          id: generateId(),
        };
        set((state) => ({ formSubmissions: [...state.formSubmissions, submission] }));

        void ensureOk(fetch(dataUrl('form-submissions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: submission }),
        })).catch((error: unknown) => {
          set({ formSubmissions: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form submission could not be saved.') });
        });

        return submission;
      },
      updateFormSubmission: (id, data) => {
        const previous = get().formSubmissions;
        set((state) => ({
          formSubmissions: state.formSubmissions.map((submission) => (submission.id === id ? { ...submission, ...data } : submission)),
        }));

        void ensureOk(fetch(dataUrl('form-submissions', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data }),
        })).catch((error: unknown) => {
          set({ formSubmissions: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form submission could not be updated.') });
        });
      },
      deleteFormSubmission: (id) => {
        const previousSubmissions = get().formSubmissions;
        const previousResponses = get().formResponses;
        set((state) => ({
          formSubmissions: state.formSubmissions.filter((submission) => submission.id !== id),
          formResponses: state.formResponses.filter((response) => response.submissionId !== id),
        }));

        void ensureOk(fetch(dataUrl('form-submissions', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ formSubmissions: previousSubmissions, formResponses: previousResponses });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form submission could not be deleted.') });
        });
      },
      upsertFormResponse: (response) => {
        const previous = get().formResponses;
        const exists = previous.some((value) => value.id === response.id);
        set((state) => ({
          formResponses: exists
            ? state.formResponses.map((value) => (value.id === response.id ? { ...value, ...response } : value))
            : [...state.formResponses, response],
        }));

        const method = exists ? 'PATCH' : 'POST';
        const url = exists ? dataUrl('form-responses', response.id) : dataUrl('form-responses');

        void ensureOk(fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: response }),
        })).catch((error: unknown) => {
          set({ formResponses: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form response could not be saved.') });
        });
      },
      deleteFormResponse: (id) => {
        const previous = get().formResponses;
        set((state) => ({ formResponses: state.formResponses.filter((response) => response.id !== id) }));

        void ensureOk(fetch(dataUrl('form-responses', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ formResponses: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form response could not be deleted.') });
        });
      },

      // ── Budget ────────────────────────────────────────────────────────────
      addBudget: async (budgetInput) => {
        const previous = get().budgets;
        const budget = {
          ...budgetInput,
          id: generateId(),
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        set((s) => ({ budgets: [...s.budgets, budget] }));

        try {
          await ensureOk(fetch(dataUrl('budgets'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: budget }),
          }));

          return budget;
        } catch (error: unknown) {
          set({ budgets: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget could not be saved.') });
          return null;
        }
      },
      updateBudget: (id, data) => {
        const previous = get().budgets;
        const updatedAt = nowISO();
        set((s) => ({
          budgets: s.budgets.map((budget) => (budget.id === id ? { ...budget, ...data, updatedAt } : budget)),
        }));

        void ensureOk(fetch(dataUrl('budgets', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ budgets: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget changes could not be saved.') });
        });
      },
      deleteBudget: (id) => {
        const previous = get().budgets;
        // TODO: Cascade-delete budget-scoped records (budgetItems/labour plans/revenue goals) when budget deletion UX is added.
        set((s) => ({ budgets: s.budgets.filter((budget) => budget.id !== id) }));

        void ensureOk(fetch(dataUrl('budgets', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ budgets: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget could not be deleted.') });
        });
      },
      addBudgetItem: (item) => {
        const previous = get().budgetItems;
        const budgetItem = { ...item, id: generateId() };
        set((s) => ({ budgetItems: [...s.budgetItems, budgetItem] }));

        void ensureOk(fetch(dataUrl('budget'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: budgetItem }),
        })).catch(() => {
          set({ budgetItems: previous });
          emitAppToast({ tone: 'error', message: 'Budget item could not be saved.' });
        });
      },
      updateBudgetItem: (id, data) => {
        const previous = get().budgetItems;
        set((s) => ({
          budgetItems: s.budgetItems.map((b) =>
            b.id === id ? { ...b, ...data } : b
          ),
        }));

        void ensureOk(fetch(dataUrl('budget', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data }),
        })).catch(() => {
          set({ budgetItems: previous });
          emitAppToast({ tone: 'error', message: 'Budget changes could not be saved.' });
        });
      },
      deleteBudgetItem: (id) => {
        const previous = get().budgetItems;
        set((s) => ({ budgetItems: s.budgetItems.filter((b) => b.id !== id) }));

        void ensureOk(fetch(dataUrl('budget', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ budgetItems: previous });
          emitAppToast({ tone: 'error', message: 'Budget item could not be deleted.' });
        });
      },
      addBudgetRate: (rateInput) => {
        const previous = get().budgetRates;
        const budgetRate = {
          ...rateInput,
          id: generateId(),
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        set((s) => ({ budgetRates: [...s.budgetRates, budgetRate] }));

        void ensureOk(fetch(dataUrl('budget-rates'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: budgetRate }),
        })).catch((error: unknown) => {
          set({ budgetRates: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget rate could not be saved.') });
        });
      },
      updateBudgetRate: (id, data) => {
        const previous = get().budgetRates;
        const updatedAt = nowISO();
        set((s) => ({
          budgetRates: s.budgetRates.map((rate) => (
            rate.id === id ? { ...rate, ...data, updatedAt } : rate
          )),
        }));

        void ensureOk(fetch(dataUrl('budget-rates', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        })).catch((error: unknown) => {
          set({ budgetRates: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget rate changes could not be saved.') });
        });
      },
      deleteBudgetRate: (id) => {
        const previous = get().budgetRates;
        set((s) => ({ budgetRates: s.budgetRates.filter((rate) => rate.id !== id) }));

        void ensureOk(fetch(dataUrl('budget-rates', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch((error: unknown) => {
          set({ budgetRates: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget rate could not be deleted.') });
        });
      },
      upsertLabourBudgetPlan: (plan) => {
        const previous = get().labourBudgetPlans;
        const exists = previous.some((value) => value.id === plan.id);

        set((state) => ({
          labourBudgetPlans: exists
            ? state.labourBudgetPlans.map((value) => (value.id === plan.id ? { ...value, ...plan } : value))
            : [...state.labourBudgetPlans, plan],
        }));

        const method = exists ? 'PATCH' : 'POST';
        const url = exists ? dataUrl('labour-budget-plans', plan.id) : dataUrl('labour-budget-plans');

        void ensureOk(fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: exists ? plan : plan }),
        })).catch(() => {
          set({ labourBudgetPlans: previous });
          emitAppToast({ tone: 'error', message: 'Labour planner could not be saved.' });
        });
      },
      deleteLabourBudgetPlan: (id) => {
        const previous = get().labourBudgetPlans;
        set((state) => ({ labourBudgetPlans: state.labourBudgetPlans.filter((plan) => plan.id !== id) }));

        void ensureOk(fetch(dataUrl('labour-budget-plans', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ labourBudgetPlans: previous });
          emitAppToast({ tone: 'error', message: 'Labour planner could not be deleted.' });
        });
      },
      upsertLabourHoursSalesGoal: (goal) => {
        const previous = get().labourHoursSalesGoals;
        const exists = previous.some((value) => value.id === goal.id);

        set((state) => ({
          labourHoursSalesGoals: exists
            ? state.labourHoursSalesGoals.map((value) => (value.id === goal.id ? { ...value, ...goal } : value))
            : [...state.labourHoursSalesGoals, goal],
        }));

        const method = exists ? 'PATCH' : 'POST';
        const url = exists ? dataUrl('labour-hours-sales-goals', goal.id) : dataUrl('labour-hours-sales-goals');

        void ensureOk(fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: goal }),
        })).catch(() => {
          set({ labourHoursSalesGoals: previous });
          emitAppToast({ tone: 'error', message: 'Labour hours sales goal could not be saved.' });
        });
      },
      deleteLabourHoursSalesGoal: (id) => {
        const previous = get().labourHoursSalesGoals;
        set((state) => ({ labourHoursSalesGoals: state.labourHoursSalesGoals.filter((goal) => goal.id !== id) }));

        void ensureOk(fetch(dataUrl('labour-hours-sales-goals', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ labourHoursSalesGoals: previous });
          emitAppToast({ tone: 'error', message: 'Labour hours sales goal could not be deleted.' });
        });
      },
      upsertRevenueSalesGoal: (goal) => {
        const previous = get().revenueSalesGoals;
        const exists = previous.some((value) => value.id === goal.id);

        set((state) => ({
          revenueSalesGoals: exists
            ? state.revenueSalesGoals.map((value) => (value.id === goal.id ? { ...value, ...goal } : value))
            : [...state.revenueSalesGoals, goal],
        }));

        const method = exists ? 'PATCH' : 'POST';
        const url = exists ? dataUrl('revenue-sales-goals', goal.id) : dataUrl('revenue-sales-goals');

        void ensureOk(fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: goal }),
        })).catch(() => {
          set({ revenueSalesGoals: previous });
          emitAppToast({ tone: 'error', message: 'Revenue sales goal could not be saved.' });
        });
      },
      deleteRevenueSalesGoal: (id) => {
        const previous = get().revenueSalesGoals;
        set((state) => ({ revenueSalesGoals: state.revenueSalesGoals.filter((goal) => goal.id !== id) }));

        void ensureOk(fetch(dataUrl('revenue-sales-goals', id), {
          method: 'DELETE',
          credentials: 'include',
        })).catch(() => {
          set({ revenueSalesGoals: previous });
          emitAppToast({ tone: 'error', message: 'Revenue sales goal could not be deleted.' });
        });
      },
    }));
