import {
  listFormsForBusiness,
  listFormFieldsForBusiness,
  listFormSubmissionsForBusiness,
  listFormResponsesForBusiness,
  listBudgetsForBusiness,
  listRevenueSalesGoalsForBusiness,
  listLabourHoursSalesGoalsForBusiness,
  listLabourBudgetPlansForBusiness,
  listBudgetItemsForBusiness,
  listBudgetRatesForBusiness,
  listCustomersForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listUnbillableTimeCategoriesForBusiness,
  listMaterialCatalogItemsForBusiness,
  listEstimatesForBusiness,
  listExpensesForBusiness,
  listInvoicesForBusiness,
  listJobsForBusiness,
  listTemplatesForBusiness,
  listTasksForBusiness,
  listTimeCorrectionsForBusiness,
  getTimeEntryForBusiness,
  listTimeEntriesForBusiness,
  getEmployeeForBusiness,
} from './_lib/authRepo.js';
import { DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS, getActiveShiftForEmployee, isPossiblyForgottenClockOut } from './_lib/clocking.js';
import { requireSession } from './_lib/session.js';
import { filterRecordsForSession, redactEquipmentPricingForSession } from './_lib/authorization.js';
import {
  listBudgetGroupsForBusiness,
  listEquipmentBudgetAllocationsForBusiness,
} from './_lib/budgetGroups.js';
import { listCrewsForBusiness, listDivisionsForBusiness } from './_lib/schedulingConfig.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const sessionEmployee = typeof session.employeeId === 'string'
      ? await getEmployeeForBusiness(session.businessId, session.employeeId)
      : null;
    const activeShift = typeof session.employeeId === 'string'
      ? await getActiveShiftForEmployee({ businessId: session.businessId, employeeId: session.employeeId })
      : null;
    const activeTimeEntry = activeShift?.activeEntryId
      ? await getTimeEntryForBusiness(session.businessId, activeShift.activeEntryId)
      : null;
    const possibleForgottenClockOut = activeTimeEntry?.clockIn
      ? isPossiblyForgottenClockOut({
          clockInAt: activeTimeEntry.clockIn,
          thresholdHours: DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS,
        })
      : false;

    const [forms, formFields, formSubmissions, formResponses, budgets, budgetGroups, equipmentBudgetAllocations, crews, divisions, customers, jobs, estimates, invoices, expenses, equipmentAssets, unbillableTimeCategories, materialCatalogItems, templates, budgetItems, budgetRates, labourBudgetPlans, labourHoursSalesGoals, revenueSalesGoals, employees, tasks, timeEntries, timeCorrections] = await Promise.all([
      listFormsForBusiness(session.businessId),
      listFormFieldsForBusiness(session.businessId),
      listFormSubmissionsForBusiness(session.businessId),
      listFormResponsesForBusiness(session.businessId),
      listBudgetsForBusiness(session.businessId),
      listBudgetGroupsForBusiness(session.businessId),
      listEquipmentBudgetAllocationsForBusiness(session.businessId),
      listCrewsForBusiness(session.businessId),
      listDivisionsForBusiness(session.businessId),
      listCustomersForBusiness(session.businessId),
      listJobsForBusiness(session.businessId),
      listEstimatesForBusiness(session.businessId),
      listInvoicesForBusiness(session.businessId),
      listExpensesForBusiness(session.businessId),
      listEquipmentAssetsForBusiness(session.businessId),
      listUnbillableTimeCategoriesForBusiness(session.businessId),
      listMaterialCatalogItemsForBusiness(session.businessId),
      listTemplatesForBusiness(session.businessId),
      listBudgetItemsForBusiness(session.businessId),
      listBudgetRatesForBusiness(session.businessId),
      listLabourBudgetPlansForBusiness(session.businessId),
      listLabourHoursSalesGoalsForBusiness(session.businessId),
      listRevenueSalesGoalsForBusiness(session.businessId),
      listEmployeesForBusiness(session.businessId),
      listTasksForBusiness(session.businessId),
      listTimeEntriesForBusiness(session.businessId),
      listTimeCorrectionsForBusiness(session.businessId),
    ]);

    return res.status(200).json({
      ok: true,
      capabilities: {
        paidDriveTime: Boolean(sessionEmployee),
      },
      forms: filterRecordsForSession(session, 'forms', forms),
      formFields: filterRecordsForSession(session, 'form-fields', formFields),
      formSubmissions: filterRecordsForSession(session, 'form-submissions', formSubmissions),
      formResponses: filterRecordsForSession(session, 'form-responses', formResponses),
      budgets: filterRecordsForSession(session, 'budgets', budgets),
      budgetGroups: filterRecordsForSession(session, 'budget-groups', budgetGroups),
      equipmentBudgetAllocations: filterRecordsForSession(session, 'equipment-budget-allocations', equipmentBudgetAllocations),
      crews: filterRecordsForSession(session, 'crews', crews),
      divisions: filterRecordsForSession(session, 'divisions', divisions),
      customers: filterRecordsForSession(session, 'customers', customers),
      jobs: filterRecordsForSession(session, 'jobs', jobs, { crews }),
      estimates: filterRecordsForSession(session, 'estimates', estimates),
      invoices: filterRecordsForSession(session, 'invoices', invoices),
      expenses: filterRecordsForSession(session, 'expenses', expenses),
      equipmentAssets: redactEquipmentPricingForSession(session, filterRecordsForSession(session, 'equipment-assets', equipmentAssets)),
      unbillableTimeCategories: filterRecordsForSession(session, 'unbillable-time-categories', unbillableTimeCategories),
      materialCatalogItems: filterRecordsForSession(session, 'material-catalog-items', materialCatalogItems),
      templates: filterRecordsForSession(session, 'templates', templates),
      budgetItems: filterRecordsForSession(session, 'budget', budgetItems),
      budgetRates: filterRecordsForSession(session, 'budget-rates', budgetRates),
      labourBudgetPlans: filterRecordsForSession(session, 'labour-budget-plans', labourBudgetPlans),
      labourHoursSalesGoals: filterRecordsForSession(session, 'labour-hours-sales-goals', labourHoursSalesGoals),
      revenueSalesGoals: filterRecordsForSession(session, 'revenue-sales-goals', revenueSalesGoals),
      employees: filterRecordsForSession(session, 'employees', employees),
      tasks: filterRecordsForSession(session, 'tasks', tasks),
      timeEntries: filterRecordsForSession(session, 'time-entries', timeEntries),
      timeCorrections: filterRecordsForSession(session, 'time-corrections', timeCorrections),
      currentActiveEntryId: activeShift?.activeEntryId ?? null,
      activeShiftWarnings: {
        possibleForgottenClockOut,
        thresholdHours: DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS,
      },
    });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not load business data' });
  }
}
