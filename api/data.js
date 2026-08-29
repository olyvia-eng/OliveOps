import {
  createBudgetForBusiness,
  createBudgetItemForBusiness,
  createBudgetRateForBusiness,
  createAuditEventForBusiness,
  createCustomerForBusiness,
  createEmployeeForBusiness,
  createEmployeeWithAccessForBusiness,
  createEquipmentAssetForBusiness,
  createUnbillableTimeCategoryForBusiness,
  createMaterialCatalogItemForBusiness,
  createSubcontractorCatalogItemForBusiness,
  createEstimateForBusiness,
  createExpenseForBusiness,
  createFormFieldForBusiness,
  createFormForBusiness,
  createFormResponseForBusiness,
  createFormSubmissionForBusiness,
  createInvoiceForBusiness,
  createJobForBusiness,
  createRevenueSalesGoalForBusiness,
  createLabourHoursSalesGoalForBusiness,
  createLabourBudgetPlanForBusiness,
  createLabourClassForBusiness,
  createTemplateForBusiness,
  createTimeEntryForBusiness,
  createTaskForBusiness,
  deleteBudgetForBusiness,
  deleteBudgetItemForBusiness,
  deleteBudgetRateForBusiness,
  deleteAuditEventForBusiness,
  deleteCustomerForBusiness,
  deleteEmployeeForBusiness,
  deleteEquipmentAssetForBusiness,
  deleteUnbillableTimeCategoryForBusiness,
  deleteMaterialCatalogItemForBusiness,
  deleteSubcontractorCatalogItemForBusiness,
  deleteEstimateForBusiness,
  deleteExpenseForBusiness,
  deleteFormFieldForBusiness,
  deleteFormForBusiness,
  deleteFormResponseForBusiness,
  deleteFormSubmissionForBusiness,
  deleteInvoiceForBusiness,
  deleteJobForBusiness,
  deleteRevenueSalesGoalForBusiness,
  deleteLabourHoursSalesGoalForBusiness,
  deleteLabourBudgetPlanForBusiness,
  archiveLabourClassForBusiness,
  deleteTemplateForBusiness,
  deleteTimeEntryForBusiness,
  deleteTaskForBusiness,
  getBudgetForBusiness,
  getBudgetDivisionForBusiness,
  getBudgetItemForBusiness,
  getBudgetRateForBusiness,
  getAuditEventForBusiness,
  getCustomerForBusiness,
  getEmployeeForBusiness,
  getEquipmentAssetForBusiness,
  getUnbillableTimeCategoryForBusiness,
  getMaterialCatalogItemForBusiness,
  getSubcontractorCatalogItemForBusiness,
  getEstimateForBusiness,
  getExpenseForBusiness,
  getFormFieldForBusiness,
  getFormForBusiness,
  getFormResponseForBusiness,
  getFormSubmissionForBusiness,
  getInvoiceForBusiness,
  getJobForBusiness,
  getRevenueSalesGoalForBusiness,
  getLabourHoursSalesGoalForBusiness,
  getLabourBudgetPlanForBusiness,
  getLabourClassForBusiness,
  getTemplateForBusiness,
  getTimeEntryForBusiness,
  getTaskForBusiness,
  getJobTaskHeadingForBusiness,
  generateId,
  listBudgetsForBusiness,
  listBudgetDivisionsForBusiness,
  listBudgetItemsForBusiness,
  listBudgetRatesForBusiness,
  listAuditEventsForBusiness,
  listCustomersForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listUnbillableTimeCategoriesForBusiness,
  listMaterialCatalogItemsForBusiness,
  listSubcontractorCatalogItemsForBusiness,
  listEstimatesForBusiness,
  listExpensesForBusiness,
  listFormFieldsForBusiness,
  listFormsForBusiness,
  listFormResponsesForBusiness,
  listFormSubmissionsForBusiness,
  listInvoicesForBusiness,
  listJobsForBusiness,
  listRevenueSalesGoalsForBusiness,
  listLabourHoursSalesGoalsForBusiness,
  listLabourBudgetPlansForBusiness,
  listLabourClassesForBusiness,
  listTemplatesForBusiness,
  listTimeEntriesForBusiness,
  listTasksForBusiness,
  updateBudgetForBusiness,
  updateBudgetItemForBusiness,
  updateBudgetRateForBusiness,
  updateAuditEventForBusiness,
  updateCustomerForBusiness,
  updateEmployeeAccessForBusiness,
  updateEmployeeForBusiness,
  updateEquipmentAssetForBusiness,
  updateUnbillableTimeCategoryForBusiness,
  updateMaterialCatalogItemForBusiness,
  updateSubcontractorCatalogItemForBusiness,
  updateEstimateForBusiness,
  updateExpenseForBusiness,
  updateFormFieldForBusiness,
  updateFormForBusiness,
  updateFormResponseForBusiness,
  updateFormSubmissionForBusiness,
  updateInvoiceForBusiness,
  updateJobForBusiness,
  updateRevenueSalesGoalForBusiness,
  updateLabourHoursSalesGoalForBusiness,
  updateLabourBudgetPlanForBusiness,
  updateLabourClassForBusiness,
  updateTemplateForBusiness,
  updateTimeEntryForBusiness,
  updateTaskForBusiness,
} from './_lib/authRepo.js';
import { authorizeRecordAccess, filterRecordsForSession, redactEquipmentPricingForSession } from './_lib/authorization.js';
import { normalizeInvoiceFinancials, validateInvoiceLineItems } from '../src/utils/invoiceModel.js';
import { enforceEstimateWorkAreaDivisionModel, ensureDefaultEstimateWorkAreaModel } from '../src/utils/estimateWorkAreaIdentity.js';
import { requireSession } from './_lib/session.js';
import { syncJobToExternalCalendars } from './_lib/calendarSync.js';
import { listDivisionPlanningItemsForBusiness } from './_lib/budgetDivisionPlanning.js';
import { applyAuthoritativeEstimatePricing, buildEstimatePricingCatalog } from './_lib/estimatePricingCatalog.js';
import { getCrewForBusiness, getDivisionForBusiness, listCrewsForBusiness, listDivisionsForBusiness } from './_lib/schedulingConfig.js';
import {
  deleteEquipmentBudgetAllocationForItem,
  saveEquipmentBudgetAllocationForItem,
} from './_lib/budgetGroups.js';
import { getHomeDashboardPreferencesForUser } from './_lib/homeDashboardPreferences.js';
import { deleteBudgetCascadeForBusiness } from './_lib/budgetDeletion.js';

