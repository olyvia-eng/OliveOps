import {
  createBudgetForBusiness,
  createBudgetItemForBusiness,
  createBudgetRateForBusiness,
  createAuditEventForBusiness,
  createCustomerForBusiness,
  createEmployeeForBusiness,
  createEquipmentAssetForBusiness,
  createUnbillableTimeCategoryForBusiness,
  createMaterialCatalogItemForBusiness,
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
  createTemplateForBusiness,
  createTimeEntryForBusiness,
  deleteAuthUserForBusinessByEmail,
  deleteBudgetForBusiness,
  deleteBudgetItemForBusiness,
  deleteBudgetRateForBusiness,
  deleteAuditEventForBusiness,
  deleteCustomerForBusiness,
  deleteEmployeeForBusiness,
  deleteEquipmentAssetForBusiness,
  deleteUnbillableTimeCategoryForBusiness,
  deleteMaterialCatalogItemForBusiness,
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
  deleteTemplateForBusiness,
  deleteTimeEntryForBusiness,
  getBudgetForBusiness,
  getBudgetItemForBusiness,
  getBudgetRateForBusiness,
  getAuditEventForBusiness,
  getCustomerForBusiness,
  getEmployeeForBusiness,
  getEquipmentAssetForBusiness,
  getUnbillableTimeCategoryForBusiness,
  getMaterialCatalogItemForBusiness,
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
  getTemplateForBusiness,
  getTimeEntryForBusiness,
  listBudgetsForBusiness,
  listBudgetItemsForBusiness,
  listBudgetRatesForBusiness,
  listAuditEventsForBusiness,
  listCustomersForBusiness,
  listEmployeesForBusiness,
  listEquipmentAssetsForBusiness,
  listUnbillableTimeCategoriesForBusiness,
  listMaterialCatalogItemsForBusiness,
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
  listTemplatesForBusiness,
  listTimeEntriesForBusiness,
  updateBudgetForBusiness,
  updateBudgetItemForBusiness,
  updateBudgetRateForBusiness,
  updateAuditEventForBusiness,
  updateCustomerForBusiness,
  updateEmployeeForBusiness,
  updateEquipmentAssetForBusiness,
  updateUnbillableTimeCategoryForBusiness,
  updateMaterialCatalogItemForBusiness,
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
  updateTemplateForBusiness,
  updateTimeEntryForBusiness,
} from './_lib/authRepo.js';
import { requireSession } from './_lib/session.js';

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
  jobs: {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
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
  'equipment-assets': {
    readRoles: null,
    writeRoles: ['owner', 'admin'],
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

const INVOICE_STATUSES = new Set(['draft', 'sent', 'paid', 'overdue']);
const EXPENSE_STATUSES = new Set(['pending', 'approved', 'paid']);
const EXPENSE_CATEGORIES = new Set(['materials', 'equipment', 'subcontractor', 'travel', 'permits', 'overhead', 'other']);
const EQUIPMENT_STATUSES = new Set(['available', 'in_use', 'maintenance', 'inactive']);
const EQUIPMENT_COST_TYPES = new Set(['financed', 'leased', 'owned']);
const BUDGET_TYPES = new Set(['operating', 'capital', 'project', 'forecast', 'custom']);
const BUDGET_STATUSES = new Set(['draft', 'active', 'archived']);
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
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_REGEX = /^\d{4}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

function isoDateOnly(value) {
  if (typeof value !== 'string' || value.length < 10) return '';
  return value.slice(0, 10);
}

function normalizeLower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sessionCanBypassFormGuard(session) {
  return session.role === 'owner' || session.role === 'admin';
}

function pickEntryJobIds(entry) {
  if (Array.isArray(entry?.jobIds) && entry.jobIds.length > 0) {
    return entry.jobIds.filter((value) => typeof value === 'string' && value.length > 0);
  }
  if (typeof entry?.jobId === 'string' && entry.jobId.length > 0) {
    return [entry.jobId];
  }
  return [];
}

function isFormAssignedToEmployee({ form, employee, contextJobIds }) {
  if (form.assignedTo === 'everyone') return true;
  if (form.assignedTo === 'role') return form.assignmentValue === employee.role;
  if (form.assignedTo === 'employee') return form.assignmentValue === employee.id;
  if (form.assignedTo === 'job') {
    if (!isNonEmptyString(form.assignmentValue)) return false;
    return contextJobIds.includes(form.assignmentValue);
  }
  if (form.assignedTo === 'division') {
    // TODO: Enforce division-scoped assignments when employee-division mapping is available in backend data.
    return true;
  }
  if (form.assignedTo === 'equipment') {
    // TODO: Enforce equipment-scoped assignments when equipment context is attached to transitions.
    return true;
  }
  return false;
}

function isSubmissionSatisfiedForForm({ submission, form, employeeId, dateKey, contextJobIds }) {
  if (submission.formId !== form.id) return false;
  if (submission.employeeId !== employeeId) return false;
  if (submission.status !== 'submitted') return false;
  if (isoDateOnly(submission.submittedAt) !== dateKey) return false;

  if (form.assignedTo === 'job' && contextJobIds.length > 0) {
    return contextJobIds.includes(submission.jobId ?? '');
  }

  return true;
}

async function getEmployeeByIdOrNull(businessId, employeeId) {
  const employee = await getEmployeeForBusiness(businessId, employeeId);
  return employee ?? null;
}

async function getSessionEmployeeOrNull(businessId, sessionEmail) {
  const employees = await listEmployeesForBusiness(businessId);
  const email = normalizeLower(sessionEmail);
  return employees.find((employee) => normalizeLower(employee.email) === email && employee.active) ?? null;
}

async function getMissingRequiredFormsForTrigger({ businessId, trigger, employee, contextJobIds }) {
  const [forms, submissions] = await Promise.all([
    listFormsForBusiness(businessId),
    listFormSubmissionsForBusiness(businessId),
  ]);

  const dateKey = new Date().toISOString().slice(0, 10);
  return forms.filter((form) => {
    if (form.status !== 'active') return false;
    if (!Array.isArray(form.trigger) || !form.trigger.includes(trigger)) return false;
    if (!isFormAssignedToEmployee({ form, employee, contextJobIds })) return false;

    const submitted = submissions.some((submission) => isSubmissionSatisfiedForForm({
      submission,
      form,
      employeeId: employee.id,
      dateKey,
      contextJobIds,
    }));

    return !submitted;
  });
}

async function enforceRequiredForms({
  session,
  res,
  trigger,
  targetEmployeeId,
  contextJobIds,
}) {
  if (sessionCanBypassFormGuard(session)) return { ok: true };

  const sessionEmployee = await getSessionEmployeeOrNull(session.businessId, session.email);
  if (!sessionEmployee) {
    res.status(403).json({ ok: false, error: 'Your user is not linked to an active employee profile.' });
    return { ok: false };
  }

  if (sessionEmployee.id !== targetEmployeeId) {
    res.status(403).json({ ok: false, error: 'You can only perform this action for your own employee profile.' });
    return { ok: false };
  }

  const missing = await getMissingRequiredFormsForTrigger({
    businessId: session.businessId,
    trigger,
    employee: sessionEmployee,
    contextJobIds,
  });

  if (missing.length > 0) {
    const names = missing.slice(0, 3).map((form) => form.name).join(', ');
    const suffix = missing.length > 3 ? ` and ${missing.length - 3} more` : '';
    res.status(409).json({
      ok: false,
      error: `Required forms are incomplete before continuing: ${names}${suffix}.`,
    });
    return { ok: false };
  }

  return { ok: true };
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

function validateBudgetRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Budget id is required.';
  if (!isNonEmptyString(record.name)) return 'Budget name is required.';
  if (!BUDGET_TYPES.has(record.budgetType)) return 'Budget type is invalid.';
  if (!isNonEmptyString(record.division)) return 'Budget division is required.';
  if (typeof record.fiscalYear !== 'string' || !YEAR_REGEX.test(record.fiscalYear)) {
    return 'Fiscal year must use YYYY format.';
  }
  if (!BUDGET_STATUSES.has(record.status)) return 'Budget status is invalid.';
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

function validateBudgetRateRecord(record) {
  if (!isNonEmptyString(record.id)) return 'Budget rate id is required.';
  if (!isNonEmptyString(record.budgetId)) return 'Budget rate budget id is required.';
  if (!BUDGET_RATE_CATEGORIES.has(record.category)) return 'Budget rate category is invalid.';
  if (!isNonEmptyString(record.itemName)) return 'Budget rate item name is required.';
  if (!isNonEmptyString(record.unit)) return 'Budget rate unit is required.';
  if (!isFiniteNumber(record.unitCost) || record.unitCost < 0) return 'Budget rate unit cost must be zero or greater.';
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
    const session = await requireSession(req, res, config.readRoles ?? undefined);
    if (!session) return;

    try {
      const items = await config.list(session.businessId);
      return res.status(200).json({ ok: true, items });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not load ${entity}` });
    }
  }

  if (req.method === 'POST') {
    const session = await requireSession(req, res, config.writeRoles ?? undefined);
    if (!session) return;

    const record = req.body?.data;
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    if (entity === 'invoices') {
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
      const validationError = validateEstimateRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }

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
      const validationError = validateBudgetRateRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'forms') {
      const validationError = validateFormRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'form-fields') {
      const validationError = validateFormFieldRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'form-submissions') {
      const validationError = validateFormSubmissionRecord(record);
      if (validationError) {
        return res.status(400).json({ ok: false, error: validationError });
      }
    }

    if (entity === 'form-responses') {
      const validationError = validateFormResponseRecord(record);
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

    try {
      await config.create({ businessId: session.businessId, [config.createArgKey]: record });
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not create ${entity}` });
    }
  }

  if (req.method === 'PATCH') {
    const session = await requireSession(req, res, config.writeRoles ?? undefined);
    if (!session) return;

    const id = req.query.id;
    const data = req.body?.data;
    if (typeof id !== 'string' || !id || !data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    try {
      const existing = await config.get(session.businessId, id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: `${entity} not found` });
      }

      const next = { ...existing, ...data };

      if (entity === 'invoices') {
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
        const validationError = validateEstimateRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }

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
        const validationError = validateBudgetRateRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'forms') {
        const validationError = validateFormRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'form-fields') {
        const validationError = validateFormFieldRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'form-submissions') {
        const validationError = validateFormSubmissionRecord(next);
        if (validationError) {
          return res.status(400).json({ ok: false, error: validationError });
        }
      }

      if (entity === 'form-responses') {
        const validationError = validateFormResponseRecord(next);
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

      if (
        entity === 'time-entries'
        && existing.status !== 'clocked_out'
        && (next.status === 'clocked_out' || isNonEmptyString(next.clockOut))
      ) {
        const targetEmployee = await getEmployeeByIdOrNull(session.businessId, existing.employeeId);
        if (!targetEmployee) {
          return res.status(400).json({ ok: false, error: 'Time entry employee is invalid.' });
        }

        const guard = await enforceRequiredForms({
          session,
          res,
          trigger: 'after_clock_out',
          targetEmployeeId: targetEmployee.id,
          contextJobIds: pickEntryJobIds(existing),
        });
        if (!guard.ok) return;
      }

      if (
        entity === 'jobs'
        && existing.status !== 'in_progress'
        && next.status === 'in_progress'
      ) {
        const sessionEmployee = await getSessionEmployeeOrNull(session.businessId, session.email);
        if (sessionEmployee) {
          const guard = await enforceRequiredForms({
            session,
            res,
            trigger: 'before_starting_job',
            targetEmployeeId: sessionEmployee.id,
            contextJobIds: [existing.id],
          });
          if (!guard.ok) return;
        }
      }

      if (
        entity === 'jobs'
        && existing.status !== 'completed'
        && next.status === 'completed'
      ) {
        const sessionEmployee = await getSessionEmployeeOrNull(session.businessId, session.email);
        if (sessionEmployee) {
          const guard = await enforceRequiredForms({
            session,
            res,
            trigger: 'after_completing_job',
            targetEmployeeId: sessionEmployee.id,
            contextJobIds: [existing.id],
          });
          if (!guard.ok) return;
        }
      }

      await config.update({ businessId: session.businessId, [config.updateArgKey]: next });
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not update ${entity}` });
    }
  }

  if (req.method === 'DELETE') {
    const session = await requireSession(req, res, config.writeRoles ?? undefined);
    if (!session) return;

    const id = req.query.id;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      if (entity === 'unbillable-time-categories') {
        return res.status(409).json({ ok: false, error: 'Unbillable categories are archive-only. Set active=false instead.' });
      }

      if (entity === 'employees') {
        const existing = await getEmployeeForBusiness(session.businessId, id);
        if (existing?.email) {
          const authDelete = await deleteAuthUserForBusinessByEmail(session.businessId, existing.email);
          if (!authDelete.ok) {
            return res.status(409).json({ ok: false, error: authDelete.error });
          }
        }
      }

      await config.remove(session.businessId, id);
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ ok: false, error: `Could not delete ${entity}` });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
