import { BUDGET_CATEGORIES } from '../config/budgetCategories.js';

// ─── Shared ──────────────────────────────────────────────────────────────────

export type ID = string;

export interface Address {
  nickname?: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

// ─── CRM ─────────────────────────────────────────────────────────────────────

export type CustomerStatus = 'lead' | 'prospect' | 'active' | 'inactive';

export interface Customer {
  id: ID;
  firstName?: string;
  lastName?: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  properties: Address[];
  address?: Address;
  status: CustomerStatus;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Estimates ───────────────────────────────────────────────────────────────

export type LineItemCategory = 'material' | 'equipment' | 'labour' | 'subcontractor';

export interface LineItem {
  id: ID;
  category: LineItemCategory;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  markup: number; // percentage, e.g. 20 = 20%
  total: number;
}

export interface EstimateLineItem {
  id: ID;
  category: LineItemCategory;
  sourceBudgetId?: ID;
  sourceBudgetItemId?: ID;
  sourceEntityId?: ID;
  sourceRateId?: ID;
  pricingRateUpdatedAt?: string;
  pricingVersion?: number;
  divisionId?: ID;
  directCostPerUnit?: number;
  divisionOverheadRecoveryPerUnit?: number;
  companyOverheadRecoveryPerUnit?: number;
  recoveredCostPerUnit?: number;
  targetMarginPct?: number;
  recommendedRateAtEstimate?: number;
  sourceCategory?: LineItemCategory;
  equipmentId?: ID;
  equipmentName?: string;
  costRateAtEstimate?: number;
  chargeOutRateAtEstimate?: number;
  estimatedCost?: number;
  estimatedSell?: number;
  itemName: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  markupPercent: number;
  sellPrice: number;
  total: number;
  // Legacy compatibility with older estimate records and UI paths.
  markup?: number;
}

export type EstimatePricingStatus = 'calculated' | 'approved' | 'recommended_not_approved' | 'unavailable';

export interface EstimatePricingCatalogItem {
  type: LineItemCategory;
  sourceEntityId?: ID;
  budgetItemId: ID;
  sourceRateId?: ID;
  name: string;
  description: string;
  costCode?: string;
  unit: string;
  classification?: string;
  costRate: number | null;
  recommendedRate: number | null;
  approvedRate: number | null;
  sellRate: number | null;
  pricingAvailable: boolean;
  pricingStatus: EstimatePricingStatus;
  pricingRateUpdatedAt?: string;
  pricingVersion?: number;
  divisionId?: ID;
  directCostPerUnit?: number | null;
  divisionOverheadRecoveryPerUnit?: number | null;
  companyOverheadRecoveryPerUnit?: number | null;
  recoveredCostPerUnit?: number | null;
  targetMarginPct?: number | null;
}

export interface EstimatePricingCatalog {
  budgetId: ID;
  labour: EstimatePricingCatalogItem[];
  equipment: EstimatePricingCatalogItem[];
  materials: EstimatePricingCatalogItem[];
  subcontractors: EstimatePricingCatalogItem[];
}

export interface EstimateWorkArea {
  id: ID;
  divisionId?: ID;
  name: string;
  description: string;
  sortOrder: number;
  lineItems: EstimateLineItem[];
}

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'converted';

export interface Estimate {
  id: ID;
  customerId: ID;
  pricingBudgetId: ID;
  divisionId?: ID;
  propertyLabel?: string;
  propertyAddressSnapshot?: string;
  convertedToJobId?: ID;
  convertedAt?: string;
  proposalNumber?: string;
  title: string;
  description: string;
  workAreas?: EstimateWorkArea[] | string[];
  status: EstimateStatus;
  lineItems: LineItem[] | EstimateLineItem[];
  taxRate: number; // percentage
  notes: string;
  validUntil: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  templateId?: ID;
}

export interface EstimateTemplate {
  id: ID;
  name: string;
  description: string;
  workAreas?: EstimateWorkArea[];
  lineItems: Omit<LineItem, 'id'>[] | Omit<EstimateLineItem, 'id'>[];
  taxRate: number;
  notes: string;
  createdAt: string;
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

export interface InvoiceLineItem {
  id: ID;
  category: LineItemCategory;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  taxable: boolean;
}

export interface Invoice {
  id: ID;
  jobId: ID;
  customerId: ID;
  number: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  amount: number;
  lineItems?: InvoiceLineItem[];
  taxRate?: number;
  subtotal?: number;
  taxAmount?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuickBooksResourceReference {
  id: string;
  name: string;
  active: boolean;
}

export interface QuickBooksItemReference extends QuickBooksResourceReference {
  type: string;
}

export interface QuickBooksTaxCodeReference extends QuickBooksResourceReference {
  taxable: boolean;
}

export interface QuickBooksConfiguration {
  categoryMappings: Partial<Record<LineItemCategory, QuickBooksItemReference>>;
  taxableTaxCode?: QuickBooksTaxCodeReference;
  nonTaxableTaxCode?: QuickBooksTaxCodeReference;
}

export interface QuickBooksIntegration {
  connected: boolean;
  environment: 'sandbox';
  realmId?: string;
  companyName?: string;
  country?: string;
  currency?: string;
  connectedAt?: string | null;
  connectedByUserId?: ID | null;
  updatedAt?: string | null;
  configuration?: QuickBooksConfiguration;
}

export interface QuickBooksCustomerCandidate {
  id: string;
  displayName: string;
  companyName: string;
  email: string;
  active: boolean;
}

export interface QuickBooksInvoiceStatus {
  quickBooksInvoiceId: string;
  documentNumber: string;
  status: 'open' | 'overdue' | 'paid';
  balance: number;
  total: number;
  syncedAt: string;
  localChangesNotSynced: boolean;
}

// ─── Expenses ───────────────────────────────────────────────────────────────

export type ExpenseStatus = 'pending' | 'approved' | 'paid';

export type ExpenseCategory =
  | 'materials'
  | 'equipment'
  | 'subcontractor'
  | 'travel'
  | 'permits'
  | 'overhead'
  | 'other';

export interface Expense {
  id: ID;
  jobId?: ID;
  vendor: string;
  description: string;
  category: ExpenseCategory;
  expenseDate: string;
  amount: number;
  status: ExpenseStatus;
  notes: string;
  receiptUrl?: string;
  receiptFileId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Equipment ──────────────────────────────────────────────────────────────

export type EquipmentStatus = 'available' | 'in_use' | 'maintenance' | 'inactive';
export type EquipmentClassification = 'billable' | 'overhead';

export interface EquipmentAsset {
  id: ID;
  name: string;
  type: string;
  status: EquipmentStatus;
  costType: EquipmentCostType;
  equipmentClassification?: EquipmentClassification;
  serialNumber: string;
  purchaseDate?: string;
  hourlyCost: number;
  costRateHourly?: number;
  recommendedSellRate?: number;
  chargeOutRate?: number;
  purchasePrice?: number;
  equipmentPayment?: number;
  equipmentPaymentFrequencyPerYear?: number;
  fuelPriceUnit?: 'L' | 'gal';
  averageFuelPrice?: number;
  averageFuelBurnPerHour?: number;
  yearlyFuelCost?: number;
  yearlyInsuranceCost?: number;
  yearlyMaintenanceCost?: number;
  currentJobId?: ID;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialCatalogItem {
  id: ID;
  name: string;
  unit: string;
  defaultUnitCost: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type FeedbackType = 'bug' | 'feature_request' | 'usability' | 'general';
export type FeedbackStatus = 'new' | 'triaged' | 'in_progress' | 'resolved' | 'closed';
export type FeedbackPriority = 'low' | 'normal' | 'high';

export interface FeedbackRecord {
  id: ID;
  businessId: ID;
  submittedByUserId: ID;
  submittedByRole: string;
  type: FeedbackType;
  message: string;
  route?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  deviceCategory?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  appVersion?: string;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  screenshotFileId?: ID;
  contactPreference: boolean;
  contactEmail?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'completed';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskRelatedEntityType = 'customer' | 'estimate' | 'job' | 'invoice' | 'employee';

export interface TaskTab {
  id: ID;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export interface JobTaskHeading {
  id: ID;
  businessId: ID;
  jobId: ID;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: ID;
  parentTaskId?: ID;
  title: string;
  description?: string;
  dueDate?: string;
  assignedUserId: ID;
  status: TaskStatus;
  priority?: TaskPriority;
  taskTabId?: ID;
  headingId?: ID;
  relatedEntityType?: TaskRelatedEntityType;
  relatedEntityId?: ID;
  createdByUserId: ID;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type JobStatus = 'scheduled' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';

export interface CostEntry {
  id: ID;
  category: LineItemCategory;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  total: number;
  date: string;
}

export type JobWorkAreaStatus = 'not_started' | 'in_progress' | 'complete' | 'on_hold';

export interface JobWorkAreaCategoryTotals {
  labour: number;
  equipment: number;
  material: number;
  subcontractor: number;
}

export interface JobWorkAreaLineItem {
  id: ID;
  sourceEstimateLineItemId?: ID;
  sourceEstimateWorkAreaId?: ID;
  equipmentId?: ID;
  equipmentName?: string;
  costRateAtEstimate?: number;
  chargeOutRateAtEstimate?: number;
  estimatedCost?: number;
  estimatedSell?: number;
  category: LineItemCategory;
  itemName: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  sellPrice: number;
  total: number;
}

export interface JobWorkArea {
  id: ID;
  sourceEstimateWorkAreaId?: ID;
  name: string;
  description: string;
  status: JobWorkAreaStatus;
  sortOrder: number;
  estimatedCost: number;
  estimatedRevenue: number;
  estimatedMargin: number;
  estimatedByCategory: JobWorkAreaCategoryTotals;
  lineItems: JobWorkAreaLineItem[];
}

export interface JobEstimateSnapshot {
  estimateId: ID;
  proposalNumber?: string;
  pricingBudgetId?: ID;
  propertyLabel?: string;
  propertyAddressSnapshot?: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes: string;
  workAreas: JobWorkArea[];
}

export interface Job {
  id: ID;
  jobNumber?: string;
  estimateId?: ID;
  sourceEstimateId?: ID;
  convertedFromEstimateAt?: string;
  convertedByUserId?: ID;
  convertedByUserName?: string;
  customerId: ID;
  pricingBudgetId?: ID;
  crewId?: ID;
  divisionId?: ID;
  propertyLabel?: string;
  propertyAddressSnapshot?: string;
  title: string;
  description: string;
  workAreas?: string[];
  operationalWorkAreas?: JobWorkArea[];
  originalEstimateSnapshot?: JobEstimateSnapshot;
  status: JobStatus;
  startDate: string;
  endDate?: string;
  scheduleConfirmed?: boolean;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  scheduleAllDay?: boolean;
  scheduleNotes?: string;
  estimatedHours: number;
  actualHours: number;
  estimatedCost: number;
  actualCosts: CostEntry[];
  contractValue: number;
  assignedEmployeeIds: ID[];
  assignedEquipmentIds?: ID[];
  taskHeaderLabels?: Partial<Record<'all' | 'completed', string>>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Crew {
  id: ID;
  name: string;
  colour: string;
  leadEmployeeId?: ID;
  active: boolean;
  defaultDivisionId?: ID;
  memberIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface Division {
  id: ID;
  name: string;
  normalizedName: string;
  colour: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type CalendarView = 'month' | 'week' | 'day';
export type CalendarColourBy = 'crew' | 'division' | 'status';

export interface CalendarPreferences {
  view: CalendarView;
  colourBy: CalendarColourBy;
  showGoogleEvents: boolean;
  showOutlookEvents: boolean;
}

export type ExternalCalendarProvider = 'google' | 'microsoft';

export interface ExternalCalendarEvent {
  externalEventId: string;
  externalCalendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  status: string;
  htmlLink?: string;
  provider: ExternalCalendarProvider;
  sourceLabel: string;
}

export interface GoogleCalendarPreferences {
  showGoogleEvents: boolean;
  syncOliveOpsJobs: boolean;
  scope: 'all_company_jobs';
  employeeIds: ID[];
  divisionIds: ID[];
}

export interface GoogleCalendarIntegration {
  connected: boolean;
  googleAccountEmail?: string;
  selectedCalendarId?: string;
  selectedCalendarSummary?: string;
  connectedAt?: string | null;
  updatedAt?: string | null;
  lastSyncAt?: string | null;
  preferences: GoogleCalendarPreferences;
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor?: string | null;
}

export interface GoogleCalendarEvent {
  googleEventId: string;
  googleCalendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  status: string;
  htmlLink?: string;
  source: 'google';
}

export interface MicrosoftCalendarPreferences {
  showOutlookEvents: boolean;
  syncOliveOpsJobs: boolean;
  scope: 'all_company_jobs';
  employeeIds: ID[];
  divisionIds: ID[];
}

export interface MicrosoftCalendarIntegration {
  connected: boolean;
  microsoftAccountEmail?: string;
  microsoftAccountName?: string;
  selectedCalendarId?: string;
  selectedCalendarSummary?: string;
  connectedAt?: string | null;
  updatedAt?: string | null;
  lastSyncAt?: string | null;
  preferences: MicrosoftCalendarPreferences;
}

export interface MicrosoftCalendarListItem {
  id: string;
  summary: string;
  primary: boolean;
  canEdit: boolean;
  color?: string | null;
}

// ─── Employees & Time Tracking ───────────────────────────────────────────────

export type EmployeeRole = 'admin' | 'foreman' | 'crew_member';
export type EmployeeCompensationType = 'hourly' | 'salary';
export type EmployeeLabourType = 'field_producing' | 'overhead';

export interface Employee {
  id: ID;
  name: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  hourlyRate: number;
  compensationType?: EmployeeCompensationType;
  labourType?: EmployeeLabourType;
  payrollBurdenPct?: number;
  benefitsExtraCost?: number;
  bonus?: number;
  userId?: ID | null;
  active: boolean;
  createdAt: string;
}

export interface UnbillableTimeCategory {
  id: ID;
  name: string;
  description?: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ClockStatus = 'clocked_in' | 'clocked_out';
export type TimeEntryWorkType = 'job' | 'drive_time' | 'non_billable';

export type TimeCorrectionRequestType =
  | 'forgot_clock_in'
  | 'forgot_clock_out'
  | 'wrong_time'
  | 'wrong_job'
  | 'wrong_activity'
  | 'split_activity'
  | 'other';

export type TimeCorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface TimeCorrectionSegmentRequest {
  id: ID;
  startAt: string;
  endAt: string;
  requestedJobId?: ID;
  requestedActivityType: TimeEntryWorkType;
  notes?: string;
}

export interface TimeCorrectionRequest {
  id: ID;
  employeeId: ID;
  timeEntryId?: ID;
  requestType: TimeCorrectionRequestType;
  status: TimeCorrectionRequestStatus;
  requestedClockInAt?: string;
  requestedClockOutAt?: string;
  requestedJobId?: ID;
  requestedActivityType?: TimeEntryWorkType;
  requestedUnbillableCategoryId?: ID;
  requestedUnbillableCategoryName?: string;
  requestedSegments?: TimeCorrectionSegmentRequest[];
  reason: string;
  submittedByUserId: ID;
  submittedAt: string;
  reviewedByUserId?: ID;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  originalClockInAt?: string;
  originalClockOutAt?: string;
  originalJobId?: ID;
  originalJobIds?: ID[];
  originalActivityType?: TimeEntryWorkType;
  originalUnbillableCategoryId?: ID;
  originalUnbillableCategoryName?: string;
}

export type TimeOffRequestType = 'vacation' | 'sick' | 'personal' | 'unpaid' | 'other';
export type TimeOffRequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface TimeOffRequest {
  id: ID;
  businessId?: ID;
  employeeId: ID;
  employeeName?: string;
  requestType: TimeOffRequestType;
  startDate: string;
  endDate: string;
  employeeNote: string;
  status: TimeOffRequestStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedByUserId?: ID;
  reviewedByName?: string;
  reviewNote?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: ID;
  employeeId: ID;
  jobId?: ID;
  jobIds?: ID[];
  workType: TimeEntryWorkType;
  unbillableCategoryId?: ID;
  unbillableCategoryName?: string;
  clockIn: string;
  clockOut?: string;
  breakMinutes: number;
  notes: string;
  photoAttachmentUrl?: string;
  photoAttachmentFileIds?: ID[];
  photoAttachmentFileId?: string;
  clockInPhotoFileId?: string;
  clockOutPhotoFileIds?: ID[];
  clockOutPhotoFileId?: string;
  status: ClockStatus;
}

export interface AuditEvent {
  id: ID;
  action: 'backfill_time_entries' | string;
  actorUserId: ID;
  actorName: string;
  actorEmail: string;
  affectedEntryCount: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ─── Forms ───────────────────────────────────────────────────────────────────

export type FormCategory =
  | 'safety'
  | 'vehicle'
  | 'equipment'
  | 'job_site'
  | 'hr'
  | 'operations'
  | 'maintenance'
  | 'custom';

export type FormStatus = 'active' | 'draft' | 'archived';

export type FormAssignmentType =
  | 'everyone'
  | 'role'
  | 'employee'
  | 'division'
  | 'job'
  | 'equipment';

export type FormTrigger =
  | 'before_clock_in'
  | 'after_clock_out'
  | 'before_starting_job'
  | 'after_completing_job'
  | 'after_leaving_job'
  | 'job_completed'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'on_demand';

export type FormFieldType =
  | 'section_header'
  | 'paragraph_text'
  | 'single_line_text'
  | 'multi_line_text'
  | 'number'
  | 'currency'
  | 'date'
  | 'time'
  | 'yes_no'
  | 'checkbox'
  | 'multiple_choice'
  | 'dropdown'
  | 'photo_upload'
  | 'file_upload'
  | 'signature'
  | 'employee_selector'
  | 'job_selector'
  | 'customer_selector';

export interface FormRecord {
  id: ID;
  name: string;
  description: string;
  category: FormCategory;
  status: FormStatus;
  assignedTo: FormAssignmentType;
  assignmentValue?: string;
  trigger: FormTrigger[];
  completionRequirement?: 'reminder' | 'required';
  division?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FormField {
  id: ID;
  formId: ID;
  type: FormFieldType;
  label: string;
  helpText?: string;
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
  options?: string[];
  order: number;
}

export type FormSubmissionStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface FormSubmission {
  id: ID;
  formId: ID;
  employeeId: ID;
  jobId?: ID;
  equipmentId?: ID;
  divisionId?: ID;
  trigger?: FormTrigger;
  periodKey?: string;
  submittedAt: string;
  status: FormSubmissionStatus;
  submittedBy?: string;
  submittedByUserId?: ID;
  clientSubmissionId?: string;
}

export interface FormResponse {
  id: ID;
  submissionId: ID;
  fieldId: ID;
  value: string;
  fileIds?: ID[];
  employeeId?: ID;
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export { BUDGET_CATEGORIES };

export type BudgetCategory = typeof BUDGET_CATEGORIES[number];

export type BudgetType = 'operating' | 'capital' | 'project' | 'forecast' | 'custom';
export type BudgetStatus = 'draft' | 'active' | 'archived';
export type BudgetPlanningModel = 'divisions_v1';
export type BudgetDivisionStatus = 'active' | 'archived';

export interface Budget {
  id: ID;
  budgetGroupId?: ID;
  name: string;
  budgetType: BudgetType;
  division: string;
  fiscalYear: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  planningModel?: BudgetPlanningModel;
  status: BudgetStatus;
  overheadRecoveryAllocation?: {
    labourPercent: number;
    equipmentPercent: number;
    materialsPercent: number;
    subcontractorsPercent: number;
  };
  overheadRecoveryPolicy?: OverheadRecoveryPolicy;
  desiredNetProfit?: number;
  targetMarginPct?: number;
  equipmentUtilizationHours?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetDivision {
  id: ID;
  budgetId: ID;
  name: string;
  costCode?: string;
  description?: string;
  revenueTarget: number;
  status: BudgetDivisionStatus;
  sortOrder: number;
  overheadRecoveryPolicy?: OverheadRecoveryPolicy;
  createdAt: string;
  updatedAt: string;
}

export type BudgetDivisionPlanCategory = 'labour' | 'equipment' | 'materials' | 'subcontractors' | 'overhead';

export type LabourClassification = 'billable' | 'overhead';

export interface LabourDivisionAllocation {
  divisionId: ID;
  hours?: number;
  percentage?: number;
}

export interface EquipmentDivisionAllocation {
  divisionId: ID;
  months: number;
  sellableHours?: number;
}

export interface OverheadDivisionAllocation {
  divisionId: ID;
  percentage: number;
}

export interface OverheadRecoveryAllocation {
  labourPercent: number;
  equipmentPercent: number;
  materialsPercent: number;
  subcontractorsPercent: number;
}

export interface OverheadRecoveryPolicy {
  version: 2;
  allocation: OverheadRecoveryAllocation;
}

export interface BudgetDivisionPlanningItem {
  id: ID;
  budgetId: ID;
  divisionId: ID;
  category: BudgetDivisionPlanCategory;
  name?: string;
  description?: string;
  sortOrder: number;
  employeeId?: ID;
  role?: string;
  compType?: LabourCompType;
  hourlyRate?: number;
  annualSalary?: number;
  plannedHours?: number;
  labourClassification?: LabourClassification;
  expectedBillablePct?: number;
  divisionAllocations?: LabourDivisionAllocation[];
  billableHours?: number;
  unbillableHours?: number;
  overtimeHours?: number;
  overtimeMultiplier?: number;
  payrollBurdenPct?: number;
  labourBurdenPct?: number;
  benefitsExtraCost?: number;
  bonus?: number;
  equipmentId?: ID;
  costType?: EquipmentCostType;
  classification?: EquipmentClassification;
  costCode?: string;
  equipmentPayment?: number;
  equipmentPaymentFrequencyPerYear?: number;
  paymentFrequencyPerYear?: number;
  yearlyFuelCost?: number;
  yearlyInsuranceCost?: number;
  yearlyMaintenanceCost?: number;
  sellableHoursPerYear?: number;
  equipmentHoursPerDay?: number;
  utilizationHours?: number;
  allocationMonths?: number;
  equipmentDivisionAllocations?: EquipmentDivisionAllocation[];
  allocationPercent?: number;
  materialCatalogItemId?: ID;
  unit?: string;
  unitCost?: number;
  rate?: number;
  plannedQuantity?: number;
  plannedAmount?: number;
  overheadDivisionAllocations?: OverheadDivisionAllocation[];
  legacyBudgetItemId?: ID;
  vendorId?: ID;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetGroup {
  id: ID;
  name: string;
  year: string;
  budgetIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentBudgetAllocation {
  id: ID;
  equipmentId: ID;
  budgetGroupId: ID;
  budgetId: ID;
  budgetItemId: ID;
  monthsAllocated: number;
  createdAt: string;
  updatedAt: string;
}

export type EquipmentCostType = 'financed' | 'leased' | 'owned';

export interface BudgetItem {
  id: ID;
  budgetId?: ID;
  category: BudgetCategory;
  equipmentCostType?: EquipmentCostType;
  equipmentClassification?: EquipmentClassification;
  equipmentId?: ID;
  costCode?: string;
  equipmentPayment?: number;
  equipmentPaymentFrequencyPerYear?: number;
  fuelPriceUnit?: 'L' | 'gal';
  averageFuelPrice?: number;
  averageFuelBurnPerHour?: number;
  yearlyFuelCost?: number;
  fuelCostPerHour?: number;
  yearlyInsuranceCost?: number;
  yearlyMaintenanceCost?: number;
  equipmentHoursPerDay?: number;
  monthlyInsuranceCost?: number;
  monthlyMaintenanceCost?: number;
  sellableHoursPerYear?: number;
  actualMachineHoursPerYear?: number;
  monthsUsedPerYear?: number;
  equipmentCostAllocationPercent?: number;
  sortOrder?: number;
  description: string;
  budgeted: number;
  actual: number;
  period: string; // YYYY-MM
}

export interface BudgetRate {
  id: ID;
  budgetId: ID;
  category: LineItemCategory;
  itemName: string;
  description: string;
  unit: string;
  unitCost: number;
  budgetItemId?: ID;
  employeeId?: ID;
  equipmentId?: ID;
  materialCatalogItemId?: ID;
  vendorId?: ID;
  overheadRecoveryPerUnit?: number;
  pricingVersion?: number;
  divisionId?: ID;
  directCostPerUnit?: number;
  divisionOverheadRecoveryPerUnit?: number;
  companyOverheadRecoveryPerUnit?: number;
  recoveredCostPerUnit?: number;
  targetMarginPercent?: number;
  recommendedSellPrice?: number;
  defaultMarkupPercent: number;
  defaultSellPrice: number;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type LabourCompType = 'hourly' | 'salaried';

export interface LabourBudgetPlan {
  id: ID;
  budgetId?: ID;
  employeeId: ID;
  year: string; // YYYY
  compType: LabourCompType;
  description?: string;
  sortOrder?: number;
  hoursPerYear?: number;
  billablePct?: number;
  overtimeFactorPct?: number;
  payrollBurdenPct?: number;
  benefitsExtraCost?: number;
  bonus?: number;
  billableHoursYear: number;
  unbillableHoursYear: number;
  overtimeHoursYear: number;
  overtimeMultiplier: number;
  hourlyRate: number;
  annualSalary: number;
  labourBurdenPct: number;
}

export interface LabourHoursSalesGoal {
  id: ID;
  budgetId?: ID;
  year: string; // YYYY
  hoursGoal: number;
}

export interface RevenueSalesGoal {
  id: ID;
  budgetId?: ID;
  scopeType: 'year';
  scopeValue: string; // YYYY
  goalRevenue: number;
  workingDays: number;
}

export interface BudgetPeriod {
  period: string; // YYYY-MM
  items: BudgetItem[];
}