const ENTITY_CONFIG = {
  budgets: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listBudgetsForBusiness,
    get: getBudgetForBusiness,
    create: createBudgetForBusiness,
    update: updateBudgetForBusiness,
    remove: deleteBudgetForBusiness,
    payloadKey: 'budget',
    idParam: 'budgetId',
    createArgKey: 'budget',
    updateArgKey: 'budget',
  },
  customers: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listCustomersForBusiness,
    get: getCustomerForBusiness,
    create: createCustomerForBusiness,
    update: updateCustomerForBusiness,
    remove: deleteCustomerForBusiness,
    payloadKey: 'customer',
    idParam: 'customerId',
    createArgKey: 'customer',
    updateArgKey: 'customer',
  },
  tasks: {
    readRoles: null,
    writeRoles: null,
    list: listTasksForBusiness,
    get: getTaskForBusiness,
    create: createTaskForBusiness,
    update: updateTaskForBusiness,
    remove: deleteTaskForBusiness,
    payloadKey: 'task',
    idParam: 'taskId',
    createArgKey: 'task',
    updateArgKey: 'task',
  },
  jobs: {
    readRoles: null,
    writeRoles: ['owner', 'admin', 'foreman'],
    list: listJobsForBusiness,
    get: getJobForBusiness,
    create: createJobForBusiness,
    update: updateJobForBusiness,
    remove: deleteJobForBusiness,
    payloadKey: 'job',
    idParam: 'jobId',
    createArgKey: 'job',
    updateArgKey: 'job',
  },
  estimates: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listEstimatesForBusiness,
    get: getEstimateForBusiness,
    create: createEstimateForBusiness,
    update: updateEstimateForBusiness,
    remove: deleteEstimateForBusiness,
    payloadKey: 'estimate',
    idParam: 'estimateId',
    createArgKey: 'estimate',
    updateArgKey: 'estimate',
  },
  templates: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listTemplatesForBusiness,
    get: getTemplateForBusiness,
    create: createTemplateForBusiness,
    update: updateTemplateForBusiness,
    remove: deleteTemplateForBusiness,
    payloadKey: 'template',
    idParam: 'templateId',
    createArgKey: 'template',
    updateArgKey: 'template',
  },
  invoices: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listInvoicesForBusiness,
    get: getInvoiceForBusiness,
    create: createInvoiceForBusiness,
    update: updateInvoiceForBusiness,
    remove: deleteInvoiceForBusiness,
    payloadKey: 'invoice',
    idParam: 'invoiceId',
    createArgKey: 'invoice',
    updateArgKey: 'invoice',
  },
  expenses: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listExpensesForBusiness,
    get: getExpenseForBusiness,
    create: createExpenseForBusiness,
    update: updateExpenseForBusiness,
    remove: deleteExpenseForBusiness,
    payloadKey: 'expense',
    idParam: 'expenseId',
    createArgKey: 'expense',
    updateArgKey: 'expense',
  },
  forms: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listFormsForBusiness,
    get: getFormForBusiness,
    create: createFormForBusiness,
    update: updateFormForBusiness,
    remove: deleteFormForBusiness,
    payloadKey: 'form',
    idParam: 'formId',
    createArgKey: 'form',
    updateArgKey: 'form',
  },
  'form-fields': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listFormFieldsForBusiness,
    get: getFormFieldForBusiness,
    create: createFormFieldForBusiness,
    update: updateFormFieldForBusiness,
    remove: deleteFormFieldForBusiness,
    payloadKey: 'formField',
    idParam: 'formFieldId',
    createArgKey: 'formField',
    updateArgKey: 'formField',
  },
  'form-submissions': {
    readRoles: null,
    writeRoles: null,
    list: listFormSubmissionsForBusiness,
    get: getFormSubmissionForBusiness,
    create: createFormSubmissionForBusiness,
    update: updateFormSubmissionForBusiness,
    remove: deleteFormSubmissionForBusiness,
    payloadKey: 'formSubmission',
    idParam: 'formSubmissionId',
    createArgKey: 'formSubmission',
    updateArgKey: 'formSubmission',
  },
  'form-responses': {
    readRoles: null,
    writeRoles: null,
    list: listFormResponsesForBusiness,
    get: getFormResponseForBusiness,
    create: createFormResponseForBusiness,
    update: updateFormResponseForBusiness,
    remove: deleteFormResponseForBusiness,
    payloadKey: 'formResponse',
    idParam: 'formResponseId',
    createArgKey: 'formResponse',
    updateArgKey: 'formResponse',
  },
  budget: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listBudgetItemsForBusiness,
    get: getBudgetItemForBusiness,
    create: createBudgetItemForBusiness,
    update: updateBudgetItemForBusiness,
    remove: deleteBudgetItemForBusiness,
    payloadKey: 'budgetItem',
    idParam: 'budgetItemId',
    createArgKey: 'budgetItem',
    updateArgKey: 'budgetItem',
  },
  'budget-rates': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listBudgetRatesForBusiness,
    get: getBudgetRateForBusiness,
    create: createBudgetRateForBusiness,
    update: updateBudgetRateForBusiness,
    remove: deleteBudgetRateForBusiness,
    payloadKey: 'budgetRate',
    idParam: 'budgetRateId',
    createArgKey: 'budgetRate',
    updateArgKey: 'budgetRate',
  },
  'labour-budget-plans': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listLabourBudgetPlansForBusiness,
    get: getLabourBudgetPlanForBusiness,
    create: createLabourBudgetPlanForBusiness,
    update: updateLabourBudgetPlanForBusiness,
    remove: deleteLabourBudgetPlanForBusiness,
    payloadKey: 'labourBudgetPlan',
    idParam: 'labourBudgetPlanId',
    createArgKey: 'labourBudgetPlan',
    updateArgKey: 'labourBudgetPlan',
  },
  'labour-hours-sales-goals': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listLabourHoursSalesGoalsForBusiness,
    get: getLabourHoursSalesGoalForBusiness,
    create: createLabourHoursSalesGoalForBusiness,
    update: updateLabourHoursSalesGoalForBusiness,
    remove: deleteLabourHoursSalesGoalForBusiness,
    payloadKey: 'labourHoursSalesGoal',
    idParam: 'labourHoursSalesGoalId',
    createArgKey: 'labourHoursSalesGoal',
    updateArgKey: 'labourHoursSalesGoal',
  },
  'revenue-sales-goals': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listRevenueSalesGoalsForBusiness,
    get: getRevenueSalesGoalForBusiness,
    create: createRevenueSalesGoalForBusiness,
    update: updateRevenueSalesGoalForBusiness,
    remove: deleteRevenueSalesGoalForBusiness,
    payloadKey: 'revenueSalesGoal',
    idParam: 'revenueSalesGoalId',
    createArgKey: 'revenueSalesGoal',
    updateArgKey: 'revenueSalesGoal',
  },
  employees: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listEmployeesForBusiness,
    get: getEmployeeForBusiness,
    create: createEmployeeForBusiness,
    update: updateEmployeeForBusiness,
    remove: deleteEmployeeForBusiness,
    payloadKey: 'employee',
    idParam: 'employeeId',
    createArgKey: 'employee',
    updateArgKey: 'employee',
  },
  'labour-classes': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listLabourClassesForBusiness,
    get: getLabourClassForBusiness,
    create: createLabourClassForBusiness,
    update: updateLabourClassForBusiness,
    remove: archiveLabourClassForBusiness,
    payloadKey: 'labourClass',
    idParam: 'labourClassId',
    createArgKey: 'labourClass',
    updateArgKey: 'labourClass',
  },
  'equipment-assets': {
    readRoles: null,
    writeRoles: ['owner', 'admin', 'foreman'],
    list: listEquipmentAssetsForBusiness,
    get: getEquipmentAssetForBusiness,
    create: createEquipmentAssetForBusiness,
    update: updateEquipmentAssetForBusiness,
    remove: deleteEquipmentAssetForBusiness,
    payloadKey: 'equipmentAsset',
    idParam: 'equipmentId',
    createArgKey: 'equipmentAsset',
    updateArgKey: 'equipmentAsset',
  },
  'material-catalog-items': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listMaterialCatalogItemsForBusiness,
    get: getMaterialCatalogItemForBusiness,
    create: createMaterialCatalogItemForBusiness,
    update: updateMaterialCatalogItemForBusiness,
    remove: deleteMaterialCatalogItemForBusiness,
    payloadKey: 'materialCatalogItem',
    idParam: 'materialId',
    createArgKey: 'materialCatalogItem',
    updateArgKey: 'materialCatalogItem',
  },
  'subcontractor-catalog-items': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listSubcontractorCatalogItemsForBusiness,
    get: getSubcontractorCatalogItemForBusiness,
    create: createSubcontractorCatalogItemForBusiness,
    update: updateSubcontractorCatalogItemForBusiness,
    remove: deleteSubcontractorCatalogItemForBusiness,
    payloadKey: 'subcontractorCatalogItem',
    idParam: 'subcontractorId',
    createArgKey: 'subcontractorCatalogItem',
    updateArgKey: 'subcontractorCatalogItem',
  },
  'unbillable-time-categories': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
    list: listUnbillableTimeCategoriesForBusiness,
    get: getUnbillableTimeCategoryForBusiness,
    create: createUnbillableTimeCategoryForBusiness,
    update: updateUnbillableTimeCategoryForBusiness,
    remove: deleteUnbillableTimeCategoryForBusiness,
    payloadKey: 'unbillableTimeCategory',
    idParam: 'unbillableCategoryId',
    createArgKey: 'category',
    updateArgKey: 'category',
  },
  'time-entries': {
    readRoles: null,
    writeRoles: ['owner', 'admin', 'foreman'],
    list: listTimeEntriesForBusiness,
    get: getTimeEntryForBusiness,
    create: createTimeEntryForBusiness,
    update: updateTimeEntryForBusiness,
    remove: deleteTimeEntryForBusiness,
    payloadKey: 'timeEntry',
    idParam: 'entryId',
    createArgKey: 'timeEntry',
    updateArgKey: 'timeEntry',
  },
  'audit-events': {
    readRoles: ['owner', 'admin'],
    writeRoles: ['owner', 'admin'],
    list: listAuditEventsForBusiness,
    get: getAuditEventForBusiness,
    create: createAuditEventForBusiness,
    update: updateAuditEventForBusiness,
    remove: deleteAuditEventForBusiness,
    payloadKey: 'auditEvent',
    idParam: 'eventId',
    createArgKey: 'auditEvent',
    updateArgKey: 'auditEvent',
  },
};

function getConfig(entity) {
  return entity ? ENTITY_CONFIG[entity] : undefined;
}

const PATCH_BLOCKED_FIELDS = new Set([
  'PK',
  'SK',
  'businessId',
  'entityType',
  'createdAt',
  'passwordHash',
]);
const EQUIPMENT_PRICING_FIELDS = ['costRateHourly', 'recommendedSellRate', 'chargeOutRate'];

function changesEquipmentPricing(data) {
  return EQUIPMENT_PRICING_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data ?? {}, field));
}

function sanitizePatchData(entity, id, rawData) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return { ok: false, error: 'Invalid payload' };
  }

  const data = { ...rawData };
  const forbiddenIdKeys = ['id'];
  const config = getConfig(entity);
  if (config?.idParam) {
    forbiddenIdKeys.push(config.idParam);
  }

  for (const key of forbiddenIdKeys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const nextIdValue = data[key];
      if (nextIdValue !== undefined && nextIdValue !== id) {
        return { ok: false, error: 'Immutable id fields cannot be changed.' };
      }
      delete data[key];
    }
  }

  for (const key of Object.keys(data)) {
    if (PATCH_BLOCKED_FIELDS.has(key)) {
      delete data[key];
    }
  }

  return { ok: true, data };
}

const INVOICE_STATUSES = new Set(['draft', 'sent', 'paid', 'overdue']);
const EXPENSE_STATUSES = new Set(['pending', 'approved', 'paid']);
const EXPENSE_CATEGORIES = new Set(['materials', 'equipment', 'subcontractor', 'travel', 'permits', 'overhead', 'other']);
const JOB_STATUSES = new Set(['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled']);
const EQUIPMENT_STATUSES = new Set(['available', 'in_use', 'maintenance', 'inactive']);
const EQUIPMENT_COST_TYPES = new Set(['financed', 'leased', 'owned', 'rental']);
const BUDGET_TYPES = new Set(['operating', 'capital', 'project', 'forecast', 'custom']);
const BUDGET_STATUSES = new Set(['draft', 'active', 'archived']);
const BUDGET_ITEM_CATEGORIES = new Set(['revenue', 'labour', 'materials', 'equipment', 'subcontractors', 'overhead', 'marketing', 'insurance', 'other']);
const ESTIMATE_STATUSES = new Set(['draft', 'sent', 'accepted', 'declined', 'converted']);
const ESTIMATE_LINE_ITEM_CATEGORIES = new Set(['material', 'equipment', 'labour', 'subcontractor']);
const BUDGET_RATE_CATEGORIES = new Set(['material', 'equipment', 'labour', 'subcontractor']);
const FORM_CATEGORIES = new Set(['safety', 'vehicle', 'equipment', 'job_site', 'hr', 'operations', 'maintenance', 'custom']);
const FORM_STATUSES = new Set(['active', 'draft', 'archived']);
const FORM_ASSIGNMENTS = new Set(['everyone', 'role', 'employee', 'division', 'job', 'equipment']);
const FORM_TRIGGERS = new Set([
  'before_clock_in',
  'after_clock_out',
  'before_starting_job',
  'after_completing_job',
  'after_leaving_job',
  'job_completed',
  'daily',
  'weekly',
  'monthly',
  'on_demand',
]);
const FORM_FIELD_TYPES = new Set([
  'section_header',
  'paragraph_text',
  'single_line_text',
  'multi_line_text',
  'number',
  'currency',
  'date',
  'time',
  'yes_no',
  'checkbox',
  'multiple_choice',
  'dropdown',
  'photo_upload',
  'file_upload',
  'signature',
  'employee_selector',
  'job_selector',
  'customer_selector',
]);
const FORM_SUBMISSION_STATUSES = new Set(['draft', 'submitted', 'approved', 'rejected']);
const TASK_STATUSES = new Set(['open', 'completed']);
const TASK_PRIORITIES = new Set(['low', 'normal', 'high']);
const TASK_RELATED_ENTITY_TYPES = new Set(['customer', 'estimate', 'job', 'invoice', 'employee']);
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_REGEX = /^\d{4}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_REGEX = /^\d{4}-\d{2}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEmployeeCostInputs(record) {
  const fields = [
    ['hourlyRate', 'Employee base compensation'],
    ['payrollBurdenPct', 'Employee payroll burden percent'],
    ['benefitsExtraCost', 'Employee benefits/extra cost'],
    ['bonus', 'Employee bonus'],
  ];
  for (const [field, label] of fields) {
    if (record[field] !== undefined && record[field] !== null && (!isFiniteNumber(record[field]) || record[field] < 0)) {
      return `${label} must be zero or greater.`;
    }
  }
  if (record.compensationType !== undefined && record.compensationType !== 'hourly' && record.compensationType !== 'salary') {
    return 'Employee compensation type is invalid.';
  }
  if (record.labourType !== undefined && record.labourType !== 'field_producing' && record.labourType !== 'overhead') {
    return 'Employee labour classification is invalid.';
  }
  return null;
}

function validateLabourClassRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Labour Class id is required.';
  if (!isNonEmptyString(record.name)) return 'Labour Class name is required.';
  if (record.name.trim().length > 100) return 'Labour Class name must be 100 characters or fewer.';
  if (record.description !== undefined && typeof record.description !== 'string') return 'Labour Class description is invalid.';
  if (record.active !== undefined && typeof record.active !== 'boolean') return 'Labour Class status is invalid.';
  if (record.customRates !== undefined && (record.customRates === null || typeof record.customRates !== 'object' || Array.isArray(record.customRates))) return 'Labour Class custom rates are invalid.';
  for (const value of Object.values(record.customRates ?? {})) {
    if (value !== null && (!isFiniteNumber(value) || value < 0)) return 'Labour Class custom rates must be zero or greater.';
  }
  return null;
}

async function validateLabourClassNameUnique(businessId, record) {
  const normalizedName = record.name.trim().replace(/\s+/g, ' ').toLowerCase();
  const labourClasses = await listLabourClassesForBusiness(businessId);
  const duplicate = labourClasses.find((labourClass) => labourClass.id !== record.id && labourClass.name.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedName);
  return duplicate ? 'A Labour Class with this name already exists.' : null;
}

