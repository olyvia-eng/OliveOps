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
  listTimeCorrectionsForBusiness,
  getTimeEntryForBusiness,
  listTimeEntriesForBusiness,
  getEmployeeForBusiness,
} from './_lib/authRepo.js';
import { DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS, getActiveShiftForEmployee, isPossiblyForgottenClockOut } from './_lib/clocking.js';
import { requireSession } from './_lib/session.js';
import { filterRecordsForSession } from './_lib/authorization.js';

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

    const [forms, formFields, formSubmissions, formResponses, budgets, customers, jobs, estimates, invoices, expenses, equipmentAssets, unbillableTimeCategories, materialCatalogItems, templates, budgetItems, budgetRates, labourBudgetPlans, labourHoursSalesGoals, revenueSalesGoals, employees, timeEntries, timeCorrections] = await Promise.all([
      listFormsForBusiness(session.businessId),
      listFormFieldsForBusiness(session.businessId),
      listFormSubmissionsForBusiness(session.businessId),
      listFormResponsesForBusiness(session.businessId),
      listBudgetsForBusiness(session.businessId),
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
      customers: filterRecordsForSession(session, 'customers', customers),
      jobs: filterRecordsForSession(session, 'jobs', jobs),
      estimates: filterRecordsForSession(session, 'estimates', estimates),
      invoices: filterRecordsForSession(session, 'invoices', invoices),
      expenses: filterRecordsForSession(session, 'expenses', expenses),
      equipmentAssets: filterRecordsForSession(session, 'equipment-assets', equipmentAssets),
      unbillableTimeCategories: filterRecordsForSession(session, 'unbillable-time-categories', unbillableTimeCategories),
      materialCatalogItems: filterRecordsForSession(session, 'material-catalog-items', materialCatalogItems),
      templates: filterRecordsForSession(session, 'templates', templates),
      budgetItems: filterRecordsForSession(session, 'budget', budgetItems),
      budgetRates: filterRecordsForSession(session, 'budget-rates', budgetRates),
      labourBudgetPlans: filterRecordsForSession(session, 'labour-budget-plans', labourBudgetPlans),
      labourHoursSalesGoals: filterRecordsForSession(session, 'labour-hours-sales-goals', labourHoursSalesGoals),
      revenueSalesGoals: filterRecordsForSession(session, 'revenue-sales-goals', revenueSalesGoals),
      employees: filterRecordsForSession(session, 'employees', employees),
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
