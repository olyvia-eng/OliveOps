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
  listSubcontractorCatalogItemsForBusiness,
  listLabourClassesForBusiness,
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
import { getBusinessDateParts, normalizeBusinessTimeZone } from './_lib/businessTime.js';
import { clockOutWorkflowStatus, getPendingClockOutWorkflowForEmployee, reconcilePendingClockOutWorkflow } from './_lib/mandatoryClockOut.js';
import { clockInWorkflowStatus, getPendingClockInWorkflowForEmployee } from './_lib/mandatoryClockIn.js';
import { getEligibleJobWorkAreas, WORK_AREA_CLOCKING_CONTRACT_VERSION } from './_lib/jobWorkAreas.js';
import { normalizeMobileTimePermissions } from './_lib/mobileTimePermissions.js';
import { listTrainingAssignmentsForBusiness, presentTrainingAssignments } from './_lib/trainingRepo.js';
import { listServiceVisitsForSchedule } from './_lib/serviceVisitRepo.js';
import { isEmployeeAssignedToServiceVisit } from './_lib/serviceVisitContext.js';
import { listAllJobSopAssociationsForBusiness } from './_lib/jobSopRepo.js';
import { normalizeBusinessFeatures } from '../shared/businessFeatures.js';

const dateKeyFor = (instant, timeZone) => {
  const parts = getBusinessDateParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const addDateKeyDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const CORE_BOOTSTRAP_LOADERS = {
  forms: listFormsForBusiness,
  formFields: listFormFieldsForBusiness,
  formSubmissions: listFormSubmissionsForBusiness,
  formResponses: listFormResponsesForBusiness,
  budgets: listBudgetsForBusiness,
  budgetDivisions: listBudgetDivisionsForBusiness,
  budgetDivisionPlanningItems: listDivisionPlanningItemsForBusiness,
  budgetGroups: listBudgetGroupsForBusiness,
  equipmentBudgetAllocations: listEquipmentBudgetAllocationsForBusiness,
  crews: listCrewsForBusiness,
  divisions: listDivisionsForBusiness,
  customers: listCustomersForBusiness,
  jobs: listJobsForBusiness,
  estimates: listEstimatesForBusiness,
  invoices: listInvoicesForBusiness,
  expenses: listExpensesForBusiness,
  equipmentAssets: listEquipmentAssetsForBusiness,
  unbillableTimeCategories: listUnbillableTimeCategoriesForBusiness,
  materialCatalogItems: listMaterialCatalogItemsForBusiness,
  subcontractorCatalogItems: listSubcontractorCatalogItemsForBusiness,
  labourClasses: listLabourClassesForBusiness,
  templates: listTemplatesForBusiness,
  budgetItems: listBudgetItemsForBusiness,
  budgetRates: listBudgetRatesForBusiness,
  labourBudgetPlans: listLabourBudgetPlansForBusiness,
  labourHoursSalesGoals: listLabourHoursSalesGoalsForBusiness,
  revenueSalesGoals: listRevenueSalesGoalsForBusiness,
  employees: listEmployeesForBusiness,
  tasks: listTasksForBusiness,
  jobTaskHeadings: listJobTaskHeadingsForBusiness,
  timeEntries: listTimeEntriesForBusiness,
  timeCorrections: listTimeCorrectionsForBusiness,
  trainingAssignments: listTrainingAssignmentsForBusiness,
  jobSopAssociations: listAllJobSopAssociationsForBusiness,
};

export async function loadCoreBootstrapData(businessId, loaders = CORE_BOOTSTRAP_LOADERS) {
  const entries = Object.entries(loaders);
  const values = await Promise.all(entries.map(([, loader]) => loader(businessId)));
  return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
}

export function createBootstrapHandler(overrides = {}) {
  const deps = {
    requireSession,
    getBusinessProfile,
    getEmployeeForBusiness,
    getActiveShiftForEmployee,
    getTimeEntryForBusiness,
    getPendingClockOutWorkflowForEmployee,
    reconcilePendingClockOutWorkflow,
    getPendingClockInWorkflowForEmployee,
    loadCoreBootstrapData,
    listServiceVisitsForSchedule,
    logServiceVisitError: (error) => console.error('[bootstrap:service-visits]', error),
    ...overrides,
  };

  return async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await deps.requireSession(req, res);
  if (!session) return;

  try {
    const [businessProfile, sessionEmployee] = await Promise.all([
      deps.getBusinessProfile(session.businessId),
      typeof session.employeeId === 'string'
        ? deps.getEmployeeForBusiness(session.businessId, session.employeeId)
        : null,
    ]);
    const activeShift = typeof session.employeeId === 'string'
      ? await deps.getActiveShiftForEmployee({ businessId: session.businessId, employeeId: session.employeeId })
      : null;
    const activeTimeEntry = activeShift?.activeEntryId
      ? await deps.getTimeEntryForBusiness(session.businessId, activeShift.activeEntryId)
      : null;
    const pendingClockOutWorkflow = typeof session.employeeId === 'string'
      ? await deps.reconcilePendingClockOutWorkflow({
          businessId: session.businessId,
          employeeId: session.employeeId,
          getPendingClockOutWorkflow: deps.getPendingClockOutWorkflowForEmployee,
          getTimeEntryForBusiness: deps.getTimeEntryForBusiness,
          listFormSubmissionsForBusiness,
        })
      : null;
    const pendingClockInWorkflow = typeof session.employeeId === 'string'
      ? await deps.getPendingClockInWorkflowForEmployee(session.businessId, session.employeeId)
      : null;
    const possibleForgottenClockOut = activeTimeEntry?.clockIn
      ? isPossiblyForgottenClockOut({
          clockInAt: activeTimeEntry.clockIn,
          thresholdHours: DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS,
        })
      : false;
    const timeZone = normalizeBusinessTimeZone(businessProfile?.timezone);
    const today = dateKeyFor(new Date(), timeZone);
    const upcomingEndDate = addDateKeyDays(today, 7);

    const { forms, formFields, formSubmissions, formResponses, budgets, budgetDivisions, budgetDivisionPlanningItems, budgetGroups, equipmentBudgetAllocations, crews, divisions, customers, jobs, estimates, invoices, expenses, equipmentAssets, unbillableTimeCategories, materialCatalogItems, subcontractorCatalogItems, labourClasses, templates, budgetItems, budgetRates, labourBudgetPlans, labourHoursSalesGoals, revenueSalesGoals, employees, tasks, jobTaskHeadings, timeEntries, timeCorrections, trainingAssignments, jobSopAssociations } = await deps.loadCoreBootstrapData(session.businessId);
    let serviceVisits = [];
    try {
      serviceVisits = await deps.listServiceVisitsForSchedule(session.businessId, today, upcomingEndDate);
    } catch (error) {
      deps.logServiceVisitError(error);
    }

    const visibleJobs = filterRecordsForSession(session, 'jobs', jobs, { crews });
    const visibleJobIds = new Set(visibleJobs.map((job) => job.id));
    const mobileClockingJobs = visibleJobs.map((job) => ({
      ...job,
      hasOperationalWorkAreas: Array.isArray(job.operationalWorkAreas) && job.operationalWorkAreas.length > 0,
      eligibleOperationalWorkAreas: getEligibleJobWorkAreas(job).map(({ id, name, status }) => ({ id, name, status })),
    }));
    const visibleServiceVisits = serviceVisits.filter((visit) => isEmployeeAssignedToServiceVisit(session, visit, crews));
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const crewById = new Map(crews.map((crew) => [crew.id, crew]));
    const jobsWithSops = new Set(jobSopAssociations.map((association) => association.jobId));
    const mobileServiceVisit = (visit) => {
      const job = jobById.get(visit.jobId);
      const service = job?.services?.find((candidate) => candidate.id === visit.serviceId);
      const customer = customerById.get(job?.customerId);
      const crew = crewById.get(visit.crewId);
      return {
        id: visit.id, jobId: visit.jobId, serviceId: visit.serviceId,
        jobName: job?.title ?? 'Service Job', serviceName: service?.name ?? 'Service',
        customerName: customer?.name ?? '', propertyName: job?.propertyLabel ?? '',
        propertyAddress: job?.propertyAddressSnapshot ?? customer?.address ?? '',
        scheduledDate: visit.scheduledDate, scheduledStartAt: visit.scheduledStartAt,
        scheduledEndAt: visit.scheduledEndAt, scheduleAllDay: visit.scheduleAllDay,
        crewId: visit.crewId, ...(crew ? { crew: { id: crew.id, name: crew.name } } : {}),
        assignedEmployeeIds: visit.assignedEmployeeIds ?? [], assignedEquipmentIds: visit.assignedEquipmentIds ?? [],
        status: visit.status, billingType: visit.billingTypeSnapshot,
        hasRequiredForms: forms.some((form) => form.status === 'active' && form.assignedTo === 'job' && form.assignmentValue === visit.jobId && form.completionRequirement === 'required'),
        hasSops: jobsWithSops.has(visit.jobId),
      };
    };
    const activeVisit = activeTimeEntry?.serviceVisitId ? visibleServiceVisits.find((visit) => visit.id === activeTimeEntry.serviceVisitId) : null;
    const activeVisitContext = activeVisit ? mobileServiceVisit(activeVisit) : null;
    const employeeTrainingAssignments = typeof session.employeeId === 'string'
      ? presentTrainingAssignments(trainingAssignments.filter((assignment) => assignment.employeeId === session.employeeId && !assignment.revokedAt), { timeZone: businessProfile?.timezone })
      : [];
    const overdueTrainingCount = employeeTrainingAssignments.filter((assignment) => assignment.presentationStatus === 'overdue').length;
    const dueSoonTrainingCount = employeeTrainingAssignments.filter((assignment) => assignment.presentationStatus === 'due_soon').length;

    return res.status(200).json({
      ok: true,
      capabilities: {
        paidDriveTime: Boolean(sessionEmployee),
        requiredBeforeClockInForms: true,
        requiredAfterClockOutForms: true,
        workAreaClockingVersion: WORK_AREA_CLOCKING_CONTRACT_VERSION,
        ...normalizeMobileTimePermissions(sessionEmployee?.mobileTimePermissions),
      },
      features: normalizeBusinessFeatures(businessProfile?.features),
      timezone: timeZone,
      serviceVisitHorizonDays: 7,
      serviceVisits: visibleServiceVisits,
      todayServiceVisits: visibleServiceVisits.filter((visit) => visit.scheduledDate === today).map(mobileServiceVisit),
      upcomingServiceVisits: visibleServiceVisits.filter((visit) => visit.scheduledDate > today).map(mobileServiceVisit),
      activeTimeEntry: activeTimeEntry ? { ...activeTimeEntry, ...(activeVisitContext ? { jobName: activeVisitContext.jobName, serviceName: activeVisitContext.serviceName, propertyName: activeVisitContext.propertyName } : {}) } : null,
      trainingAttentionCount: overdueTrainingCount + dueSoonTrainingCount,
      overdueTrainingCount,
      dueSoonTrainingCount,
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
      jobs: mobileClockingJobs,
      estimates: filterRecordsForSession(session, 'estimates', estimates),
      invoices: filterRecordsForSession(session, 'invoices', invoices),
      expenses: filterRecordsForSession(session, 'expenses', expenses),
      equipmentAssets: redactEquipmentPricingForSession(session, filterRecordsForSession(session, 'equipment-assets', equipmentAssets)),
      unbillableTimeCategories: filterRecordsForSession(session, 'unbillable-time-categories', unbillableTimeCategories),
      materialCatalogItems: filterRecordsForSession(session, 'material-catalog-items', materialCatalogItems),
      subcontractorCatalogItems: filterRecordsForSession(session, 'subcontractor-catalog-items', subcontractorCatalogItems),
      labourClasses,
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
      pendingClockInWorkflow: pendingClockInWorkflow ? clockInWorkflowStatus(pendingClockInWorkflow) : null,
      pendingClockOutWorkflow: pendingClockOutWorkflow ? clockOutWorkflowStatus(pendingClockOutWorkflow) : null,
      activeShiftWarnings: {
        possibleForgottenClockOut,
        thresholdHours: DEFAULT_FORGOTTEN_CLOCK_OUT_THRESHOLD_HOURS,
      },
    });
  } catch {
    return res.status(500).json({ ok: false, error: 'Could not load business data' });
  }
  };
}

export default createBootstrapHandler();