async function validateEmployeeLabourClass(businessId, employee) {
  if (employee.labourClassId === undefined || employee.labourClassId === null || employee.labourClassId === '') return null;
  if (typeof employee.labourClassId !== 'string') return 'Employee Labour Class is invalid.';
  const labourClass = await getLabourClassForBusiness(businessId, employee.labourClassId.trim());
  if (!labourClass || !labourClass.active) return 'Select an active Labour Class from this business.';
  return null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTimeEntryOpenLike(entry) {
  if (entry?.status === 'clocked_in') return true;
  return !isNonEmptyString(entry?.clockOut);
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateInvoiceRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Invoice id is required.';
  if (!isNonEmptyString(record.jobId)) return 'Invoice job is required.';
  if (!isNonEmptyString(record.customerId)) return 'Invoice customer is required.';
  if (!isNonEmptyString(record.number)) return 'Invoice number is required.';
  if (!isValidDateOnly(record.issueDate)) return 'Invoice issue date must use YYYY-MM-DD format.';
  if (!isValidDateOnly(record.dueDate)) return 'Invoice due date must use YYYY-MM-DD format.';
  if (!INVOICE_STATUSES.has(record.status)) return 'Invoice status is invalid.';
  if (typeof record.amount !== 'number' || Number.isNaN(record.amount) || record.amount <= 0) {
    return 'Invoice amount must be greater than 0.';
  }
  if (record.lineItems !== undefined) {
    return validateInvoiceLineItems(record.lineItems, record.taxRate);
  }
  return null;
}

function validateExpenseRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Expense id is required.';
  if (!isNonEmptyString(record.vendor)) return 'Vendor is required.';
  if (!isNonEmptyString(record.description)) return 'Description is required.';
  if (!EXPENSE_CATEGORIES.has(record.category)) return 'Expense category is invalid.';
  if (!isValidDateOnly(record.expenseDate)) return 'Expense date must use YYYY-MM-DD format.';
  if (typeof record.amount !== 'number' || Number.isNaN(record.amount) || record.amount <= 0) {
    return 'Expense amount must be greater than 0.';
  }
  if (!EXPENSE_STATUSES.has(record.status)) return 'Expense status is invalid.';
  if (typeof record.notes !== 'string') return 'Expense notes must be a string.';
  if (record.receiptUrl !== undefined && record.receiptUrl !== null && typeof record.receiptUrl !== 'string') {
    return 'Expense receipt URL is invalid.';
  }
  if (record.jobId !== undefined && record.jobId !== null && typeof record.jobId !== 'string') {
    return 'Expense job is invalid.';
  }
  return null;
}

function validateEquipmentAssetRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Equipment id is required.';
  if (!isNonEmptyString(record.name)) return 'Equipment name is required.';
  if (!isNonEmptyString(record.type)) return 'Equipment type is required.';
  if (!EQUIPMENT_STATUSES.has(record.status)) return 'Equipment status is invalid.';
  if (!EQUIPMENT_COST_TYPES.has(record.costType)) return 'Equipment cost type is invalid.';
  if (record.serialNumber !== undefined && record.serialNumber !== null && typeof record.serialNumber !== 'string') {
    return 'Equipment serial number is invalid.';
  }
  if (record.purchaseDate !== undefined && record.purchaseDate !== null && record.purchaseDate !== '' && !isValidDateOnly(record.purchaseDate)) {
    return 'Equipment purchase date must use YYYY-MM-DD format.';
  }
  if (typeof record.hourlyCost !== 'number' || Number.isNaN(record.hourlyCost) || record.hourlyCost < 0) {
    return 'Equipment hourly cost must be zero or greater.';
  }
  for (const [field, label] of [
    ['costRateHourly', 'Equipment cost rate'],
    ['recommendedSellRate', 'Equipment recommended rate'],
    ['chargeOutRate', 'Equipment charge-out rate'],
  ]) {
    if (record[field] !== undefined && record[field] !== null && (!isFiniteNumber(record[field]) || record[field] < 0)) {
      return `${label} must be zero or greater.`;
    }
  }
  if (record.purchasePrice !== undefined && record.purchasePrice !== null && (!isFiniteNumber(record.purchasePrice) || record.purchasePrice < 0)) {
    return 'Equipment purchase price must be zero or greater.';
  }
  if (record.equipmentClassification !== undefined && record.equipmentClassification !== null && !['billable', 'overhead'].includes(record.equipmentClassification)) {
    return 'Equipment classification must be billable or overhead.';
  }
  if (record.equipmentPayment !== undefined && record.equipmentPayment !== null && (!isFiniteNumber(record.equipmentPayment) || record.equipmentPayment < 0)) {
    return 'Equipment payment must be zero or greater.';
  }
  if (
    record.equipmentPaymentFrequencyPerYear !== undefined
    && record.equipmentPaymentFrequencyPerYear !== null
    && (!isFiniteNumber(record.equipmentPaymentFrequencyPerYear) || record.equipmentPaymentFrequencyPerYear < 0)
  ) {
    return 'Equipment payment frequency must be zero or greater.';
  }
  if (record.fuelPriceUnit !== undefined && record.fuelPriceUnit !== null && record.fuelPriceUnit !== 'L' && record.fuelPriceUnit !== 'gal') {
    return 'Fuel price unit is invalid.';
  }
  if (record.averageFuelPrice !== undefined && record.averageFuelPrice !== null && (!isFiniteNumber(record.averageFuelPrice) || record.averageFuelPrice < 0)) {
    return 'Average fuel price must be zero or greater.';
  }
  if (record.yearlyFuelCost !== undefined && record.yearlyFuelCost !== null && (!isFiniteNumber(record.yearlyFuelCost) || record.yearlyFuelCost < 0)) {
    return 'Yearly fuel cost must be zero or greater.';
  }
  if (record.rentalCost !== undefined && record.rentalCost !== null && (!isFiniteNumber(record.rentalCost) || record.rentalCost < 0)) {
    return 'Rental cost must be zero or greater.';
  }
  if (record.rentalUnit !== undefined && record.rentalUnit !== null && !['hr', 'day', 'week', 'month'].includes(record.rentalUnit)) {
    return 'Rental unit is invalid.';
  }
  if (record.costType === 'rental' && (!isFiniteNumber(record.rentalCost) || !['hr', 'day', 'week', 'month'].includes(record.rentalUnit))) {
    return 'Rental equipment requires a rental cost and unit.';
  }
  if (
    record.averageFuelBurnPerHour !== undefined
    && record.averageFuelBurnPerHour !== null
    && (!isFiniteNumber(record.averageFuelBurnPerHour) || record.averageFuelBurnPerHour < 0)
  ) {
    return 'Average fuel burned per hour must be zero or greater.';
  }
  if (record.yearlyInsuranceCost !== undefined && record.yearlyInsuranceCost !== null && (!isFiniteNumber(record.yearlyInsuranceCost) || record.yearlyInsuranceCost < 0)) {
    return 'Yearly insurance cost must be zero or greater.';
  }
  if (record.yearlyMaintenanceCost !== undefined && record.yearlyMaintenanceCost !== null && (!isFiniteNumber(record.yearlyMaintenanceCost) || record.yearlyMaintenanceCost < 0)) {
    return 'Yearly maintenance cost must be zero or greater.';
  }
  if (record.currentJobId !== undefined && record.currentJobId !== null && typeof record.currentJobId !== 'string') {
    return 'Equipment job assignment is invalid.';
  }
  if (typeof record.notes !== 'string') return 'Equipment notes must be a string.';
  return null;
}

function validateMaterialCatalogItemRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Material id is required.';
  if (!isNonEmptyString(record.name)) return 'Material name is required.';
  if (!isNonEmptyString(record.unit)) return 'Material unit is required.';
  if (typeof record.defaultUnitCost !== 'number' || Number.isNaN(record.defaultUnitCost) || record.defaultUnitCost < 0) {
    return 'Material default unit cost must be zero or greater.';
  }
  if (typeof record.notes !== 'string') return 'Material notes must be a string.';
  return null;
}

function validateSubcontractorCatalogItemRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Subcontractor id is required.';
  if (!isNonEmptyString(record.name)) return 'Subcontractor company name is required.';
  if (!isNonEmptyString(record.unit)) return 'Subcontractor unit is required.';
  if (!isFiniteNumber(record.defaultUnitCost) || record.defaultUnitCost < 0) return 'Subcontractor default cost must be zero or greater.';
  for (const field of ['contactName', 'email', 'phone', 'trade', 'notes']) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string') return `Subcontractor ${field} is invalid.`;
  }
  return null;
}

function validateUnbillableTimeCategoryRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Category id is required.';
  if (!isNonEmptyString(record.name)) return 'Category name is required.';
  if (record.name.trim().length > 80) return 'Category name cannot exceed 80 characters.';
  if (record.description !== undefined && record.description !== null && typeof record.description !== 'string') {
    return 'Category description is invalid.';
  }
  if (!isFiniteNumber(record.sortOrder)) {
    return 'Sort order must be a number.';
  }
  if (typeof record.active !== 'boolean') {
    return 'Active flag is required.';
  }
  return null;
}

function validateRecoveryPolicy(policy) {
  if (policy === undefined || policy === null) return null;
  if (policy.version !== 2 || !policy.allocation || typeof policy.allocation !== 'object') return 'Overhead recovery policy is invalid.';
  const fields = ['labourPercent', 'equipmentPercent', 'materialsPercent', 'subcontractorsPercent'];
  if (fields.some((field) => !isFiniteNumber(policy.allocation[field]) || policy.allocation[field] < 0 || policy.allocation[field] > 100)) return 'Overhead recovery percentages must be between 0 and 100.';
  const total = fields.reduce((sum, field) => sum + policy.allocation[field], 0);
  return Math.abs(total - 100) < 0.001 ? null : 'Overhead recovery percentages must total 100%.';
}

function validateBudgetRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Budget id is required.';
  if (!isNonEmptyString(record.name)) return 'Budget name is required.';
  if (!BUDGET_TYPES.has(record.budgetType)) return 'Budget type is invalid.';
  if (!isNonEmptyString(record.division)) return 'Budget division is required.';
  if (typeof record.fiscalYear !== 'string' || !YEAR_REGEX.test(record.fiscalYear)) {
    return 'Fiscal year must use YYYY format.';
  }
  if (record.description !== undefined && typeof record.description !== 'string') return 'Budget description is invalid.';
  if (record.startDate !== undefined && (!isNonEmptyString(record.startDate) || !DATE_REGEX.test(record.startDate))) {
    return 'Budget start date must use YYYY-MM-DD format.';
  }
  if (record.endDate !== undefined && (!isNonEmptyString(record.endDate) || !DATE_REGEX.test(record.endDate))) {
    return 'Budget end date must use YYYY-MM-DD format.';
  }
  if (record.startDate && record.endDate && record.startDate > record.endDate) {
    return 'Budget end date must be on or after the start date.';
  }
  if (record.planningModel !== undefined && record.planningModel !== 'divisions_v1') {
    return 'Budget planning model is invalid.';
  }
  if (!BUDGET_STATUSES.has(record.status)) return 'Budget status is invalid.';
  const recoveryError = validateRecoveryPolicy(record.overheadRecoveryPolicy);
  if (recoveryError) return recoveryError;
  return null;
}

function validateBudgetItemRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Budget item id is required.';
  if (record.budgetId !== undefined && record.budgetId !== null && !isNonEmptyString(record.budgetId)) {
    return 'Budget item budget id is invalid.';
  }
  if (!BUDGET_ITEM_CATEGORIES.has(record.category)) return 'Budget item category is invalid.';
  if (!isNonEmptyString(record.description)) return 'Budget item description is required.';
  if (!isFiniteNumber(record.budgeted) || record.budgeted < 0) return 'Budget item budgeted must be zero or greater.';
  if (!isFiniteNumber(record.actual) || record.actual < 0) return 'Budget item actual must be zero or greater.';
  if (!isNonEmptyString(record.period) || !PERIOD_REGEX.test(record.period)) {
    return 'Budget item period must use YYYY-MM format.';
  }

  if (record.category !== 'equipment') {
    return null;
  }

  if (record.equipmentCostType !== undefined && record.equipmentCostType !== null && !EQUIPMENT_COST_TYPES.has(record.equipmentCostType)) {
    return 'Budget item equipment cost type is invalid.';
  }
  if (record.equipmentClassification !== undefined && record.equipmentClassification !== null && !['billable', 'overhead'].includes(record.equipmentClassification)) {
    return 'Equipment classification must be billable or overhead.';
  }
  if (record.equipmentId !== undefined && record.equipmentId !== null && !isNonEmptyString(record.equipmentId)) {
    return 'Budget item equipment id is invalid.';
  }
  if (record.equipmentPayment !== undefined && record.equipmentPayment !== null && (!isFiniteNumber(record.equipmentPayment) || record.equipmentPayment < 0)) {
    return 'Equipment payment must be zero or greater.';
  }
  if (
    record.equipmentPaymentFrequencyPerYear !== undefined
    && record.equipmentPaymentFrequencyPerYear !== null
    && (!isFiniteNumber(record.equipmentPaymentFrequencyPerYear) || record.equipmentPaymentFrequencyPerYear < 0)
  ) {
    return 'Equipment payment frequency must be zero or greater.';
  }
  if (record.fuelPriceUnit !== undefined && record.fuelPriceUnit !== null && record.fuelPriceUnit !== 'L' && record.fuelPriceUnit !== 'gal') {
    return 'Fuel price unit is invalid.';
  }
  if (record.averageFuelPrice !== undefined && record.averageFuelPrice !== null && (!isFiniteNumber(record.averageFuelPrice) || record.averageFuelPrice < 0)) {
    return 'Average fuel price must be zero or greater.';
  }
  if (record.yearlyFuelCost !== undefined && record.yearlyFuelCost !== null && (!isFiniteNumber(record.yearlyFuelCost) || record.yearlyFuelCost < 0)) {
    return 'Yearly fuel cost must be zero or greater.';
  }
  if (
    record.averageFuelBurnPerHour !== undefined
    && record.averageFuelBurnPerHour !== null
    && (!isFiniteNumber(record.averageFuelBurnPerHour) || record.averageFuelBurnPerHour < 0)
  ) {
    return 'Average fuel burned per hour must be zero or greater.';
  }
  if (record.fuelCostPerHour !== undefined && record.fuelCostPerHour !== null && (!isFiniteNumber(record.fuelCostPerHour) || record.fuelCostPerHour < 0)) {
    return 'Fuel cost per hour must be zero or greater.';
  }
  if (record.yearlyInsuranceCost !== undefined && record.yearlyInsuranceCost !== null && (!isFiniteNumber(record.yearlyInsuranceCost) || record.yearlyInsuranceCost < 0)) {
    return 'Yearly insurance cost must be zero or greater.';
  }
  if (record.yearlyMaintenanceCost !== undefined && record.yearlyMaintenanceCost !== null && (!isFiniteNumber(record.yearlyMaintenanceCost) || record.yearlyMaintenanceCost < 0)) {
    return 'Yearly maintenance cost must be zero or greater.';
  }
  if (record.equipmentHoursPerDay !== undefined && record.equipmentHoursPerDay !== null && (!isFiniteNumber(record.equipmentHoursPerDay) || record.equipmentHoursPerDay < 0)) {
    return 'Equipment hours per day must be zero or greater.';
  }
  if (record.sellableHoursPerYear !== undefined && record.sellableHoursPerYear !== null && (!isFiniteNumber(record.sellableHoursPerYear) || record.sellableHoursPerYear < 0)) {
    return 'Sellable hours per year must be zero or greater.';
  }
  if (
    record.actualMachineHoursPerYear !== undefined
    && record.actualMachineHoursPerYear !== null
    && (!isFiniteNumber(record.actualMachineHoursPerYear) || record.actualMachineHoursPerYear < 0)
  ) {
    return 'Actual machine hours per year must be zero or greater.';
  }
  if (record.monthsUsedPerYear !== undefined && record.monthsUsedPerYear !== null) {
    if (!Number.isInteger(record.monthsUsedPerYear) || record.monthsUsedPerYear < 1 || record.monthsUsedPerYear > 12) {
      return 'Months used per year must be a whole number between 1 and 12.';
    }
  }
  if (
    record.equipmentCostAllocationPercent !== undefined
    && record.equipmentCostAllocationPercent !== null
    && (!isFiniteNumber(record.equipmentCostAllocationPercent) || record.equipmentCostAllocationPercent < 0)
  ) {
    return 'Equipment cost allocation percent must be zero or greater.';
  }
  if (record.sortOrder !== undefined && record.sortOrder !== null && (!Number.isInteger(record.sortOrder) || record.sortOrder < 0)) {
    return 'Equipment sort order must be a non-negative whole number.';
  }

  return null;
}

function applyEquipmentAllocationCost(record, allocationMonths) {
  if (allocationMonths === undefined || allocationMonths === null) return { ok: true, record };
  if (record.category !== 'equipment' || !isNonEmptyString(record.budgetId) || !isNonEmptyString(record.equipmentId)) {
    return { ok: false, error: 'Equipment allocation requires a grouped budget and catalog equipment.' };
  }
  if (!Number.isFinite(allocationMonths) || allocationMonths <= 0 || allocationMonths > 12) {
    return { ok: false, error: 'Allocated months must be greater than 0 and no more than 12.' };
  }
  return {
    ok: true,
    record: { ...record, budgeted: record.budgeted * (allocationMonths / 12) },
  };
}

function isValidIsoDateTime(value) {
  if (!isNonEmptyString(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function uniqueStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0))];
}

function validateJobScheduleOccurrence(occurrence) {
  if (!occurrence || typeof occurrence !== 'object' || Array.isArray(occurrence) || !isNonEmptyString(occurrence.id)) {
    return 'Job schedule occurrence id is required.';
  }
  if (typeof occurrence.scheduleAllDay !== 'boolean') return 'Job schedule occurrence all-day flag is invalid.';
  if (!Array.isArray(occurrence.assignedEmployeeIds) || occurrence.assignedEmployeeIds.some((value) => !isNonEmptyString(value))) {
    return 'Job schedule occurrence employees are invalid.';
  }
  if (occurrence.scheduledStartAt !== undefined && occurrence.scheduledStartAt !== null && occurrence.scheduledStartAt !== '' && !isValidIsoDateTime(occurrence.scheduledStartAt)) {
    return 'Job schedule occurrence start must be a valid ISO datetime.';
  }
  if (occurrence.scheduledEndAt !== undefined && occurrence.scheduledEndAt !== null && occurrence.scheduledEndAt !== '' && !isValidIsoDateTime(occurrence.scheduledEndAt)) {
    return 'Job schedule occurrence end must be a valid ISO datetime.';
  }
  if (!occurrence.scheduleAllDay && (!isNonEmptyString(occurrence.scheduledStartAt) || !isNonEmptyString(occurrence.scheduledEndAt))) {
    return 'Timed Job schedule occurrences require a start and end.';
  }
  if (isNonEmptyString(occurrence.scheduledStartAt) && isNonEmptyString(occurrence.scheduledEndAt) && Date.parse(occurrence.scheduledEndAt) < Date.parse(occurrence.scheduledStartAt)) {
    return 'Job schedule occurrence end must be on or after the start.';
  }
  return null;
}

function validateJobRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Job id is required.';
  if (!isNonEmptyString(record.customerId)) return 'Job customer is required.';
  if (!isNonEmptyString(record.title)) return 'Job title is required.';
  if (!JOB_STATUSES.has(record.status)) return 'Job status is invalid.';
  if (!isValidDateOnly(record.startDate)) return 'Job start date must use YYYY-MM-DD format.';
  if (record.endDate !== undefined && record.endDate !== null && record.endDate !== '' && !isValidDateOnly(record.endDate)) {
    return 'Job end date must use YYYY-MM-DD format.';
  }
  if (record.scheduleConfirmed !== undefined && typeof record.scheduleConfirmed !== 'boolean') {
    return 'Job schedule confirmed flag is invalid.';
  }
  if (record.scheduleAllDay !== undefined && typeof record.scheduleAllDay !== 'boolean') {
    return 'Job schedule all-day flag is invalid.';
  }
  if (record.scheduledStartAt !== undefined && record.scheduledStartAt !== null && record.scheduledStartAt !== '' && !isValidIsoDateTime(record.scheduledStartAt)) {
    return 'Job scheduled start must be a valid ISO datetime.';
  }
  if (record.scheduledEndAt !== undefined && record.scheduledEndAt !== null && record.scheduledEndAt !== '' && !isValidIsoDateTime(record.scheduledEndAt)) {
    return 'Job scheduled end must be a valid ISO datetime.';
  }
  if (
    isNonEmptyString(record.scheduledStartAt)
    && isNonEmptyString(record.scheduledEndAt)
    && Date.parse(record.scheduledEndAt) < Date.parse(record.scheduledStartAt)
  ) {
    return 'Job scheduled end must be on or after the scheduled start.';
  }
  if (record.scheduleNotes !== undefined && record.scheduleNotes !== null && typeof record.scheduleNotes !== 'string') {
    return 'Job schedule notes must be a string.';
  }
  if (record.scheduleOccurrences !== undefined) {
    if (!Array.isArray(record.scheduleOccurrences)) return 'Job schedule occurrences are invalid.';
    const ids = record.scheduleOccurrences.map((occurrence) => occurrence?.id);
    if (new Set(ids).size !== ids.length) return 'Job schedule occurrence ids must be unique.';
    for (const occurrence of record.scheduleOccurrences) {
      const occurrenceError = validateJobScheduleOccurrence(occurrence);
      if (occurrenceError) return occurrenceError;
    }
  }
  if (record.crewId !== undefined && record.crewId !== null && !isNonEmptyString(record.crewId)) {
    return 'Job crew is invalid.';
  }
  if (record.divisionId !== undefined && record.divisionId !== null && !isNonEmptyString(record.divisionId)) {
    return 'Job division is invalid.';
  }
  if (!Array.isArray(record.assignedEmployeeIds) || record.assignedEmployeeIds.some((value) => typeof value !== 'string' || !value.trim())) {
    return 'Assigned employees are invalid.';
  }
  if (Array.isArray(record.assignedEquipmentIds) && record.assignedEquipmentIds.some((value) => typeof value !== 'string' || !value.trim())) {
    return 'Assigned equipment is invalid.';
  }
  if (record.taskHeaderLabels !== undefined) {
    if (!record.taskHeaderLabels || typeof record.taskHeaderLabels !== 'object' || Array.isArray(record.taskHeaderLabels)) {
      return 'Job task header labels are invalid.';
    }
    const invalidKey = Object.keys(record.taskHeaderLabels).some((key) => !['all', 'completed'].includes(key));
    const invalidLabel = Object.values(record.taskHeaderLabels).some((label) => typeof label !== 'string' || !label.trim() || label.trim().length > 30);
    if (invalidKey || invalidLabel) return 'Job task header labels are invalid.';
  }
  return null;
}

