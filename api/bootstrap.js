import {
  listFormsForBusiness,
  listFormFieldsForBusiness,
  listFormSubmissionsForBusiness,
  listFormResponsesForBusiness,
  listBudgetsForBusiness,
  listBudgetDivisionsForBusiness,
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
  listJobTaskHeadingsForBusiness,
  listTimeCorrectionsForBusiness,
  getTimeEntryForBusiness,
  listTimeEntriesForBusiness,
  getEmployeeForBusiness,
  getBusinessProfile,
} from './_lib/authRepo.js';
import { DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS, getActiveShiftForEmployee, isPossiblyForgottenClockOut } from './_lib/clocking.js';
import { requireSession } from './_lib/session.js';
import { filterRecordsForSession, redactEquipmentPricingForSession } from './_lib/authorization.js';
import {
  listBudgetGroupsForBusiness,
  listEquipmentBudgetAllocationsForBusiness,
} from './_lib/budgetGroups.js';
import { listCrewsForBusiness, listDivisionsForBusiness } from './_lib/schedulingConfig.js';
import { listDivisionPlanningItemsForBusiness } from './_lib/budgetDivisionPlanning.js';
import { normalizeBusinessTimeZone } from './_lib/businessTime.js';
import { clockOutWorkflowStatus, getPendingClockOutWorkflowForEmployee } from './_lib/mandatoryClockOut.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const [businessProfile, sessionEmployee] = await Promise.all([
      getBusinessProfile(session.businessId),
      typeof session.employeeId === 'string'
        ? getEmployeeForBusiness(session.businessId, session.employeeId)
        : null,
    ]);
    const activeShift = typeof session.employeeId === 'string'
      ? await getActiveShiftForEmployee({ businessId: session.businessId, employeeId: session.employeeId })
      : null;
    const activeTimeEntry = activeShift?.activeEntryId
      ? await getTimeEntryForBusiness(session.businessId, activeShift.activeEntryId)
      : null;
    const pendingClockOutWorkflow = typeof session.employeeId === 'string'
      ? await getPendingClockOutWorkflowForEmployee(session.businessId, session.employeeId)
      : null;
    const possibleForgottenClockOut = activeTimeEntry?.clockIn
      ? isPossiblyForgottenClockOut({
          clockInAt: activeTimeEntry.clockIn,
          thresholdHours: DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS,
        })
      : false;

    const [forms, formFields, formSubmissions, formResponses, budgets, budgetDivisions, budgetDivisionPlanningItems, budgetGroups, equipmentBudgetAllocations, crews, divisions, customers, jobs, estimates, invoices, expenses, equipmentAssets, unbillableTimeCategories, materialCatalogItems, templates, budgetItems, budgetRates, labourBudgetPlans, labourHoursSalesGoals, revenueSalesGoals, employees, tasks, jobTaskHeadings, timeEntries, timeCorrections] = await Promise.all([
      listFormsForBusiness(session.businessId),
      listFormFieldsForBusiness(session.businessId),
      listFormSubmissionsForBusiness(session.businessId),
      listFormResponsesForBusiness(session.businessId),
      listBudgetsForBusiness(session.businessId),
      listBudgetDivisionsForBusiness(session.businessId),
      listDivisionPlanningItemsForBusiness(session.businessId),
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
      listJobTaskHeadingsForBusiness(session.businessId),
      listTimeEntriesForBusiness(session.businessId),
      listTimeCorrectionsForBusiness(session.businessId),
    ]);

    const visibleJobs = filterRecordsForSession(session, 'jobs', jobs, { crews });
    const visibleJobIds = new Set(visibleJobs.map((job) => job.id));

    return res.status(200).json({
      ok: true,
      capabilities: {
        paidDriveTime: Boolean(sessionEmployee),
        requiredAfterClockOutForms: true,
      },
      timezone: normalizeBusinessTimeZone(businessProfile?.timezone),
      forms: filterRecordsForSession(session, 'forms', forms),
      formFields: filterRecordsForSession(session, 'form-fields', formFields),
      formSubmissions: filterRecordsForSession(session, 'form-submissions', formSubmissions),
      formResponses: filterRecordsForSession(session, 'form-responses', formResponses),
      budgets: filterRecordsForSession(session, 'budgets', budgets),
      budgetDivisions: filterRecordsForSession(session, 'budget-divisions', budgetDivisions),
      budgetDivisionPlanningItems: session.role === 'owner' || session.role === 'admin' ? budgetDivisionPlanningItems : [],
      budgetGroups: filterRecordsForSession(session, 'budget-groups', budgetGroups),
      equipmentBudgetAllocations: filterRecordsForSession(session, 'equipment-budget-allocations', equipmentBudgetAllocations),
      crews: filterRecordsForSession(session, 'crews', crews),
      divisions: filterRecordsForSession(session, 'divisions', divisions),
      customers: filterRecordsForSession(session, 'customers', customers),
      jobs: visibleJobs,
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
      jobTaskHeadings: jobTaskHeadings.filter((heading) => visibleJobIds.has(heading.jobId)),
      timeEntries: filterRecordsForSession(session, 'time-entries', timeEntries),
      timeCorrections: filterRecordsForSession(session, 'time-corrections', timeCorrections),
      currentActiveEntryId: activeShift?.activeEntryId ?? null,
      pendingClockOutWorkflow: pendingClockOutWorkflow ? clockOutWorkflowStatus(pendingClockOutWorkflow) : null,
      activeShiftWarnings: {
        possibleForgottenClockOut,
        thresholdHours: DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS,
      },
    });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not load business data' });
  }
}
