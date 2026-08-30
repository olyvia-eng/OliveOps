import { create } from 'zustand';
import type {
  Budget,
  BudgetDivision,
  BudgetDivisionPlanningItem,
  BudgetGroup,
  BudgetRate,
  FormField,
  FormRecord,
  FormResponse,
  FormSubmission,
  Customer,
  Estimate,
  EstimateTemplate,
  EquipmentAsset,
  EquipmentBudgetAllocation,
  Expense,
  Invoice,
  Job,
  JobPlanMutation,
  JobTaskHeading,
  Employee,
  UnbillableTimeCategory,
  TimeEntry,
  TimeEntryWorkType,
  MaterialCatalogItem,
  SubcontractorCatalogItem,
  BudgetItem,
  LabourBudgetPlan,
  LabourHoursSalesGoal,
  LabourClass,
  RevenueSalesGoal,
  TimeCorrectionRequest,
  Task,
  CostEntry,
  Crew,
  Division,
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
import { nextEstimateUpdatedAtModel, shouldApplySequencedResponseModel } from '../utils/estimatePersistenceState.js';
import { shouldApplyBudgetResponseModel } from '../utils/budgetPersistenceState.js';

const estimateMutationSequences = new Map<ID, number>();
const budgetMutationSequences = new Map<ID, number>();
const budgetDivisionMutationSequences = new Map<ID, number>();

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
  return response;
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
  budgetDivisions: BudgetDivision[];
  budgetDivisionPlanningItems: BudgetDivisionPlanningItem[];
  budgetGroups: BudgetGroup[];
  equipmentBudgetAllocations: EquipmentBudgetAllocation[];
  crews: Crew[];
  divisions: Division[];
  customers: Customer[];
  estimates: Estimate[];
  templates: EstimateTemplate[];
  expenses: Expense[];
  equipmentAssets: EquipmentAsset[];
  unbillableTimeCategories: UnbillableTimeCategory[];
  materialCatalogItems: MaterialCatalogItem[];
  subcontractorCatalogItems: SubcontractorCatalogItem[];
  invoices: Invoice[];
  jobs: Job[];
  employees: Employee[];
  labourClasses: LabourClass[];
  timeEntries: TimeEntry[];
  timeCorrections: TimeCorrectionRequest[];
  tasks: Task[];
  jobTaskHeadings: JobTaskHeading[];
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
  addEstimate: (e: Omit<Estimate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ID | null>;
  updateEstimate: (id: ID, data: Partial<Estimate>) => Promise<Estimate | null>;
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
  addEquipmentAsset: (e: Omit<EquipmentAsset, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ ok: boolean; id?: ID }>;
  updateEquipmentAsset: (id: ID, data: Partial<EquipmentAsset>) => void;
  deleteEquipmentAsset: (id: ID) => void;
  addUnbillableTimeCategory: (category: Omit<UnbillableTimeCategory, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateUnbillableTimeCategory: (id: ID, data: Partial<UnbillableTimeCategory>) => void;
  archiveUnbillableTimeCategory: (id: ID) => void;
  addMaterialCatalogItem: (item: Omit<MaterialCatalogItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<MaterialCatalogItem>;
  updateMaterialCatalogItem: (id: ID, data: Partial<MaterialCatalogItem>) => Promise<MaterialCatalogItem>;
  deleteMaterialCatalogItem: (id: ID) => void;
  addSubcontractorCatalogItem: (item: Omit<SubcontractorCatalogItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SubcontractorCatalogItem>;
  updateSubcontractorCatalogItem: (id: ID, data: Partial<SubcontractorCatalogItem>) => Promise<SubcontractorCatalogItem>;
  deleteSubcontractorCatalogItem: (id: ID) => void;

  // Jobs
  addJob: (j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateJob: (id: ID, data: Partial<Job>) => Promise<boolean>;
  initializeJobPlan: (id: ID) => Promise<{ ok: boolean; error?: string }>;
  mutateJobPlan: (id: ID, mutation: JobPlanMutation) => Promise<{ ok: boolean; error?: string }>;
  deleteJob: (id: ID) => void;
  addCostEntry: (jobId: ID, entry: Omit<CostEntry, 'id'>) => void;

  // Employees
  addEmployee: (e: Omit<Employee, 'id' | 'createdAt'>) => void;
  updateEmployee: (id: ID, data: Partial<Employee>) => void;
  deleteEmployee: (id: ID) => void;
  addLabourClass: (data: Pick<LabourClass, 'name' | 'description'>) => Promise<LabourClass | null>;
  updateLabourClass: (id: ID, data: Partial<LabourClass>) => Promise<LabourClass | null>;
  archiveLabourClass: (id: ID) => Promise<boolean>;
  applyLabourClassSetup: (input: {
    classes: Array<{ key: string; name: string }>;
    assignments: Array<{ employeeId: ID; classKey: string | null }>;
  }) => Promise<{ ok: boolean; error?: string }>;

  // Scheduling setup
  saveCrew: (crew: Omit<Crew, 'createdAt' | 'updatedAt'>) => Promise<{ ok: boolean; error?: string }>;
  saveDivision: (division: Omit<Division, 'normalizedName' | 'createdAt' | 'updatedAt'>) => Promise<{ ok: boolean; error?: string }>;

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

  // Tasks
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ ok: boolean; task?: Task; error?: string }>;
  updateTask: (id: ID, data: Partial<Task>) => Promise<{ ok: boolean; task?: Task; error?: string }>;
  completeTask: (id: ID) => Promise<{ ok: boolean; task?: Task; error?: string }>;
  deleteTask: (id: ID) => Promise<{ ok: boolean; error?: string }>;
  addJobTaskHeading: (jobId: ID, name: string) => Promise<{ ok: boolean; heading?: JobTaskHeading; error?: string }>;
  renameJobTaskHeading: (jobId: ID, id: ID, name: string) => Promise<{ ok: boolean; error?: string }>;
  deleteJobTaskHeading: (jobId: ID, id: ID) => Promise<{ ok: boolean; movedTaskCount?: number; error?: string }>;
  reorderJobTaskHeadings: (jobId: ID, orderedIds: ID[]) => Promise<{ ok: boolean; error?: string }>;

  // Budget
  addBudget: (budget: Omit<Budget, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Budget | null>;
  updateBudget: (id: ID, data: Partial<Budget>) => Promise<Budget | null>;
  deleteBudget: (id: ID) => Promise<{ ok: boolean; code?: string; error?: string; dependencies?: { estimates: number } }>;
  addBudgetDivision: (division: Omit<BudgetDivision, 'id' | 'createdAt' | 'updatedAt'>) => Promise<BudgetDivision | null>;
  updateBudgetDivision: (budgetId: ID, id: ID, data: Partial<BudgetDivision>) => Promise<BudgetDivision | null>;
  addBudgetDivisionPlanningItem: (input: Omit<BudgetDivisionPlanningItem, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt'>) => Promise<BudgetDivisionPlanningItem | null>;
  updateBudgetDivisionPlanningItem: (item: BudgetDivisionPlanningItem, data: Partial<BudgetDivisionPlanningItem>) => Promise<BudgetDivisionPlanningItem | null>;
  saveBudgetEquipmentPlanningItem: (input: {
    planningItem: Omit<BudgetDivisionPlanningItem, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt'> | Partial<BudgetDivisionPlanningItem>;
    existingItem?: BudgetDivisionPlanningItem;
    catalogPatch: Pick<EquipmentAsset, 'name' | 'type' | 'equipmentClassification' | 'costType'>;
    createEquipmentAsset: boolean;
  }) => Promise<BudgetDivisionPlanningItem | null>;
  deleteBudgetDivisionPlanningItem: (item: BudgetDivisionPlanningItem) => Promise<boolean>;
  reorderBudgetDivisionPlanningItems: (budgetId: ID, divisionId: ID, category: BudgetDivisionPlanningItem['category'], orderedIds: ID[]) => Promise<boolean>;
  migrateLegacyBudgetOverhead: (budgetId: ID) => Promise<boolean>;
  importBudgetDivisionPlanningItems: (input: { budgetId: ID; divisionId: ID; category: BudgetDivisionPlanningItem['category']; sourceBudgetId: ID; sourceDivisionId: ID; sourceItemIds: ID[] }) => Promise<{ ok: boolean; importedCount: number; skippedCount: number; error?: string }>;
  saveBudgetGroup: (group: Omit<BudgetGroup, 'createdAt' | 'updatedAt'>, confirmAllocationMove?: boolean) => Promise<{ ok: boolean; requiresConfirmation?: boolean; error?: string }>;
  dissolveBudgetGroup: (id: ID) => Promise<boolean>;
  refreshBudgetGroups: () => Promise<void>;
  addBudgetItem: (item: Omit<BudgetItem, 'id'>, allocationMonths?: number) => Promise<BudgetItem | null>;
  updateBudgetItem: (id: ID, data: Partial<BudgetItem>, allocationMonths?: number) => Promise<boolean>;
  deleteBudgetItem: (id: ID) => Promise<boolean>;
  saveGroupedEquipmentAllocations: (input: {
    budgetId: ID;
    equipmentId: ID;
    annualCost: number;
    allocations: Array<{ budgetId: ID; budgetItemId: ID; monthsAllocated: number }>;
  }) => Promise<{ ok: boolean; error?: string }>;
  reorderBudgetEquipment: (budgetId: ID, orderedIds: ID[]) => Promise<boolean>;
  addBudgetRate: (rate: Omit<BudgetRate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<BudgetRate>;
  updateBudgetRate: (id: ID, data: Partial<BudgetRate>) => Promise<BudgetRate>;
  deleteBudgetRate: (id: ID) => void;
  upsertLabourBudgetPlan: (plan: LabourBudgetPlan) => Promise<boolean>;
  deleteLabourBudgetPlan: (id: ID) => Promise<boolean>;
  upsertLabourHoursSalesGoal: (goal: LabourHoursSalesGoal) => void;
  deleteLabourHoursSalesGoal: (id: ID) => void;
  upsertRevenueSalesGoal: (goal: RevenueSalesGoal) => void;
  deleteRevenueSalesGoal: (id: ID) => void;

  // Forms
  addForm: (form: Omit<FormRecord, 'id' | 'createdAt' | 'updatedAt'>) => FormRecord;
  updateForm: (id: ID, data: Partial<FormRecord>) => Promise<boolean>;
  deleteForm: (id: ID) => void;
  addFormField: (field: Omit<FormField, 'id'> & { id?: ID }) => Promise<FormField | null>;
  updateFormField: (id: ID, data: Partial<FormField>) => Promise<boolean>;
  deleteFormField: (id: ID) => Promise<boolean>;
  addFormSubmission: (submission: Omit<FormSubmission, 'id'>) => FormSubmission;
  updateFormSubmission: (id: ID, data: Partial<FormSubmission>) => void;
  deleteFormSubmission: (id: ID) => void;
  upsertFormResponse: (response: FormResponse) => void;
  deleteFormResponse: (id: ID) => void;
}

export const useStore = create<AppState>()((set, get) => ({
  budgets: [],
  budgetDivisions: [],
  budgetDivisionPlanningItems: [],
      budgetGroups: [],
      equipmentBudgetAllocations: [],
      crews: [],
      divisions: [],
      customers: [],
      estimates: [],
      templates: [],
      expenses: [],
      equipmentAssets: [],
      unbillableTimeCategories: [],
      materialCatalogItems: [],
      subcontractorCatalogItems: [],
      invoices: [],
      jobs: [],
      employees: [],
      labourClasses: [],
      timeEntries: [],
      timeCorrections: [],
      tasks: [],
      jobTaskHeadings: [],
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
      addEstimate: async (e) => {
        const estimate = { ...e, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };

        try {
          const response = await fetch(dataUrl('estimates'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: estimate }),
          });
          if (!response.ok) {
            await ensureOk(Promise.resolve(response));
          }
          const payload = (await response.json()) as { ok?: boolean; estimate?: Estimate };
          if (!payload.ok || !payload.estimate) {
            throw new Error('Estimate creation response was incomplete.');
          }
          set((s) => ({ estimates: [...s.estimates, payload.estimate as Estimate] }));
          return payload.estimate.id;
        } catch (error: unknown) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Estimate could not be saved.') });
          return null;
        }
      },
      updateEstimate: async (id, data) => {
        const baseUpdatedAt = get().estimates.find((estimate) => estimate.id === id)?.updatedAt;
        const updatedAt = nextEstimateUpdatedAtModel(baseUpdatedAt);
        const requestSequence = (estimateMutationSequences.get(id) ?? 0) + 1;
        estimateMutationSequences.set(id, requestSequence);

        try {
          const response = await fetch(dataUrl('estimates', id), {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: { ...data, updatedAt }, baseUpdatedAt }),
          });
          if (!response.ok) {
            await ensureOk(Promise.resolve(response));
          }
          const payload = (await response.json()) as { ok?: boolean; estimate?: Estimate };
          if (!payload.ok || !payload.estimate) {
            throw new Error('Estimate update response was incomplete.');
          }
          if (!shouldApplySequencedResponseModel(requestSequence, estimateMutationSequences.get(id) ?? 0)) {
            return null;
          }
          set((state) => ({
            estimates: state.estimates.map((estimate) => (
              estimate.id === id ? payload.estimate as Estimate : estimate
            )),
          }));
          return payload.estimate;
        } catch (error: unknown) {
          if (shouldApplySequencedResponseModel(requestSequence, estimateMutationSequences.get(id) ?? 0)) {
            emitAppToast({ tone: 'error', message: errorMessage(error, 'Estimate changes could not be saved.') });
          }
          return null;
        }
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
      addEquipmentAsset: async (e) => {
        const previous = get().equipmentAssets;
        const equipmentAsset = { ...e, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({ equipmentAssets: [equipmentAsset, ...s.equipmentAssets] }));

        try {
          await ensureOk(fetch(dataUrl('equipment-assets'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: equipmentAsset }),
          }));
          return { ok: true, id: equipmentAsset.id };
        } catch (error: unknown) {
          set({ equipmentAssets: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Equipment asset could not be saved.') });
          return { ok: false };
        }
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
      addMaterialCatalogItem: async (item) => {
        const previous = get().materialCatalogItems;
        const materialCatalogItem = { ...item, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((s) => ({ materialCatalogItems: [materialCatalogItem, ...s.materialCatalogItems] }));

        try {
          await ensureOk(fetch(dataUrl('material-catalog-items'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: materialCatalogItem }),
          }));
          return materialCatalogItem;
        } catch (error: unknown) {
          set({ materialCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Material catalog item could not be saved.') });
          throw error;
        }
      },
      updateMaterialCatalogItem: async (id, data) => {
        const previous = get().materialCatalogItems;
        const updatedAt = nowISO();
        const material = previous.find((item) => item.id === id);
        if (!material) throw new Error('Material catalog item not found.');
        const updatedMaterial = { ...material, ...data, updatedAt };
        set((s) => ({
          materialCatalogItems: s.materialCatalogItems.map((item) =>
            item.id === id ? updatedMaterial : item
          ),
        }));

        try {
          await ensureOk(fetch(dataUrl('material-catalog-items', id), {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: { ...data, updatedAt } }),
          }));
          return updatedMaterial;
        } catch (error: unknown) {
          set({ materialCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Material catalog changes could not be saved.') });
          throw error;
        }
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

      addSubcontractorCatalogItem: async (item) => {
        const previous = get().subcontractorCatalogItems;
        const created = { ...item, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        set((state) => ({ subcontractorCatalogItems: [created, ...state.subcontractorCatalogItems] }));
        try {
          await ensureOk(fetch(dataUrl('subcontractor-catalog-items'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data: created }) }));
          return created;
        } catch (error) {
          set({ subcontractorCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Subcontractor could not be saved.') });
          throw error;
        }
      },
      updateSubcontractorCatalogItem: async (id, data) => {
        const previous = get().subcontractorCatalogItems;
        const current = previous.find((item) => item.id === id);
        if (!current) throw new Error('Subcontractor not found.');
        const updated = { ...current, ...data, updatedAt: nowISO() };
        set((state) => ({ subcontractorCatalogItems: state.subcontractorCatalogItems.map((item) => item.id === id ? updated : item) }));
        try {
          await ensureOk(fetch(dataUrl('subcontractor-catalog-items', id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data: { ...data, updatedAt: updated.updatedAt } }) }));
          return updated;
        } catch (error) {
          set({ subcontractorCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Subcontractor changes could not be saved.') });
          throw error;
        }
      },
      deleteSubcontractorCatalogItem: (id) => {
        const previous = get().subcontractorCatalogItems;
        set((state) => ({ subcontractorCatalogItems: state.subcontractorCatalogItems.filter((item) => item.id !== id) }));
        void ensureOk(fetch(dataUrl('subcontractor-catalog-items', id), { method: 'DELETE', credentials: 'include' })).catch((error) => {
          set({ subcontractorCatalogItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Subcontractor could not be deleted.') });
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
      updateJob: async (id, data) => {
        const previous = get().jobs;
        const updatedAt = nowISO();
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id ? { ...j, ...data, updatedAt } : j
          ),
        }));

        const request = fetch(dataUrl('jobs', id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ data: { ...data, updatedAt } }),
        });

        try {
          await ensureOk(request);
          return true;
        } catch (error: unknown) {
          set({ jobs: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Job changes could not be saved.') });
          return false;
        }
      },
      initializeJobPlan: async (id) => {
        try {
          const response = await fetch(`/api/job-plans?jobId=${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action: 'initialize' }),
          });
          const payload = await response.json() as { ok?: boolean; job?: Job; error?: string };
          if (!response.ok || !payload.ok || !payload.job) throw new Error(payload.error || 'Job planning could not be initialized.');
          set((state) => ({ jobs: state.jobs.map((job) => job.id === id ? payload.job as Job : job) }));
          return { ok: true };
        } catch (error: unknown) {
          const message = errorMessage(error, 'Job planning could not be initialized.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      mutateJobPlan: async (id, mutation) => {
        const current = get().jobs.find((job) => job.id === id);
        if (!current?.planningRevision) return { ok: false, error: 'Initialize Job planning before editing.' };
        try {
          const response = await fetch(`/api/job-plans?jobId=${encodeURIComponent(id)}`, {
            method: mutation.action === 'add-resource' ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ...mutation, expectedRevision: current.planningRevision }),
          });
          const payload = await response.json() as { ok?: boolean; plan?: Partial<Job>; error?: string };
          if (!response.ok || !payload.ok || !payload.plan) throw new Error(payload.error || 'Job planning could not be saved.');
          set((state) => ({ jobs: state.jobs.map((job) => job.id === id ? { ...job, ...payload.plan } : job) }));
          return { ok: true };
        } catch (error: unknown) {
          const message = errorMessage(error, 'Job planning could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
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
      addLabourClass: async (data) => {
        const instant = nowISO();
        const labourClass: LabourClass = { id: generateId(), name: data.name.trim(), description: data.description?.trim() ?? '', active: true, customRates: {}, createdAt: instant, updatedAt: instant };
        try {
          const response = await ensureOk(fetch(dataUrl('labour-classes'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data: labourClass }) }));
          const payload = await response.json() as { labourClass?: LabourClass };
          const saved = payload.labourClass ?? labourClass;
          set((state) => ({ labourClasses: [...state.labourClasses, saved] }));
          return saved;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Labour Class could not be saved.') });
          return null;
        }
      },
      updateLabourClass: async (id, data) => {
        try {
          const response = await ensureOk(fetch(dataUrl('labour-classes', id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data }) }));
          const payload = await response.json() as { labourClass?: LabourClass };
          if (!payload.labourClass) return null;
          set((state) => ({ labourClasses: state.labourClasses.map((item) => item.id === id ? payload.labourClass! : item) }));
          return payload.labourClass;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Labour Class changes could not be saved.') });
          return null;
        }
      },
      archiveLabourClass: async (id) => {
        try {
          await ensureOk(fetch(dataUrl('labour-classes', id), { method: 'DELETE', credentials: 'include' }));
          set((state) => ({ labourClasses: state.labourClasses.map((item) => item.id === id ? { ...item, active: false, updatedAt: nowISO() } : item) }));
          return true;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Labour Class could not be archived.') });
          return false;
        }
      },
      applyLabourClassSetup: async (input) => {
        try {
          const response = await ensureOk(fetch('/api/labour-class-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(input),
          }));
          const payload = await response.json() as { labourClasses?: LabourClass[]; employees?: Employee[] };
          if (!payload.labourClasses || !payload.employees) return { ok: false, error: 'Labour Class setup returned an incomplete response.' };
          set({ labourClasses: payload.labourClasses, employees: payload.employees });
          return { ok: true };
        } catch (error) {
          const message = errorMessage(error, 'Labour Class setup could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },

      // ── Scheduling Setup ──────────────────────────────────────────────────
      saveCrew: async (crewInput) => {
        const exists = get().crews.some((crew) => crew.id === crewInput.id);
        try {
          const response = await fetch(exists ? `/api/crews?id=${encodeURIComponent(crewInput.id)}` : '/api/crews', {
            method: exists ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(crewInput),
          });
          const payload = await response.json() as { ok?: boolean; crew?: Crew; error?: string };
          if (!response.ok || !payload.ok || !payload.crew) return { ok: false, error: payload.error ?? 'Crew could not be saved.' };
          set((state) => ({ crews: exists ? state.crews.map((crew) => crew.id === payload.crew!.id ? payload.crew! : crew) : [...state.crews, payload.crew!] }));
          return { ok: true };
        } catch (error: unknown) {
          return { ok: false, error: errorMessage(error, 'Crew could not be saved.') };
        }
      },
      saveDivision: async (divisionInput) => {
        const exists = get().divisions.some((division) => division.id === divisionInput.id);
        try {
          const response = await fetch(exists ? `/api/divisions?id=${encodeURIComponent(divisionInput.id)}` : '/api/divisions', {
            method: exists ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(divisionInput),
          });
          const payload = await response.json() as { ok?: boolean; division?: Division; error?: string };
          if (!response.ok || !payload.ok || !payload.division) return { ok: false, error: payload.error ?? 'Division could not be saved.' };
          set((state) => ({ divisions: exists ? state.divisions.map((division) => division.id === payload.division!.id ? payload.division! : division) : [...state.divisions, payload.division!] }));
          return { ok: true };
        } catch (error: unknown) {
          return { ok: false, error: errorMessage(error, 'Division could not be saved.') };
        }
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

      // ── Tasks ───────────────────────────────────────────────────────────
      addTask: async (taskInput) => {
        const task: Task = {
          ...taskInput,
          id: generateId(),
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        const previous = get().tasks;
        set((s) => ({ tasks: [task, ...s.tasks] }));

        try {
          await ensureOk(fetch(dataUrl('tasks'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: task }),
          }));

          return { ok: true, task };
        } catch (error: unknown) {
          set({ tasks: previous });
          const message = errorMessage(error, 'Task could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      updateTask: async (id, data) => {
        const previous = get().tasks;
        const updatedAt = nowISO();
        const nextPatch = { ...data, updatedAt };
        set((s) => ({
          tasks: s.tasks.map((task) => (task.id === id ? { ...task, ...nextPatch } : task)),
        }));

        try {
          await ensureOk(fetch(dataUrl('tasks', id), {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: nextPatch }),
          }));
          return { ok: true, task: get().tasks.find((task) => task.id === id) };
        } catch (error: unknown) {
          set({ tasks: previous });
          const message = errorMessage(error, 'Task changes could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      completeTask: async (id) => {
        return get().updateTask(id, {
          status: 'completed',
          completedAt: nowISO(),
        });
      },
      deleteTask: async (id) => {
        const previous = get().tasks;
        set((s) => ({ tasks: s.tasks.filter((task) => task.id !== id && task.parentTaskId !== id) }));

        try {
          await ensureOk(fetch(dataUrl('tasks', id), {
            method: 'DELETE',
            credentials: 'include',
          }));
          return { ok: true };
        } catch (error: unknown) {
          set({ tasks: previous });
          const message = errorMessage(error, 'Task could not be deleted.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      addJobTaskHeading: async (jobId, name) => {
        try {
          const response = await ensureOk(fetch(`/api/job-task-headings?jobId=${encodeURIComponent(jobId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name }),
          }));
          const body = await response.json() as { heading: JobTaskHeading };
          set((state) => ({ jobTaskHeadings: [...state.jobTaskHeadings, body.heading] }));
          return { ok: true, heading: body.heading };
        } catch (error: unknown) {
          const message = errorMessage(error, 'Heading could not be created.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      renameJobTaskHeading: async (jobId, id, name) => {
        const previous = get().jobTaskHeadings;
        set((state) => ({ jobTaskHeadings: state.jobTaskHeadings.map((heading) => heading.id === id ? { ...heading, name } : heading) }));
        try {
          await ensureOk(fetch(`/api/job-task-headings?jobId=${encodeURIComponent(jobId)}&id=${encodeURIComponent(id)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }),
          }));
          return { ok: true };
        } catch (error: unknown) {
          set({ jobTaskHeadings: previous });
          const message = errorMessage(error, 'Heading could not be renamed.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      deleteJobTaskHeading: async (jobId, id) => {
        const previousHeadings = get().jobTaskHeadings;
        const previousTasks = get().tasks;
        set((state) => ({
          jobTaskHeadings: state.jobTaskHeadings.filter((heading) => heading.id !== id),
          tasks: state.tasks.map((task) => task.headingId === id ? { ...task, headingId: undefined } : task),
        }));
        try {
          const response = await ensureOk(fetch(`/api/job-task-headings?jobId=${encodeURIComponent(jobId)}&id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' }));
          const body = await response.json() as { movedTaskCount?: number };
          return { ok: true, movedTaskCount: body.movedTaskCount ?? 0 };
        } catch (error: unknown) {
          set({ jobTaskHeadings: previousHeadings, tasks: previousTasks });
          const message = errorMessage(error, 'Heading could not be deleted.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      reorderJobTaskHeadings: async (jobId, orderedIds) => {
        const previous = get().jobTaskHeadings;
        set((state) => ({ jobTaskHeadings: state.jobTaskHeadings.map((heading) => {
          const sortOrder = orderedIds.indexOf(heading.id);
          return sortOrder < 0 ? heading : { ...heading, sortOrder };
        }) }));
        try {
          await ensureOk(fetch(`/api/job-task-headings?jobId=${encodeURIComponent(jobId)}&action=reorder`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ orderedIds }),
          }));
          return { ok: true };
        } catch (error: unknown) {
          set({ jobTaskHeadings: previous });
          const message = errorMessage(error, 'Heading order could not be saved.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
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
      updateForm: async (id, data) => {
        const previous = get().forms;
        const updatedAt = nowISO();
        set((state) => ({
          forms: state.forms.map((form) => (form.id === id ? { ...form, ...data, updatedAt } : form)),
        }));

        try {
          await ensureOk(fetch(dataUrl('forms', id), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ data: { ...data, updatedAt } }),
          }));
          return true;
        } catch (error: unknown) {
          set({ forms: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form changes could not be saved.') });
          return false;
        }
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
      addFormField: async (fieldInput) => {
        const previous = get().formFields;
        const field = {
          ...fieldInput,
          id: fieldInput.id ?? generateId(),
        };
        set((state) => ({ formFields: [...state.formFields, field] }));

        try {
          await ensureOk(fetch(dataUrl('form-fields'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ data: field }),
          }));
          return field;
        } catch (error: unknown) {
          set({ formFields: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form field could not be saved.') });
          return null;
        }
      },
      updateFormField: async (id, data) => {
        const previous = get().formFields;
        set((state) => ({
          formFields: state.formFields.map((field) => (field.id === id ? { ...field, ...data } : field)),
        }));

        try {
          await ensureOk(fetch(dataUrl('form-fields', id), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ data }),
          }));
          return true;
        } catch (error: unknown) {
          set({ formFields: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form field could not be updated.') });
          return false;
        }
      },
      deleteFormField: async (id) => {
        const previous = get().formFields;
        set((state) => ({ formFields: state.formFields.filter((field) => field.id !== id) }));

        try {
          await ensureOk(fetch(dataUrl('form-fields', id), { method: 'DELETE', credentials: 'include' }));
          return true;
        } catch (error: unknown) {
          set({ formFields: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Form field could not be deleted.') });
          return false;
        }
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

        void ensureOk(fetch(`/api/forms-review?id=${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ status: data.status }),
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
        const budget = {
          ...budgetInput,
          id: generateId(),
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        try {
          const response = await fetch(dataUrl('budgets'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: budget }),
          });
          if (!response.ok) await ensureOk(Promise.resolve(response));
          const payload = await response.json() as { ok?: boolean; budget?: Budget };
          if (!payload.ok || !payload.budget) throw new Error('Budget creation response was incomplete.');
          set((state) => ({ budgets: [...state.budgets.filter((item) => item.id !== payload.budget?.id), payload.budget as Budget] }));
          return payload.budget;
        } catch (error: unknown) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget could not be saved.') });
          return null;
        }
      },
      updateBudget: async (id, data) => {
        const updatedAt = nowISO();
        const requestSequence = (budgetMutationSequences.get(id) ?? 0) + 1;
        budgetMutationSequences.set(id, requestSequence);
        try {
          const response = await fetch(dataUrl('budgets', id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ data: { ...data, updatedAt } }),
          });
          if (!response.ok) await ensureOk(Promise.resolve(response));
          const payload = await response.json() as { ok?: boolean; budget?: Budget };
          if (!payload.ok || !payload.budget) throw new Error('Budget update response was incomplete.');
          if (!shouldApplyBudgetResponseModel(requestSequence, budgetMutationSequences.get(id) ?? 0)) return null;
          set((state) => ({ budgets: state.budgets.map((item) => item.id === id ? payload.budget as Budget : item) }));
          return payload.budget;
        } catch (error: unknown) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget changes could not be saved.') });
          return null;
        }
      },
      addBudgetDivision: async (divisionInput) => {
        const division = { ...divisionInput, id: generateId(), createdAt: nowISO(), updatedAt: nowISO() };
        try {
          const response = await fetch(`/api/budget-divisions?budgetId=${encodeURIComponent(division.budgetId)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data: division }),
          });
          if (!response.ok) await ensureOk(Promise.resolve(response));
          const payload = await response.json() as { ok?: boolean; division?: BudgetDivision };
          if (!payload.ok || !payload.division) throw new Error('Division creation response was incomplete.');
          set((state) => ({ budgetDivisions: [...state.budgetDivisions.filter((item) => item.id !== payload.division?.id), payload.division as BudgetDivision] }));
          return payload.division;
        } catch (error: unknown) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Division could not be saved.') });
          return null;
        }
      },
      updateBudgetDivision: async (budgetId, id, data) => {
        const requestSequence = (budgetDivisionMutationSequences.get(id) ?? 0) + 1;
        budgetDivisionMutationSequences.set(id, requestSequence);
        try {
          const response = await fetch(`/api/budget-divisions?budgetId=${encodeURIComponent(budgetId)}&id=${encodeURIComponent(id)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data: { ...data, updatedAt: nowISO() } }),
          });
          if (!response.ok) await ensureOk(Promise.resolve(response));
          const payload = await response.json() as { ok?: boolean; division?: BudgetDivision };
          if (!payload.ok || !payload.division) throw new Error('Division update response was incomplete.');
          if (!shouldApplyBudgetResponseModel(requestSequence, budgetDivisionMutationSequences.get(id) ?? 0)) return null;
          set((state) => ({ budgetDivisions: state.budgetDivisions.map((item) => item.id === id ? payload.division as BudgetDivision : item) }));
          return payload.division;
        } catch (error: unknown) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Division changes could not be saved.') });
          return null;
        }
      },
      addBudgetDivisionPlanningItem: async (input) => {
        try {
          const response = await fetch(`/api/budget-division-plans?budgetId=${encodeURIComponent(input.budgetId)}&divisionId=${encodeURIComponent(input.divisionId)}&category=${encodeURIComponent(input.category)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data: input }),
          });
          const payload = await response.json() as { ok?: boolean; item?: BudgetDivisionPlanningItem; error?: string };
          if (!response.ok || !payload.ok || !payload.item) throw new Error(payload.error);
          set((state) => ({ budgetDivisionPlanningItems: [...state.budgetDivisionPlanningItems.filter((item) => item.id !== payload.item?.id), payload.item as BudgetDivisionPlanningItem] }));
          return payload.item;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Planning item could not be added.') });
          return null;
        }
      },
      updateBudgetDivisionPlanningItem: async (item, data) => {
        try {
          const response = await fetch(`/api/budget-division-plans?budgetId=${encodeURIComponent(item.budgetId)}&divisionId=${encodeURIComponent(item.divisionId)}&category=${encodeURIComponent(item.category)}&id=${encodeURIComponent(item.id)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ data }),
          });
          const payload = await response.json() as { ok?: boolean; item?: BudgetDivisionPlanningItem; error?: string };
          if (!response.ok || !payload.ok || !payload.item) throw new Error(payload.error);
          set((state) => ({ budgetDivisionPlanningItems: state.budgetDivisionPlanningItems.map((value) => value.id === item.id ? payload.item as BudgetDivisionPlanningItem : value) }));
          return payload.item;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Planning item could not be updated.') });
          return null;
        }
      },
      saveBudgetEquipmentPlanningItem: async ({ planningItem, existingItem, catalogPatch, createEquipmentAsset }) => {
        const source = existingItem ?? planningItem;
        try {
          const query = `/api/budget-division-plans?budgetId=${encodeURIComponent(source.budgetId!)}&divisionId=${encodeURIComponent(source.divisionId!)}&category=equipment${existingItem ? `&id=${encodeURIComponent(existingItem.id)}` : ''}`;
          const response = await fetch(query, {
            method: existingItem ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ data: planningItem, catalogPatch, createEquipmentAsset }),
          });
          const payload = await response.json() as { ok?: boolean; item?: BudgetDivisionPlanningItem; equipmentAsset?: EquipmentAsset; error?: string };
          if (!response.ok || !payload.ok || !payload.item || !payload.equipmentAsset) throw new Error(payload.error);
          set((state) => ({
            budgetDivisionPlanningItems: [...state.budgetDivisionPlanningItems.filter((item) => item.id !== payload.item!.id), payload.item!],
            equipmentAssets: [payload.equipmentAsset!, ...state.equipmentAssets.filter((item) => item.id !== payload.equipmentAsset!.id)],
          }));
          return payload.item;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Equipment planning changes could not be saved.') });
          return null;
        }
      },
      deleteBudgetDivisionPlanningItem: async (item) => {
        try {
          const response = await fetch(`/api/budget-division-plans?budgetId=${encodeURIComponent(item.budgetId)}&divisionId=${encodeURIComponent(item.divisionId)}&category=${encodeURIComponent(item.category)}&id=${encodeURIComponent(item.id)}`, { method: 'DELETE', credentials: 'include' });
          if (!response.ok) throw new Error('Planning item could not be removed.');
          set((state) => ({ budgetDivisionPlanningItems: state.budgetDivisionPlanningItems.filter((value) => value.id !== item.id) }));
          return true;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Planning item could not be removed.') });
          return false;
        }
      },
      reorderBudgetDivisionPlanningItems: async (budgetId, divisionId, category, orderedIds) => {
        const previous = get().budgetDivisionPlanningItems;
        const order = new Map(orderedIds.map((id, index) => [id, index]));
        set((state) => ({ budgetDivisionPlanningItems: state.budgetDivisionPlanningItems.map((item) => item.budgetId === budgetId && item.category === category && ((category === 'labour' || category === 'equipment' || category === 'overhead') || item.divisionId === divisionId) ? { ...item, sortOrder: order.get(item.id) ?? item.sortOrder } : item) }));
        try {
          const response = await fetch(`/api/budget-division-plans?budgetId=${encodeURIComponent(budgetId)}&divisionId=${encodeURIComponent(divisionId)}&category=${encodeURIComponent(category)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ orderedIds }),
          });
          const payload = await response.json() as { ok?: boolean; items?: BudgetDivisionPlanningItem[]; error?: string };
          if (!response.ok || !payload.ok || !payload.items) throw new Error(payload.error);
          const savedIds = new Set(payload.items.map((value) => value.id));
          set((state) => ({ budgetDivisionPlanningItems: [...state.budgetDivisionPlanningItems.filter((value) => !savedIds.has(value.id)), ...payload.items as BudgetDivisionPlanningItem[]] }));
          return true;
        } catch (error) {
          set({ budgetDivisionPlanningItems: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Planning order could not be saved.') });
          return false;
        }
      },
      migrateLegacyBudgetOverhead: async (budgetId) => {
        try {
          const response = await fetch('/api/budget-overhead-migration', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ budgetId }),
          });
          const payload = await response.json() as { ok?: boolean; items?: BudgetDivisionPlanningItem[]; error?: string };
          if (!response.ok || !payload.ok || !payload.items) throw new Error(payload.error);
          set((state) => ({
            budgetDivisionPlanningItems: [
              ...state.budgetDivisionPlanningItems.filter((item) => item.budgetId !== budgetId || item.category !== 'overhead'),
              ...payload.items as BudgetDivisionPlanningItem[],
            ],
          }));
          return true;
        } catch (error) {
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Legacy overhead could not be normalized.') });
          return false;
        }
      },
      importBudgetDivisionPlanningItems: async (input) => {
        try {
          const response = await fetch('/api/budget-division-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(input) });
          const payload = await response.json() as { ok?: boolean; items?: BudgetDivisionPlanningItem[]; importedCount?: number; skippedCount?: number; error?: string };
          if (!response.ok || !payload.ok || !payload.items) throw new Error(payload.error);
          const importedIds = new Set(payload.items.map((value) => value.id));
          set((state) => ({ budgetDivisionPlanningItems: [...state.budgetDivisionPlanningItems.filter((value) => !importedIds.has(value.id)), ...payload.items as BudgetDivisionPlanningItem[]] }));
          return { ok: true, importedCount: payload.importedCount ?? payload.items.length, skippedCount: payload.skippedCount ?? 0 };
        } catch (error) {
          return { ok: false, importedCount: 0, skippedCount: 0, error: errorMessage(error, 'Planning items could not be imported.') };
        }
      },
      deleteBudget: async (id) => {
        try {
          const response = await fetch(dataUrl('budgets', id), { method: 'DELETE', credentials: 'include' });
          const payload = await response.json() as { ok?: boolean; code?: string; error?: string; dependencies?: { estimates: number } };
          if (!response.ok || !payload.ok) {
            const error = payload.error ?? 'Budget could not be deleted.';
            emitAppToast({ tone: 'error', message: error });
            return { ok: false, code: payload.code, error, dependencies: payload.dependencies };
          }
          set((state) => ({
            budgets: state.budgets.filter((budget) => budget.id !== id),
            budgetDivisions: state.budgetDivisions.filter((division) => division.budgetId !== id),
            budgetDivisionPlanningItems: state.budgetDivisionPlanningItems.filter((item) => item.budgetId !== id),
            budgetItems: state.budgetItems.filter((item) => item.budgetId !== id),
            budgetRates: state.budgetRates.filter((rate) => rate.budgetId !== id),
            labourBudgetPlans: state.labourBudgetPlans.filter((plan) => plan.budgetId !== id),
            labourHoursSalesGoals: state.labourHoursSalesGoals.filter((goal) => goal.budgetId !== id),
            revenueSalesGoals: state.revenueSalesGoals.filter((goal) => goal.budgetId !== id),
            equipmentBudgetAllocations: state.equipmentBudgetAllocations.filter((allocation) => allocation.budgetId !== id),
            budgetGroups: state.budgetGroups
              .map((group) => ({ ...group, budgetIds: group.budgetIds.filter((budgetId) => budgetId !== id) }))
              .filter((group) => group.budgetIds.length > 0),
          }));
          emitAppToast({ tone: 'success', message: 'Budget deleted.' });
          return { ok: true };
        } catch (error: unknown) {
          const message = errorMessage(error, 'Budget could not be deleted.');
          emitAppToast({ tone: 'error', message });
          return { ok: false, error: message };
        }
      },
      refreshBudgetGroups: async () => {
        const response = await fetch('/api/budget-groups', { credentials: 'include' });
        const payload = await response.json() as {
          ok?: boolean;
          groups?: BudgetGroup[];
          equipmentBudgetAllocations?: EquipmentBudgetAllocation[];
        };
        if (!response.ok || !payload.ok) throw new Error('Budget Groups could not be loaded.');
        const groups = payload.groups ?? [];
        const groupIdByBudgetId = new Map(groups.flatMap((group) => group.budgetIds.map((budgetId) => [budgetId, group.id] as const)));
        set((state) => ({
          budgetGroups: groups,
          equipmentBudgetAllocations: payload.equipmentBudgetAllocations ?? [],
          budgets: state.budgets.map((budget) => ({ ...budget, budgetGroupId: groupIdByBudgetId.get(budget.id) })),
        }));
      },
      saveBudgetGroup: async (group, confirmAllocationMove = false) => {
        const exists = get().budgetGroups.some((value) => value.id === group.id);
        const response = await fetch(exists ? `/api/budget-groups?id=${encodeURIComponent(group.id)}` : '/api/budget-groups', {
          method: exists ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...group, confirmAllocationMove }),
        });
        const payload = await response.json() as { ok?: boolean; code?: string; error?: string };
        if (response.status === 409 && payload.code === 'ALLOCATION_MOVE_CONFIRMATION_REQUIRED') {
          return { ok: false, requiresConfirmation: true, error: payload.error };
        }
        if (!response.ok || !payload.ok) return { ok: false, error: payload.error ?? 'Budget Group could not be saved.' };
        await get().refreshBudgetGroups();
        return { ok: true };
      },
      dissolveBudgetGroup: async (id) => {
        const response = await fetch(`/api/budget-groups?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!response.ok) return false;
        await get().refreshBudgetGroups();
        return true;
      },
      addBudgetItem: async (item, allocationMonths) => {
        const previous = get().budgetItems;
        const budgetItem = {
          ...item,
          budgeted: allocationMonths === undefined ? item.budgeted : item.budgeted * (allocationMonths / 12),
          id: generateId(),
        };
        set((s) => ({ budgetItems: [...s.budgetItems, budgetItem] }));

        try {
          await ensureOk(fetch(dataUrl('budget'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: { ...budgetItem, budgeted: item.budgeted }, allocationMonths }),
          }));
          if (allocationMonths !== undefined) void get().refreshBudgetGroups();
          return budgetItem;
        } catch {
          set({ budgetItems: previous });
          emitAppToast({ tone: 'error', message: 'Budget item could not be saved.' });
          return null;
        }
      },
      updateBudgetItem: async (id, data, allocationMonths) => {
        const previous = get().budgetItems;
        set((s) => ({
          budgetItems: s.budgetItems.map((b) =>
            b.id === id ? {
              ...b,
              ...data,
              budgeted: allocationMonths === undefined || data.budgeted === undefined
                ? (data.budgeted ?? b.budgeted)
                : data.budgeted * (allocationMonths / 12),
            } : b
          ),
        }));

        try {
          await ensureOk(fetch(dataUrl('budget', id), {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data, allocationMonths }),
          }));
          if (allocationMonths !== undefined) void get().refreshBudgetGroups();
          return true;
        } catch {
          set({ budgetItems: previous });
          emitAppToast({ tone: 'error', message: 'Budget changes could not be saved.' });
          return false;
        }
      },
      deleteBudgetItem: async (id) => {
        const previous = get().budgetItems;
        set((s) => ({ budgetItems: s.budgetItems.filter((b) => b.id !== id) }));

        try {
          await ensureOk(fetch(dataUrl('budget', id), {
            method: 'DELETE',
            credentials: 'include',
          }));
          return true;
        } catch {
          set({ budgetItems: previous });
          emitAppToast({ tone: 'error', message: 'Budget item could not be deleted.' });
          return false;
        }
      },
      saveGroupedEquipmentAllocations: async (input) => {
        try {
          const response = await fetch('/api/budget-equipment-allocations', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(input),
          });
          const payload = await response.json() as {
            ok?: boolean;
            error?: string;
            allocations?: EquipmentBudgetAllocation[];
            budgetItems?: BudgetItem[];
          };
          if (!response.ok || !payload.ok || !payload.allocations || !payload.budgetItems) {
            return { ok: false, error: payload.error ?? 'Equipment allocations could not be saved.' };
          }
          const savedBudgetItems = payload.budgetItems;
          const savedAllocations = payload.allocations;
          const affectedBudgetItemIds = new Set(savedBudgetItems.map((item) => item.id));
          const affectedAllocationIds = new Set(savedAllocations.map((allocation) => allocation.id));
          set((state) => ({
            budgetItems: [
              ...state.budgetItems.filter((item) => !affectedBudgetItemIds.has(item.id)),
              ...savedBudgetItems,
            ],
            equipmentBudgetAllocations: [
              ...state.equipmentBudgetAllocations.filter((allocation) => (
                !affectedAllocationIds.has(allocation.id)
                && !affectedBudgetItemIds.has(allocation.budgetItemId)
              )),
              ...savedAllocations,
            ],
          }));
          return { ok: true };
        } catch (error) {
          return { ok: false, error: errorMessage(error, 'Equipment allocations could not be saved.') };
        }
      },
      reorderBudgetEquipment: async (budgetId, orderedIds) => {
        const previous = get().budgetItems;
        const sortOrderById = new Map(orderedIds.map((id, sortOrder) => [id, sortOrder]));
        set((state) => ({
          budgetItems: state.budgetItems.map((item) => item.budgetId === budgetId && item.category === 'equipment'
            ? { ...item, sortOrder: sortOrderById.get(item.id) ?? item.sortOrder }
            : item),
        }));

        try {
          await ensureOk(fetch('/api/budget-equipment-order', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ budgetId, orderedIds }),
          }));
          return true;
        } catch {
          set({ budgetItems: previous });
          emitAppToast({ tone: 'error', message: 'Equipment order could not be saved.' });
          return false;
        }
      },
      addBudgetRate: async (rateInput) => {
        const previous = get().budgetRates;
        const budgetRate = {
          ...rateInput,
          id: generateId(),
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        set((s) => ({ budgetRates: [...s.budgetRates, budgetRate] }));

        try {
          await ensureOk(fetch(dataUrl('budget-rates'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: budgetRate }),
          }));
          return budgetRate;
        } catch (error: unknown) {
          set({ budgetRates: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget rate could not be saved.') });
          throw error;
        }
      },
      updateBudgetRate: async (id, data) => {
        const previous = get().budgetRates;
        const updatedAt = nowISO();
        const budgetRate = previous.find((rate) => rate.id === id);
        if (!budgetRate) throw new Error('Budget rate not found.');
        const updatedBudgetRate = { ...budgetRate, ...data, updatedAt };
        set((s) => ({
          budgetRates: s.budgetRates.map((rate) => (
            rate.id === id ? updatedBudgetRate : rate
          )),
        }));

        try {
          await ensureOk(fetch(dataUrl('budget-rates', id), {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: { ...data, updatedAt } }),
          }));
          return updatedBudgetRate;
        } catch (error: unknown) {
          set({ budgetRates: previous });
          emitAppToast({ tone: 'error', message: errorMessage(error, 'Budget rate changes could not be saved.') });
          throw error;
        }
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
      upsertLabourBudgetPlan: async (plan) => {
        const previous = get().labourBudgetPlans;
        const exists = previous.some((value) => value.id === plan.id);

        set((state) => ({
          labourBudgetPlans: exists
            ? state.labourBudgetPlans.map((value) => (value.id === plan.id ? { ...value, ...plan } : value))
            : [...state.labourBudgetPlans, plan],
        }));

        const method = exists ? 'PATCH' : 'POST';
        const url = exists ? dataUrl('labour-budget-plans', plan.id) : dataUrl('labour-budget-plans');

        try {
          await ensureOk(fetch(url, {
            method,
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ data: plan }),
          }));
          return true;
        } catch {
          set({ labourBudgetPlans: previous });
          emitAppToast({ tone: 'error', message: 'Labour planner could not be saved.' });
          return false;
        }
      },
      deleteLabourBudgetPlan: async (id) => {
        const previous = get().labourBudgetPlans;
        set((state) => ({ labourBudgetPlans: state.labourBudgetPlans.filter((plan) => plan.id !== id) }));

        try {
          await ensureOk(fetch(dataUrl('labour-budget-plans', id), {
            method: 'DELETE',
            credentials: 'include',
          }));
          return true;
        } catch {
          set({ labourBudgetPlans: previous });
          emitAppToast({ tone: 'error', message: 'Labour planner could not be deleted.' });
          return false;
        }
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