async function validateJobRelationships({ businessId, record }) {
  const occurrenceEmployeeIds = Array.isArray(record.scheduleOccurrences)
    ? record.scheduleOccurrences.flatMap((occurrence) => uniqueStringList(occurrence.assignedEmployeeIds))
    : [];
  const assignedEmployeeIds = uniqueStringList([...record.assignedEmployeeIds, ...occurrenceEmployeeIds]);
  const assignedEquipmentIds = uniqueStringList(record.assignedEquipmentIds);

  if (isNonEmptyString(record.crewId) && !await getCrewForBusiness(businessId, record.crewId)) {
    return 'Assigned crew must belong to this business.';
  }
  if (isNonEmptyString(record.divisionId) && !await getDivisionForBusiness(businessId, record.divisionId)) {
    return 'Assigned division must belong to this business.';
  }

  for (const employeeId of assignedEmployeeIds) {
    const employee = await getEmployeeForBusiness(businessId, employeeId);
    if (!employee) {
      return 'Assigned employees must belong to this business.';
    }
  }

  for (const equipmentId of assignedEquipmentIds) {
    const equipment = await getEquipmentAssetForBusiness(businessId, equipmentId);
    if (!equipment) {
      return 'Assigned equipment must belong to this business.';
    }
  }

  return null;
}

async function validateBudgetItemRelationships({ businessId, record }) {
  if (record.category !== 'equipment') {
    return null;
  }

  if (!isNonEmptyString(record.equipmentId)) {
    return null;
  }

  const equipment = await getEquipmentAssetForBusiness(businessId, record.equipmentId);
  if (!equipment) {
    return 'Linked equipment must belong to this business.';
  }

  if (!isNonEmptyString(record.budgetId) || !isNonEmptyString(record.period) || !PERIOD_REGEX.test(record.period)) {
    return null;
  }

  const recordYear = record.period.slice(0, 4);
  const budgetItems = await listBudgetItemsForBusiness(businessId);
  const duplicate = budgetItems.find((item) => {
    if (item.id === record.id) return false;
    if (item.category !== 'equipment') return false;
    if (!isNonEmptyString(item.budgetId) || item.budgetId !== record.budgetId) return false;
    if (!isNonEmptyString(item.period) || item.period.slice(0, 4) !== recordYear) return false;
    return item.equipmentId === record.equipmentId;
  });

  if (duplicate) {
    return 'This equipment is already linked to this budget for the selected fiscal year.';
  }

  return null;
}

function validateEstimateLineItem(item) {
  if (!isNonEmptyString(item?.id)) return 'Line item id is required.';
  if (!ESTIMATE_LINE_ITEM_CATEGORIES.has(item?.category)) return 'Line item category is invalid.';
  if (!isNonEmptyString(item?.unit)) return 'Line item unit is required.';
  if (!isFiniteNumber(item?.quantity) || item.quantity < 0) return 'Line item quantity must be zero or greater.';
  if (!isFiniteNumber(item?.unitCost) || item.unitCost < 0) return 'Line item unit cost must be zero or greater.';
  if (!isFiniteNumber(item?.total) || item.total < 0) return 'Line item total must be zero or greater.';
  if (item.markup !== undefined && (!isFiniteNumber(item.markup) || item.markup < 0)) {
    return 'Line item markup must be zero or greater.';
  }
  if (item.markupPercent !== undefined && (!isFiniteNumber(item.markupPercent) || item.markupPercent < 0)) {
    return 'Line item markup percent must be zero or greater.';
  }
  return null;
}

function estimateLineItems(record) {
  return [
    ...(Array.isArray(record?.lineItems) ? record.lineItems : []),
    ...(Array.isArray(record?.workAreas) ? record.workAreas.flatMap((area) => Array.isArray(area?.lineItems) ? area.lineItems : []) : []),
  ];
}

function validateEstimateRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Estimate id is required.';
  if (!isNonEmptyString(record.customerId)) return 'Estimate customer is required.';
  if (!isNonEmptyString(record.title)) return 'Estimate title is required.';
  if (record.pricingBudgetId !== undefined && record.pricingBudgetId !== null && !isNonEmptyString(record.pricingBudgetId)) {
    return 'Estimate pricing budget is invalid.';
  }
  if (!ESTIMATE_STATUSES.has(record.status)) return 'Estimate status is invalid.';
  if (!isFiniteNumber(record.taxRate) || record.taxRate < 0 || record.taxRate > 100) {
    return 'Estimate tax rate must be between 0 and 100.';
  }
  if (typeof record.description !== 'string') return 'Estimate description must be a string.';
  if (typeof record.notes !== 'string') return 'Estimate notes must be a string.';
  const validUntilDate = typeof record.validUntil === 'string' ? record.validUntil.slice(0, 10) : '';
  if (!isNonEmptyString(validUntilDate) || !isValidDateOnly(validUntilDate)) {
    return 'Estimate valid-until date must use YYYY-MM-DD format.';
  }

  if (record.propertyLabel !== undefined && record.propertyLabel !== null && typeof record.propertyLabel !== 'string') {
    return 'Estimate property label is invalid.';
  }
  if (
    record.propertyAddressSnapshot !== undefined
    && record.propertyAddressSnapshot !== null
    && typeof record.propertyAddressSnapshot !== 'string'
  ) {
    return 'Estimate property address snapshot is invalid.';
  }

  if (record.workAreas !== undefined && record.workAreas !== null) {
    if (!Array.isArray(record.workAreas)) return 'Estimate work areas must be an array.';
    for (const area of record.workAreas) {
      if (typeof area === 'string') continue;
      if (!area || typeof area !== 'object') return 'Estimate work area is invalid.';
      if (!isNonEmptyString(area.id)) return 'Estimate work area id is required.';
      if (!isNonEmptyString(area.name)) return 'Estimate work area name is required.';
      if (area.description !== undefined && area.description !== null && typeof area.description !== 'string') {
        return 'Estimate work area description is invalid.';
      }
      if (area.sortOrder !== undefined && area.sortOrder !== null && (!isFiniteNumber(area.sortOrder) || area.sortOrder < 0)) {
        return 'Estimate work area sort order is invalid.';
      }
      if (!Array.isArray(area.lineItems)) return 'Estimate work area line items must be an array.';
      for (const lineItem of area.lineItems) {
        const lineItemError = validateEstimateLineItem(lineItem);
        if (lineItemError) return lineItemError;
      }
    }
  }

  if (record.lineItems !== undefined && record.lineItems !== null) {
    if (!Array.isArray(record.lineItems)) return 'Estimate line items must be an array.';
    for (const lineItem of record.lineItems) {
      const lineItemError = validateEstimateLineItem(lineItem);
      if (lineItemError) return lineItemError;
    }
  }

  return null;
}

async function authorizeEstimatePricing({ businessId, existing, estimate }) {
  const hasBudgetSources = estimateLineItems(estimate).some((item) => Boolean(item?.sourceBudgetItemId));
  if (!hasBudgetSources) return { ok: true, estimate };
  const budget = await getBudgetForBusiness(businessId, estimate.pricingBudgetId);
  if (!budget || budget.planningModel !== 'divisions_v1') return { ok: false, error: 'Estimate Pricing Budget is invalid.' };
  const [planningItems, budgetDivisions, budgetRates, employees, equipmentAssets, labourClasses, materialCatalogItems] = await Promise.all([
    listDivisionPlanningItemsForBusiness(businessId),
    listBudgetDivisionsForBusiness(businessId),
    listBudgetRatesForBusiness(businessId),
    listEmployeesForBusiness(businessId),
    listEquipmentAssetsForBusiness(businessId),
    listLabourClassesForBusiness(businessId),
    listMaterialCatalogItemsForBusiness(businessId),
  ]);
  const catalog = buildEstimatePricingCatalog({ budget, budgetId: budget.id, divisions: budgetDivisions.filter((division) => division.budgetId === budget.id), includeAllDivisions: true, planningItems, budgetRates, employees, equipmentAssets, labourClasses, materialCatalogItems });
  return applyAuthoritativeEstimatePricing({ existingEstimate: existing, nextEstimate: estimate, catalog });
}

async function validateEstimatePricingDivision({ businessId, estimate, existing }) {
  if (!isNonEmptyString(estimate.pricingBudgetId)) return 'Estimate Pricing Budget is required.';
  const budget = await getBudgetForBusiness(businessId, estimate.pricingBudgetId);
  if (!budget) return 'Estimate Pricing Budget is invalid.';
  const workAreas = Array.isArray(estimate.workAreas) ? estimate.workAreas.filter((area) => area && typeof area === 'object') : [];
  if (!isNonEmptyString(estimate.divisionId) || workAreas.length === 0 || workAreas.some((area) => area.divisionId !== estimate.divisionId)) {
    return 'Estimate Division is required.';
  }
  const division = await getBudgetDivisionForBusiness(businessId, estimate.pricingBudgetId, estimate.divisionId);
  if (!division) return 'Estimate Division must belong to the selected Pricing Budget.';
  if (division.status !== 'active') {
    const existingAreaDivision = Array.isArray(existing?.workAreas)
      ? existing.workAreas.find((area) => isNonEmptyString(area?.divisionId))?.divisionId
      : undefined;
    const unchangedHistoricalDivision = existing
      && existing.pricingBudgetId === estimate.pricingBudgetId
      && (existing.divisionId ?? existingAreaDivision) === estimate.divisionId;
    if (!unchangedHistoricalDivision) return 'Estimate Division must be active and belong to the selected Pricing Budget.';
  }
  return null;
}

function ensureDefaultEstimateWorkArea(record) {
  return ensureDefaultEstimateWorkAreaModel(record, generateId);
}

function validateBudgetRateRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Budget rate id is required.';
  if (!isNonEmptyString(record.budgetId)) return 'Budget rate budget id is required.';
  if (!BUDGET_RATE_CATEGORIES.has(record.category)) return 'Budget rate category is invalid.';
  if (!isNonEmptyString(record.itemName)) return 'Budget rate item name is required.';
  if (!isNonEmptyString(record.unit)) return 'Budget rate unit is required.';
  if (!isFiniteNumber(record.unitCost) || record.unitCost < 0) return 'Budget rate unit cost must be zero or greater.';
  if (record.pricingVersion !== undefined && record.pricingVersion !== 2) return 'Budget rate pricing version is invalid.';
  if (record.pricingVersion === 2 && !isNonEmptyString(record.divisionId)) return 'Version 2 Budget rates require a Division.';
  for (const [field, label] of [
    ['budgetItemId', 'Budget item'],
    ['employeeId', 'Employee'],
    ['equipmentId', 'Equipment'],
    ['materialCatalogItemId', 'Material'],
    ['vendorId', 'Vendor'],
  ]) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string') {
      return `${label} pricing identity is invalid.`;
    }
  }
  for (const [field, label] of [
    ['overheadRecoveryPerUnit', 'Budget rate overhead recovery'],
    ['targetMarginPercent', 'Budget rate target margin'],
    ['recommendedSellPrice', 'Budget rate recommended sell price'],
    ['customRate', 'Budget rate custom rate'],
    ['directCostPerUnit', 'Budget rate direct cost'],
    ['divisionOverheadRecoveryPerUnit', 'Budget rate Division overhead recovery'],
    ['companyOverheadRecoveryPerUnit', 'Budget rate Company overhead recovery'],
    ['recoveredCostPerUnit', 'Budget rate recovered cost'],
  ]) {
    if (record[field] !== undefined && record[field] !== null && (!isFiniteNumber(record[field]) || record[field] < 0)) {
      return `${label} must be zero or greater.`;
    }
  }
  if (!isFiniteNumber(record.defaultMarkupPercent) || record.defaultMarkupPercent < 0) {
    return 'Budget rate default markup percent must be zero or greater.';
  }
  if (!isFiniteNumber(record.defaultSellPrice) || record.defaultSellPrice < 0) {
    return 'Budget rate default sell price must be zero or greater.';
  }
  if (record.description !== undefined && record.description !== null && typeof record.description !== 'string') {
    return 'Budget rate description is invalid.';
  }
  if (record.active !== undefined && typeof record.active !== 'boolean') {
    return 'Budget rate active flag is invalid.';
  }
  if (record.sortOrder !== undefined && (!isFiniteNumber(record.sortOrder) || record.sortOrder < 0)) {
    return 'Budget rate sort order is invalid.';
  }
  return null;
}

async function validateBudgetRateRelationships(businessId, record) {
  const budget = await getBudgetForBusiness(businessId, record.budgetId);
  if (!budget) return 'Budget rate Budget must belong to this business.';
  if (record.divisionId && !await getBudgetDivisionForBusiness(businessId, record.budgetId, record.divisionId)) return 'Budget rate Division must belong to the selected Budget.';
  if (record.employeeId && !await getEmployeeForBusiness(businessId, record.employeeId)) return 'Budget rate Employee must belong to this business.';
  if (record.equipmentId && !await getEquipmentAssetForBusiness(businessId, record.equipmentId)) return 'Budget rate Equipment must belong to this business.';
  if (record.materialCatalogItemId && !await getMaterialCatalogItemForBusiness(businessId, record.materialCatalogItemId)) return 'Budget rate Material must belong to this business.';
  if (!record.budgetItemId) return null;

  const categoryMap = { labour: 'labour', equipment: 'equipment', material: 'materials', subcontractor: 'subcontractors' };
  const planningItems = await listDivisionPlanningItemsForBusiness(businessId);
  const averageLabourId = record.divisionId ? `average-labour:${record.divisionId}` : '';
  if (record.category === 'labour' && record.pricingVersion === 2 && record.budgetItemId === averageLabourId) {
    const hasBillableLabour = planningItems.some((item) => item.budgetId === record.budgetId
      && item.category === 'labour'
      && item.labourClassification !== 'overhead'
      && item.divisionAllocations?.some((allocation) => allocation.divisionId === record.divisionId && Number(allocation.hours ?? allocation.percentage ?? 0) > 0));
    return hasBillableLabour ? null : 'Average Labour pricing requires planned billable Labour in the selected Division.';
  }
  const item = planningItems.find((value) => value.id === record.budgetItemId && value.budgetId === record.budgetId && value.category === categoryMap[record.category]);
  if (!item) return 'Budget pricing item must belong to the selected Budget.';
  if (record.employeeId && item.employeeId !== record.employeeId) return 'Budget pricing Employee does not match its Budget item.';
  if (record.equipmentId && item.equipmentId !== record.equipmentId) return 'Budget pricing Equipment does not match its Budget item.';
  if (record.materialCatalogItemId && item.materialCatalogItemId !== record.materialCatalogItemId) return 'Budget pricing Material does not match its Budget item.';
  if (record.vendorId && item.vendorId !== record.vendorId) return 'Budget pricing Vendor does not match its Budget item.';
  return null;
}

function validateLabourBudgetPlanRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Labour plan id is required.';
  if (!isNonEmptyString(record.budgetId)) return 'Labour plan budget id is required.';
  if (!isNonEmptyString(record.employeeId)) return 'Labour plan employee id is required.';
  if (!isNonEmptyString(record.year) || !YEAR_REGEX.test(record.year)) return 'Labour plan year must use YYYY format.';
  if (record.compType !== 'hourly' && record.compType !== 'salaried') {
    return 'Labour plan compensation type is invalid.';
  }
  if (record.description !== undefined && record.description !== null && typeof record.description !== 'string') {
    return 'Labour plan description must be a string.';
  }
  if (record.sortOrder !== undefined && record.sortOrder !== null && !isFiniteNumber(record.sortOrder)) {
    return 'Labour plan sort order must be a number.';
  }
  if (!isFiniteNumber(record.billableHoursYear) || record.billableHoursYear < 0) {
    return 'Labour plan billable hours per year must be zero or greater.';
  }
  if (!isFiniteNumber(record.unbillableHoursYear) || record.unbillableHoursYear < 0) {
    return 'Labour plan unbillable hours per year must be zero or greater.';
  }
  if (!isFiniteNumber(record.overtimeHoursYear) || record.overtimeHoursYear < 0) {
    return 'Labour plan overtime hours per year must be zero or greater.';
  }
  if (!isFiniteNumber(record.overtimeMultiplier) || record.overtimeMultiplier < 1) {
    return 'Labour plan overtime multiplier must be at least 1.';
  }
  if (!isFiniteNumber(record.hourlyRate) || record.hourlyRate < 0) {
    return 'Labour plan hourly rate must be zero or greater.';
  }
  if (!isFiniteNumber(record.annualSalary) || record.annualSalary < 0) {
    return 'Labour plan annual salary must be zero or greater.';
  }
  if (!isFiniteNumber(record.labourBurdenPct) || record.labourBurdenPct < 0) {
    return 'Labour plan labour burden percent must be zero or greater.';
  }
  if (record.hoursPerYear !== undefined && record.hoursPerYear !== null && (!isFiniteNumber(record.hoursPerYear) || record.hoursPerYear < 0)) {
    return 'Labour plan hours per year must be zero or greater.';
  }
  if (record.billablePct !== undefined && record.billablePct !== null && (!isFiniteNumber(record.billablePct) || record.billablePct < 0 || record.billablePct > 100)) {
    return 'Labour plan billable percent must be between 0 and 100.';
  }
  if (record.payrollBurdenPct !== undefined && record.payrollBurdenPct !== null && (!isFiniteNumber(record.payrollBurdenPct) || record.payrollBurdenPct < 0)) {
    return 'Labour plan payroll burden percent must be zero or greater.';
  }
  if (record.benefitsExtraCost !== undefined && record.benefitsExtraCost !== null && (!isFiniteNumber(record.benefitsExtraCost) || record.benefitsExtraCost < 0)) {
    return 'Labour plan benefits/extra cost must be zero or greater.';
  }
  if (record.bonus !== undefined && record.bonus !== null && (!isFiniteNumber(record.bonus) || record.bonus < 0)) {
    return 'Labour plan bonus must be zero or greater.';
  }
  return null;
}

function validateFormRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Form id is required.';
  if (!isNonEmptyString(record.name)) return 'Form name is required.';
  if (typeof record.description !== 'string') return 'Form description must be a string.';
  if (!FORM_CATEGORIES.has(record.category)) return 'Form category is invalid.';
  if (!FORM_STATUSES.has(record.status)) return 'Form status is invalid.';
  if (!FORM_ASSIGNMENTS.has(record.assignedTo)) return 'Form assignment is invalid.';
  if (record.assignmentValue !== undefined && record.assignmentValue !== null && typeof record.assignmentValue !== 'string') {
    return 'Form assignment value is invalid.';
  }
  if (record.division !== undefined && record.division !== null && typeof record.division !== 'string') {
    return 'Form division is invalid.';
  }
  if (!Array.isArray(record.trigger)) return 'Form trigger must be an array.';
  if (record.trigger.some((value) => !FORM_TRIGGERS.has(value))) return 'Form trigger includes invalid values.';
  if (record.completionRequirement !== undefined && !['reminder', 'required'].includes(record.completionRequirement)) {
    return 'Form completion requirement is invalid.';
  }
  return null;
}

function validateFormFieldRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Form field id is required.';
  if (!isNonEmptyString(record.formId)) return 'Form field form id is required.';
  if (!FORM_FIELD_TYPES.has(record.type)) return 'Form field type is invalid.';
  if (!isNonEmptyString(record.label)) return 'Form field label is required.';
  if (record.helpText !== undefined && record.helpText !== null && typeof record.helpText !== 'string') {
    return 'Form field help text is invalid.';
  }
  if (typeof record.required !== 'boolean') return 'Form field required flag is invalid.';
  if (record.defaultValue !== undefined && record.defaultValue !== null && typeof record.defaultValue !== 'string') {
    return 'Form field default value is invalid.';
  }
  if (record.placeholder !== undefined && record.placeholder !== null && typeof record.placeholder !== 'string') {
    return 'Form field placeholder is invalid.';
  }
  if (record.options !== undefined && record.options !== null && (!Array.isArray(record.options) || record.options.some((opt) => typeof opt !== 'string'))) {
    return 'Form field options are invalid.';
  }
  if (typeof record.order !== 'number' || Number.isNaN(record.order) || record.order < 0) {
    return 'Form field order must be zero or greater.';
  }
  return null;
}

function validateFormSubmissionRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Form submission id is required.';
  if (!isNonEmptyString(record.formId)) return 'Form submission form id is required.';
  if (!isNonEmptyString(record.employeeId)) return 'Form submission employee id is required.';
  if (record.jobId !== undefined && record.jobId !== null && typeof record.jobId !== 'string') {
    return 'Form submission job is invalid.';
  }
  if (!isNonEmptyString(record.submittedAt)) return 'Form submission timestamp is required.';
  if (!FORM_SUBMISSION_STATUSES.has(record.status)) return 'Form submission status is invalid.';
  if (record.submittedBy !== undefined && record.submittedBy !== null && typeof record.submittedBy !== 'string') {
    return 'Form submission submittedBy is invalid.';
  }
  return null;
}

function validateFormResponseRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Form response id is required.';
  if (!isNonEmptyString(record.submissionId)) return 'Form response submission id is required.';
  if (!isNonEmptyString(record.fieldId)) return 'Form response field id is required.';
  if (typeof record.value !== 'string') return 'Form response value must be a string.';
  return null;
}

async function validateFormRelationships({ businessId, record }) {
  if (record.assignedTo === 'everyone') return null;
  if (!isNonEmptyString(record.assignmentValue || record.division)) return 'Form assignment target is required.';
  if (record.assignedTo === 'role') return ['admin', 'foreman', 'crew_member'].includes(record.assignmentValue) ? null : 'Form role assignment is invalid.';
  if (record.assignedTo === 'employee') return await getEmployeeForBusiness(businessId, record.assignmentValue) ? null : 'Form employee assignment must belong to this business.';
  if (record.assignedTo === 'job') return await getJobForBusiness(businessId, record.assignmentValue) ? null : 'Form job assignment must belong to this business.';
  if (record.assignedTo === 'equipment') return await getEquipmentAssetForBusiness(businessId, record.assignmentValue) ? null : 'Form equipment assignment must belong to this business.';
  if (record.assignedTo === 'division') {
    const target = String(record.assignmentValue || record.division).trim().toLowerCase().replace(/\s+/g, ' ');
    const divisions = await listDivisionsForBusiness(businessId);
    return divisions.some((division) => division.id === record.assignmentValue || division.name?.trim().toLowerCase().replace(/\s+/g, ' ') === target || division.normalizedName?.trim().toLowerCase().replace(/_/g, ' ') === target)
      ? null
      : 'Form division assignment must belong to this business.';
  }
  return 'Form assignment is invalid.';
}

async function validateFormFieldRelationships({ businessId, record }) {
  return await getFormForBusiness(businessId, record.formId) ? null : 'Form field must belong to a form in this business.';
}

async function validateFormSubmissionRelationships({ businessId, record }) {
  if (!await getFormForBusiness(businessId, record.formId)) return 'Form submission form must belong to this business.';
  if (!await getEmployeeForBusiness(businessId, record.employeeId)) return 'Form submission employee must belong to this business.';
  if (record.jobId && !await getJobForBusiness(businessId, record.jobId)) return 'Form submission job must belong to this business.';
  if (record.equipmentId && !await getEquipmentAssetForBusiness(businessId, record.equipmentId)) return 'Form submission equipment must belong to this business.';
  if (record.divisionId && !await getDivisionForBusiness(businessId, record.divisionId)) return 'Form submission division must belong to this business.';
  return null;
}

async function validateFormResponseRelationships({ businessId, record }) {
  const [submission, field] = await Promise.all([
    getFormSubmissionForBusiness(businessId, record.submissionId),
    getFormFieldForBusiness(businessId, record.fieldId),
  ]);
  if (!submission) return 'Form response submission must belong to this business.';
  if (!field || field.formId !== submission.formId) return 'Form response field must belong to the submitted form.';
  return null;
}

function validateTaskRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Task id is required.';
  if (record.parentTaskId !== undefined && record.parentTaskId !== null && record.parentTaskId !== '' && !isNonEmptyString(record.parentTaskId)) {
    return 'Parent task id is invalid.';
  }
  if (record.parentTaskId === record.id) return 'A task cannot be its own parent.';
  if (!isNonEmptyString(record.title)) return 'Task title is required.';
  if (!isNonEmptyString(record.assignedUserId)) return 'Task assignee is required.';
  if (!TASK_STATUSES.has(record.status)) return 'Task status is invalid.';
  if (!isNonEmptyString(record.createdByUserId)) return 'Task creator is required.';
  if (!isNonEmptyString(record.createdAt)) return 'Task createdAt is required.';
  if (!isNonEmptyString(record.updatedAt)) return 'Task updatedAt is required.';
  if (record.description !== undefined && record.description !== null && typeof record.description !== 'string') {
    return 'Task description is invalid.';
  }
  if (record.dueDate !== undefined && record.dueDate !== null && record.dueDate !== '' && !isValidDateOnly(record.dueDate)) {
    return 'Task due date must use YYYY-MM-DD format.';
  }
  if (record.priority !== undefined && record.priority !== null && !TASK_PRIORITIES.has(record.priority)) {
    return 'Task priority is invalid.';
  }
  if (record.taskTabId !== undefined && record.taskTabId !== null && record.taskTabId !== '' && !isNonEmptyString(record.taskTabId)) {
    return 'Task tab id is invalid.';
  }
  if (record.headingId !== undefined && record.headingId !== null && record.headingId !== '' && !isNonEmptyString(record.headingId)) {
    return 'Task heading id is invalid.';
  }
  if (record.relatedEntityType !== undefined && record.relatedEntityType !== null && !TASK_RELATED_ENTITY_TYPES.has(record.relatedEntityType)) {
    return 'Task related entity type is invalid.';
  }
  if (record.relatedEntityType !== undefined && record.relatedEntityType !== null && !isNonEmptyString(record.relatedEntityId)) {
    return 'Task related entity id is required when related entity type is provided.';
  }
  if ((record.relatedEntityType === undefined || record.relatedEntityType === null) && record.relatedEntityId !== undefined && record.relatedEntityId !== null && record.relatedEntityId !== '') {
    return 'Task related entity type is required when related entity id is provided.';
  }
  if (record.completedAt !== undefined && record.completedAt !== null && record.completedAt !== '' && !isValidIsoDateTime(record.completedAt)) {
    return 'Task completedAt must be a valid ISO datetime.';
  }
  return null;
}

async function validateTaskRelationships({ businessId, record, session }) {
  if (isNonEmptyString(record.taskTabId)) {
    if (record.assignedUserId !== session.id) return 'Personal task tabs can only be assigned to your own tasks.';
    const preferences = await getHomeDashboardPreferencesForUser(businessId, session.id, session.role);
    if (!preferences.customTaskTabs?.some((tab) => tab.id === record.taskTabId)) return 'Task tab must belong to the signed-in user.';
  }
  const tasks = await listTasksForBusiness(businessId);
  if (isNonEmptyString(record.headingId)) {
    const heading = await getJobTaskHeadingForBusiness(businessId, record.headingId);
    if (!heading || record.relatedEntityType !== 'job' || heading.jobId !== record.relatedEntityId) {
      return 'Task heading must belong to the related job and business.';
    }
  }
  if (isNonEmptyString(record.parentTaskId)) {
    const parent = tasks.find((task) => task.id === record.parentTaskId);
    if (!parent) return 'Parent task must belong to this business.';
    if (parent.parentTaskId) return 'Subtasks cannot contain another level of subtasks.';
    if (parent.assignedUserId !== record.assignedUserId) return 'Subtask and parent task must have the same assignee.';
    if (parent.status === 'completed' && record.status !== 'completed') return 'Reopen the parent task before adding or reopening a subtask.';
  } else if (record.status === 'completed' && tasks.some((task) => task.parentTaskId === record.id && task.status !== 'completed')) {
    return 'Complete all subtasks before completing the parent task.';
  }
  if (!isNonEmptyString(record.relatedEntityType) || !isNonEmptyString(record.relatedEntityId)) {
    return null;
  }

  if (record.relatedEntityType === 'customer') {
    const customer = await getCustomerForBusiness(businessId, record.relatedEntityId);
    if (!customer) return 'Task related customer must belong to this business.';
  }
  if (record.relatedEntityType === 'estimate') {
    const estimate = await getEstimateForBusiness(businessId, record.relatedEntityId);
    if (!estimate) return 'Task related estimate must belong to this business.';
  }
  if (record.relatedEntityType === 'job') {
    const job = await getJobForBusiness(businessId, record.relatedEntityId);
    if (!job) return 'Task related job must belong to this business.';
  }
  if (record.relatedEntityType === 'invoice') {
    const invoice = await getInvoiceForBusiness(businessId, record.relatedEntityId);
    if (!invoice) return 'Task related invoice must belong to this business.';
  }
  if (record.relatedEntityType === 'employee') {
    const employee = await getEmployeeForBusiness(businessId, record.relatedEntityId);
    if (!employee) return 'Task related employee must belong to this business.';
  }

  return null;
}

async function findInvoiceNumberConflict({ businessId, invoiceNumber, excludeInvoiceId }) {
  if (!isNonEmptyString(invoiceNumber)) return null;

  const normalizedNumber = invoiceNumber.trim().toLowerCase();
  const invoices = await listInvoicesForBusiness(businessId);
  return invoices.find((invoice) => {
    if (excludeInvoiceId && invoice.id === excludeInvoiceId) return false;
    return typeof invoice.number === 'string' && invoice.number.trim().toLowerCase() === normalizedNumber;
  }) ?? null;
}

async function findProposalNumberConflict({ businessId, proposalNumber, excludeEstimateId }) {
  if (!isNonEmptyString(proposalNumber)) return null;

  const normalizedNumber = proposalNumber.trim().toLowerCase();
  const estimates = await listEstimatesForBusiness(businessId);
  return estimates.find((estimate) => {
    if (excludeEstimateId && estimate.id === excludeEstimateId) return false;
    return typeof estimate.proposalNumber === 'string' && estimate.proposalNumber.trim().toLowerCase() === normalizedNumber;
  }) ?? null;
}

export default async function handler(req, res) {
  const entity = req.query.entity;
  const config = getConfig(entity);
  if (!config) {
    return res.status(400).json({ ok: false, error: 'Invalid data entity' });
  }

  if (req.method === 'GET') {
    const session = await requireSession(req, res, config.readRoles ?? undefined, entity);
    if (!session) return;

    try {
      const items = await config.list(session.businessId);
      const context = entity === 'jobs'
        ? { crews: await listCrewsForBusiness(session.businessId) }
        : {};
      const filteredItems = filterRecordsForSession(session, entity, items, context);
      const responseItems = entity === 'equipment-assets'
        ? redactEquipmentPricingForSession(session, filteredItems)
        : filteredItems;
      return res.status(200).json({ ok: true, items: responseItems });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not load ${entity}` });
    }
  }

  if (req.method === 'POST') {
    const session = await requireSession(req, res, config.writeRoles ?? undefined, entity);
    if (!session) return;

    let record = req.body?.data;
    if (!record || typeof record !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    if (entity !== 'employees' && typeof record.id !== 'string') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }
    if (entity === 'equipment-assets' && changesEquipmentPricing(record) && session.role !== 'owner' && session.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can set equipment pricing.' });
    }

    if (entity === 'budget') {
      const allocated = applyEquipmentAllocationCost(record, req.body?.allocationMonths);
      if (!allocated.ok) return res.status(400).json({ ok: false, error: allocated.error });
      record = allocated.record;
    }

    if (entity === 'invoices') {
      if (record.lineItems !== undefined) record = normalizeInvoiceFinancials(record);
      const validationError = validateInvoiceRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }

      const conflict = await findInvoiceNumberConflict({
        businessId: session.businessId,
        invoiceNumber: record.number,
      });

      if (conflict) {
        return res.status(409).json({ ok: false, error: 'Invoice number already exists.' });
      }
    }

    if (entity === 'estimates') {
      record = ensureDefaultEstimateWorkArea(record);
      const divisionResult = enforceEstimateWorkAreaDivisionModel(null, record);
      if (!divisionResult.ok) return res.status(400).json({ ok: false, error: divisionResult.error });
      record = divisionResult.estimate;
      const validationError = validateEstimateRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
      const relationshipError = await validateEstimatePricingDivision({ businessId: session.businessId, estimate: record });
      if (relationshipError) return res.status(400).json({ ok: false, error: relationshipError });
      const pricingResult = await authorizeEstimatePricing({ businessId: session.businessId, existing: { lineItems: [], workAreas: [] }, estimate: record });
      if (!pricingResult.ok) return res.status(400).json({ ok: false, error: pricingResult.error });
      record = pricingResult.estimate;

      const conflict = await findProposalNumberConflict({
        businessId: session.businessId,
        proposalNumber: record.proposalNumber,
      });

      if (conflict) {
        return res.status(409).json({ ok: false, error: 'Proposal number already exists.' });
      }
    }

    if (entity === 'expenses') {
      const validationError = validateExpenseRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'jobs') {
      const validationError = validateJobRecord(record) ?? await validateJobRelationships({
        businessId: session.businessId,
        record,
      });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'tasks') {
      const validationError = validateTaskRecord(record) ?? await validateTaskRelationships({
        businessId: session.businessId,
        record,
        session,
      });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'equipment-assets') {
      const validationError = validateEquipmentAssetRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'material-catalog-items') {
      const validationError = validateMaterialCatalogItemRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'subcontractor-catalog-items') {
      const validationError = validateSubcontractorCatalogItemRecord(record);
      if (validationError) return res.status(400).json({ ok: false, error: validationError });
    }

    if (entity === 'unbillable-time-categories') {
      const validationError = validateUnbillableTimeCategoryRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'budgets') {
      const validationError = validateBudgetRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'budget-rates') {
      const validationError = validateBudgetRateRecord(record) ?? await validateBudgetRateRelationships(session.businessId, record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'budget') {
      const validationError = validateBudgetItemRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }

      const relationshipError = await validateBudgetItemRelationships({
        businessId: session.businessId,
        record,
      });
      if (relationshipError) {
        return res.status(400).json({ ok: false, error: relationshipError });
      }
    }

    if (entity === 'labour-budget-plans') {
      const validationError = validateLabourBudgetPlanRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'labour-classes') {
      const validationError = validateLabourClassRecord(record) ?? await validateLabourClassNameUnique(session.businessId, record);
      if (validationError) return res.status(400).json({ ok: false, error: validationError });
    }

    if (entity === 'forms') {
      const validationError = validateFormRecord(record) ?? await validateFormRelationships({ businessId: session.businessId, record });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'form-fields') {
      const validationError = validateFormFieldRecord(record) ?? await validateFormFieldRelationships({ businessId: session.businessId, record });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'form-submissions') {
      const validationError = validateFormSubmissionRecord(record) ?? await validateFormSubmissionRelationships({ businessId: session.businessId, record });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'form-responses') {
      const validationError = validateFormResponseRecord(record) ?? await validateFormResponseRelationships({ businessId: session.businessId, record });
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'time-entries' && record.status === 'clocked_in') {
      return res.status(409).json({ ok: false, error: 'Use clocking actions for active shift changes.' });
    }

    if (entity === 'time-entries' && isTimeEntryOpenLike(record)) {
      return res.status(409).json({ ok: false, error: 'Use clocking actions for active shift changes.' });
    }

    if (entity === 'employees') {
      const validationError = validateEmployeeCostInputs(record) ?? await validateEmployeeLabourClass(session.businessId, record);
      if (validationError) return res.status(400).json({ ok: false, error: validationError });
      const accessPayload = req.body?.accountAccess;
      try {
        const created = await createEmployeeWithAccessForBusiness({
          businessId: session.businessId,
          payload: {
            employee: record,
            accountAccess: accessPayload,
          },
        });
        if (!created.ok) {
          return res.status(409).json({ ok: false, error: created.error ?? 'Could not create employee' });
        }
        return res.status(200).json({ ok: true, employee: created.employee, user: created.user ?? null });
      } catch {
        return res.status(500).json({ ok: false, error: 'Could not create employees' });
      }
    }

    try {
      await config.create({ businessId: session.businessId, [config.createArgKey]: record });
      if (entity === 'budget' && req.body?.allocationMonths !== undefined) {
        const allocationResult = await saveEquipmentBudgetAllocationForItem({
          businessId: session.businessId,
          budgetId: record.budgetId,
          equipmentId: record.equipmentId,
          budgetItemId: record.id,
          monthsAllocated: req.body.allocationMonths,
        });
        if (!allocationResult.ok) {
          await config.remove(session.businessId, record.id);
          return res.status(409).json(allocationResult);
        }
        return res.status(200).json({ ok: true, allocation: allocationResult.allocation, budgetItem: record });
      }
      if (entity === 'jobs') {
        await syncJobToExternalCalendars({ businessId: session.businessId, job: record });
      }
      if (entity === 'estimates') return res.status(200).json({ ok: true, estimate: record });
      if (entity === 'budgets') {
        const persistedBudget = await config.get(session.businessId, record.id);
        return res.status(200).json({ ok: true, budget: persistedBudget });
      }
      if (entity === 'labour-classes') {
        const persistedLabourClass = await config.get(session.businessId, record.id);
        return res.status(200).json({ ok: true, labourClass: persistedLabourClass });
      }
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not create ${entity}` });
    }
  }

  if (req.method === 'PATCH') {
    const session = await requireSession(req, res, config.writeRoles ?? undefined, entity);
    if (!session) return;

    const id = req.query.id;
    const data = req.body?.data;
    const accountAccess = req.body?.accountAccess;
    if (typeof id !== 'string' || !id || !data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }
    if (entity === 'equipment-assets' && changesEquipmentPricing(data) && session.role !== 'owner' && session.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Only owner/admin can change equipment pricing.' });
    }

    try {
      const existing = await config.get(session.businessId, id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: `${entity} not found` });
      }

      if (!authorizeRecordAccess(session, entity, existing)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }

      const sanitizedDataResult = sanitizePatchData(entity, id, data);
      if (!sanitizedDataResult.ok) {
        return res.status(400).json({ ok: false, error: sanitizedDataResult.error });
      }
      const sanitizedData = sanitizedDataResult.data;

      let baseRecord = existing;
      let accountAccessResult = null;

      if (entity === 'employees' && accountAccess && typeof accountAccess === 'object') {
        accountAccessResult = await updateEmployeeAccessForBusiness({
          businessId: session.businessId,
          employeeId: id,
          accountAccess,
          actorUserId: session.id,
          actorRole: session.role,
        });

        if (!accountAccessResult.ok) {
          return res.status(409).json({ ok: false, error: accountAccessResult.error ?? 'Could not update employee account access.' });
        }

        baseRecord = accountAccessResult.employee;
      }

      let next = { ...baseRecord, ...sanitizedData };
      if (entity === 'employees') {
        const validationError = validateEmployeeCostInputs(next) ?? await validateEmployeeLabourClass(session.businessId, next);
        if (validationError) return res.status(400).json({ ok: false, error: validationError });
      }
      if (entity === 'labour-classes') {
        const validationError = validateLabourClassRecord(next) ?? await validateLabourClassNameUnique(session.businessId, next);
        if (validationError) return res.status(400).json({ ok: false, error: validationError });
      }
      if (entity === 'budget') {
        const allocated = applyEquipmentAllocationCost(next, req.body?.allocationMonths);
        if (!allocated.ok) return res.status(400).json({ ok: false, error: allocated.error });
        next = allocated.record;
      }

      if (entity === 'invoices') {
        if (next.lineItems !== undefined) next = normalizeInvoiceFinancials(next);
        const validationError = validateInvoiceRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }

        const conflict = await findInvoiceNumberConflict({
          businessId: session.businessId,
          invoiceNumber: next.number,
          excludeInvoiceId: id,
        });

        if (conflict) {
          return res.status(409).json({ ok: false, error: 'Invoice number already exists.' });
        }
      }

      if (entity === 'estimates') {
        const divisionResult = enforceEstimateWorkAreaDivisionModel(existing, next);
        if (!divisionResult.ok) return res.status(409).json({ ok: false, error: divisionResult.error });
        next = divisionResult.estimate;
        const relationshipError = await validateEstimatePricingDivision({ businessId: session.businessId, estimate: next, existing });
        if (relationshipError) return res.status(400).json({ ok: false, error: relationshipError });
        const validationError = validateEstimateRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
        const pricingResult = await authorizeEstimatePricing({ businessId: session.businessId, existing, estimate: next });
        if (!pricingResult.ok) return res.status(400).json({ ok: false, error: pricingResult.error });
        next = pricingResult.estimate;

        const conflict = await findProposalNumberConflict({
          businessId: session.businessId,
          proposalNumber: next.proposalNumber,
          excludeEstimateId: id,
        });

        if (conflict) {
          return res.status(409).json({ ok: false, error: 'Proposal number already exists.' });
        }
      }

      if (entity === 'expenses') {
        const validationError = validateExpenseRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'jobs') {
        const validationError = validateJobRecord(next) ?? await validateJobRelationships({
          businessId: session.businessId,
          record: next,
        });
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'tasks') {
        const validationError = validateTaskRecord(next) ?? await validateTaskRelationships({
          businessId: session.businessId,
          record: next,
          session,
        });
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'equipment-assets') {
        const validationError = validateEquipmentAssetRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'material-catalog-items') {
        const validationError = validateMaterialCatalogItemRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'subcontractor-catalog-items') {
        const validationError = validateSubcontractorCatalogItemRecord(next);
        if (validationError) return res.status(400).json({ ok: false, error: validationError });
      }

      if (entity === 'unbillable-time-categories') {
        const validationError = validateUnbillableTimeCategoryRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'budgets') {
        const validationError = validateBudgetRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'budget-rates') {
        const validationError = validateBudgetRateRecord(next) ?? await validateBudgetRateRelationships(session.businessId, next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'budget') {
        const validationError = validateBudgetItemRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }

        const relationshipError = await validateBudgetItemRelationships({
          businessId: session.businessId,
          record: next,
        });
        if (relationshipError) {
          return res.status(400).json({ ok: false, error: relationshipError });
        }
      }

      if (entity === 'labour-budget-plans') {
        const validationError = validateLabourBudgetPlanRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'forms') {
        const validationError = validateFormRecord(next) ?? await validateFormRelationships({ businessId: session.businessId, record: next });
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'form-fields') {
        const validationError = validateFormFieldRecord(next) ?? await validateFormFieldRelationships({ businessId: session.businessId, record: next });
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'form-submissions') {
        const validationError = validateFormSubmissionRecord(next) ?? await validateFormSubmissionRelationships({ businessId: session.businessId, record: next });
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'form-responses') {
        const validationError = validateFormResponseRecord(next) ?? await validateFormResponseRelationships({ businessId: session.businessId, record: next });
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (
        entity === 'time-entries'
        && (existing.status === 'clocked_in' || next.status === 'clocked_in')
      ) {
        return res.status(409).json({ ok: false, error: 'Use clocking actions for active shift changes.' });
      }

      const updateResult = await config.update({
        businessId: session.businessId,
        [config.updateArgKey]: next,
        ...(entity === 'estimates' ? { expectedUpdatedAt: req.body?.baseUpdatedAt } : {}),
      });
      if (updateResult && updateResult.ok === false) {
        return res.status(409).json({ ok: false, error: updateResult.error ?? `Could not update ${entity}` });
      }

      if (entity === 'budget' && req.body?.allocationMonths !== undefined) {
        const allocationResult = await saveEquipmentBudgetAllocationForItem({
          businessId: session.businessId,
          budgetId: next.budgetId,
          equipmentId: next.equipmentId,
          budgetItemId: next.id,
          monthsAllocated: req.body.allocationMonths,
        });
        if (!allocationResult.ok) {
          await config.update({ businessId: session.businessId, [config.updateArgKey]: existing });
          return res.status(409).json(allocationResult);
        }
        return res.status(200).json({ ok: true, allocation: allocationResult.allocation, budgetItem: next });
      }

      if (entity === 'employees') {
        const employee = await getEmployeeForBusiness(session.businessId, id);
        return res.status(200).json({
          ok: true,
          employee,
          user: accountAccessResult?.user ?? null,
        });
      }

      if (entity === 'jobs') {
        await syncJobToExternalCalendars({ businessId: session.businessId, job: next });
      }

      if (entity === 'estimates') {
        const persistedEstimate = await config.get(session.businessId, id);
        return res.status(200).json({ ok: true, estimate: persistedEstimate });
      }
      if (entity === 'budgets') {
        const persistedBudget = await config.get(session.businessId, id);
        return res.status(200).json({ ok: true, budget: persistedBudget });
      }
      if (entity === 'labour-classes') {
        const persistedLabourClass = await config.get(session.businessId, id);
        return res.status(200).json({ ok: true, labourClass: persistedLabourClass });
      }
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not update ${entity}` });
    }
  }

  if (req.method === 'DELETE') {
    const session = await requireSession(req, res, config.writeRoles ?? undefined, entity);
    if (!session) return;

    const id = req.query.id;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      if (entity === 'unbillable-time-categories') {
        return res.status(409).json({ ok: false, error: 'Unbillable categories are archive-only. Set active=false instead.' });
      }

      const existing = await config.get(session.businessId, id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: `${entity} not found` });
      }

      if (!authorizeRecordAccess(session, entity, existing)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }

      if (entity === 'budgets') {
        const result = await deleteBudgetCascadeForBusiness({ businessId: session.businessId, budgetId: id, budget: existing });
        if (!result.ok) return res.status(result.status).json(result);
        return res.status(200).json(result);
      }
      await config.remove(session.businessId, id);
      if (entity === 'budget') {
        await deleteEquipmentBudgetAllocationForItem({ businessId: session.businessId, budgetItemId: id });
      }
      if (entity === 'jobs') {
        await syncJobToExternalCalendars({ businessId: session.businessId, job: existing, action: 'delete' });
      }
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not delete ${entity}` });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
