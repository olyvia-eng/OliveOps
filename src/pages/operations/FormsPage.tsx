import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  FilePlus2,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  TextArea,
} from '../../components/ui';
import { useStore } from '../../store';
import { formatDateTime } from '../../utils';
import type {
  FormAssignmentType,
  FormCategory,
  FormField,
  FormFieldType,
  FormRecord,
  FormStatus,
  FormSubmissionStatus,
  FormTrigger,
} from '../../types';

const FORM_CATEGORIES: Array<{ value: FormCategory; label: string }> = [
  { value: 'safety', label: 'Safety' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'job_site', label: 'Job Site' },
  { value: 'hr', label: 'HR' },
  { value: 'operations', label: 'Operations' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'custom', label: 'Custom' },
];

const FORM_STATUSES: Array<{ value: FormStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

const ASSIGNMENT_OPTIONS: Array<{ value: FormAssignmentType; label: string }> = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'role', label: 'Specific Role' },
  { value: 'employee', label: 'Specific Employee' },
  { value: 'division', label: 'Specific Division' },
  { value: 'job', label: 'Specific Job' },
  { value: 'equipment', label: 'Specific Equipment' },
];

const TRIGGER_OPTIONS: Array<{ value: FormTrigger; label: string }> = [
  { value: 'before_clock_in', label: 'Before Clock In' },
  { value: 'after_clock_out', label: 'After Clock Out' },
  { value: 'before_starting_job', label: 'Before Starting Job' },
  { value: 'after_completing_job', label: 'After Completing Job' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'on_demand', label: 'On Demand' },
];

const FIELD_TYPES: Array<{ value: FormFieldType; label: string }> = [
  { value: 'section_header', label: 'Section Header' },
  { value: 'paragraph_text', label: 'Paragraph Text' },
  { value: 'single_line_text', label: 'Single Line Text' },
  { value: 'multi_line_text', label: 'Multi Line Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'photo_upload', label: 'Photo Upload' },
  { value: 'file_upload', label: 'File Upload' },
  { value: 'signature', label: 'Signature' },
  { value: 'employee_selector', label: 'Employee Selector' },
  { value: 'job_selector', label: 'Job Selector' },
  { value: 'customer_selector', label: 'Customer Selector' },
];

type FormsTab = 'dashboard' | 'builder' | 'submissions' | 'templates';

type FormTemplate = {
  name: string;
  category: FormCategory;
  description: string;
  fields: Array<{ type: FormFieldType; label: string; required?: boolean; options?: string[] }>;
};

const FORM_TEMPLATES: FormTemplate[] = [
  {
    name: 'Morning Truck Inspection',
    category: 'vehicle',
    description: 'Daily pre-trip checklist for truck condition and safety readiness.',
    fields: [
      { type: 'date', label: 'Inspection Date', required: true },
      { type: 'employee_selector', label: 'Driver', required: true },
      { type: 'yes_no', label: 'Lights and signals working?', required: true },
      { type: 'multi_line_text', label: 'Notes / Deficiencies' },
    ],
  },
  {
    name: 'MTO Daily Inspection',
    category: 'vehicle',
    description: 'Regulatory daily commercial vehicle inspection.',
    fields: [
      { type: 'date', label: 'Inspection Date', required: true },
      { type: 'yes_no', label: 'Brakes checked?', required: true },
      { type: 'yes_no', label: 'Tires checked?', required: true },
      { type: 'signature', label: 'Driver Signature', required: true },
    ],
  },
  {
    name: 'Vehicle Damage Report',
    category: 'vehicle',
    description: 'Capture vehicle damage, location, and incident details.',
    fields: [
      { type: 'date', label: 'Incident Date', required: true },
      { type: 'photo_upload', label: 'Damage Photos', required: true },
      { type: 'multi_line_text', label: 'Damage Description', required: true },
      { type: 'signature', label: 'Employee Signature', required: true },
    ],
  },
  {
    name: 'Excavator Daily Inspection',
    category: 'equipment',
    description: 'Daily excavator check before operation.',
    fields: [
      { type: 'dropdown', label: 'Equipment', required: true },
      { type: 'yes_no', label: 'Hydraulic leaks present?', required: true },
      { type: 'yes_no', label: 'Tracks and undercarriage OK?', required: true },
      { type: 'multi_line_text', label: 'Inspection Notes' },
    ],
  },
  {
    name: 'Skid Steer Inspection',
    category: 'equipment',
    description: 'Daily skid steer condition and functionality checklist.',
    fields: [
      { type: 'dropdown', label: 'Equipment', required: true },
      { type: 'yes_no', label: 'Attachment secured?', required: true },
      { type: 'yes_no', label: 'Backup alarm functional?', required: true },
      { type: 'multi_line_text', label: 'Issues Found' },
    ],
  },
  {
    name: 'Fuel Log',
    category: 'equipment',
    description: 'Track fuel usage by job and equipment.',
    fields: [
      { type: 'date', label: 'Fuel Date', required: true },
      { type: 'number', label: 'Litres / Gallons', required: true },
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'dropdown', label: 'Equipment', required: true },
    ],
  },
  {
    name: 'Toolbox Talk Attendance',
    category: 'safety',
    description: 'Attendance and notes for daily/weekly toolbox talks.',
    fields: [
      { type: 'date', label: 'Talk Date', required: true },
      { type: 'single_line_text', label: 'Topic', required: true },
      { type: 'multi_line_text', label: 'Attendees', required: true },
      { type: 'signature', label: 'Supervisor Signature', required: true },
    ],
  },
  {
    name: 'Tailgate Safety Meeting',
    category: 'safety',
    description: 'Field-level safety meeting checklist and outcomes.',
    fields: [
      { type: 'date', label: 'Meeting Date', required: true },
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Hazards Discussed', required: true },
      { type: 'signature', label: 'Facilitator Signature', required: true },
    ],
  },
  {
    name: 'Hazard Assessment',
    category: 'safety',
    description: 'Pre-task hazard assessment and controls.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Identified Hazards', required: true },
      { type: 'multi_line_text', label: 'Controls Implemented', required: true },
      { type: 'signature', label: 'Assessor Signature', required: true },
    ],
  },
  {
    name: 'Near Miss Report',
    category: 'safety',
    description: 'Document near misses for corrective action tracking.',
    fields: [
      { type: 'date', label: 'Event Date', required: true },
      { type: 'multi_line_text', label: 'What Happened?', required: true },
      { type: 'multi_line_text', label: 'Corrective Actions', required: true },
      { type: 'photo_upload', label: 'Photo Evidence' },
    ],
  },
  {
    name: 'Incident Report',
    category: 'safety',
    description: 'Capture incident details and immediate response actions.',
    fields: [
      { type: 'date', label: 'Incident Date', required: true },
      { type: 'time', label: 'Incident Time', required: true },
      { type: 'multi_line_text', label: 'Incident Details', required: true },
      { type: 'signature', label: 'Reporter Signature', required: true },
    ],
  },
  {
    name: 'Daily Site Checklist',
    category: 'job_site',
    description: 'General daily site readiness and controls checklist.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'yes_no', label: 'Site secured?', required: true },
      { type: 'yes_no', label: 'Materials staged?', required: true },
      { type: 'multi_line_text', label: 'Notes' },
    ],
  },
  {
    name: 'End of Day Site Cleanup',
    category: 'job_site',
    description: 'Confirm cleanup and secure site at end of day.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'yes_no', label: 'Waste removed?', required: true },
      { type: 'yes_no', label: 'Equipment secured?', required: true },
      { type: 'photo_upload', label: 'Cleanup Photos' },
    ],
  },
  {
    name: 'Job Completion Checklist',
    category: 'job_site',
    description: 'Closeout checklist before job signoff.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'checkbox', label: 'All punch list items complete?', required: true },
      { type: 'multi_line_text', label: 'Outstanding Items' },
      { type: 'signature', label: 'Supervisor Signature', required: true },
    ],
  },
  {
    name: 'Customer Walkthrough',
    category: 'job_site',
    description: 'Capture walkthrough notes and client signoff.',
    fields: [
      { type: 'customer_selector', label: 'Customer', required: true },
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Walkthrough Notes', required: true },
      { type: 'signature', label: 'Customer Signature', required: true },
    ],
  },
  {
    name: 'Vacation Request',
    category: 'hr',
    description: 'Employee request for vacation approval.',
    fields: [
      { type: 'employee_selector', label: 'Employee', required: true },
      { type: 'date', label: 'Start Date', required: true },
      { type: 'date', label: 'End Date', required: true },
      { type: 'multi_line_text', label: 'Notes' },
    ],
  },
  {
    name: 'Time Correction Request',
    category: 'hr',
    description: 'Request correction for clock-in/out records.',
    fields: [
      { type: 'employee_selector', label: 'Employee', required: true },
      { type: 'date', label: 'Date Needing Correction', required: true },
      { type: 'multi_line_text', label: 'Correction Details', required: true },
      { type: 'signature', label: 'Employee Signature', required: true },
    ],
  },
  {
    name: 'Daily Crew Checklist',
    category: 'operations',
    description: 'Daily operations checklist for field crew.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'yes_no', label: 'Crew briefing completed?', required: true },
      { type: 'yes_no', label: 'Tools and equipment ready?', required: true },
      { type: 'multi_line_text', label: 'Crew Notes' },
    ],
  },
  {
    name: 'Supervisor Daily Report',
    category: 'operations',
    description: 'Supervisor report of work progress, blockers, and risks.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Work Completed Today', required: true },
      { type: 'multi_line_text', label: 'Issues / Delays', required: true },
      { type: 'signature', label: 'Supervisor Signature', required: true },
    ],
  },
];

const FIELD_TYPES_WITH_OPTIONS = new Set<FormFieldType>(['multiple_choice', 'dropdown', 'checkbox']);

const toLabel = (value: string) => value
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const emptyFormDraft = () => ({
  name: '',
  description: '',
  category: 'operations' as FormCategory,
});

export default function FormsPage() {
  const {
    forms,
    formFields,
    formSubmissions,
    formResponses,
    employees,
    jobs,
    customers,
    equipmentAssets,
    divisions,
    addForm,
    updateForm,
    deleteForm,
    addFormField,
    updateFormField,
    deleteFormField,
    addFormSubmission,
    updateFormSubmission,
    upsertFormResponse,
  } = useStore();

  const [activeTab, setActiveTab] = useState<FormsTab>('dashboard');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FormCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FormStatus>('all');
  const [newFormModalOpen, setNewFormModalOpen] = useState(false);
  const [newFormDraft, setNewFormDraft] = useState(emptyFormDraft());
  const [newFormError, setNewFormError] = useState('');
  const [selectedFormId, setSelectedFormId] = useState('');
  const [builderFieldType, setBuilderFieldType] = useState<FormFieldType>('single_line_text');
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState<'all' | FormSubmissionStatus>('all');
  const [viewSubmissionId, setViewSubmissionId] = useState<string | null>(null);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitAsEmployeeId, setSubmitAsEmployeeId] = useState('');
  const [submitResponses, setSubmitResponses] = useState<Record<string, string>>({});

  const sortedForms = useMemo(() => {
    return forms.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [forms]);

  useEffect(() => {
    if (sortedForms.length === 0) {
      setSelectedFormId('');
      return;
    }
    if (!selectedFormId || !sortedForms.some((form) => form.id === selectedFormId)) {
      setSelectedFormId(sortedForms[0].id);
    }
  }, [selectedFormId, sortedForms]);

  const selectedForm = selectedFormId ? (forms.find((form) => form.id === selectedFormId) ?? null) : null;

  const filteredForms = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return sortedForms.filter((form) => {
      if (categoryFilter !== 'all' && form.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && form.status !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return (
        form.name.toLowerCase().includes(normalizedSearch)
        || form.description.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [categoryFilter, search, sortedForms, statusFilter]);

  const fieldsForSelectedForm = useMemo(() => {
    if (!selectedFormId) return [];
    return formFields
      .filter((field) => field.formId === selectedFormId)
      .slice()
      .sort((a, b) => a.order - b.order);
  }, [formFields, selectedFormId]);

  const submissionsForSelectedForm = useMemo(() => {
    if (!selectedFormId) return [];
    return formSubmissions
      .filter((submission) => submission.formId === selectedFormId)
      .slice()
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }, [formSubmissions, selectedFormId]);

  const filteredSubmissions = useMemo(() => {
    const normalizedSearch = submissionSearch.trim().toLowerCase();

    return submissionsForSelectedForm.filter((submission) => {
      if (submissionStatusFilter !== 'all' && submission.status !== submissionStatusFilter) return false;
      if (!normalizedSearch) return true;

      const employeeName = employees.find((employee) => employee.id === submission.employeeId)?.name ?? '';
      const jobName = jobs.find((job) => job.id === submission.jobId)?.title ?? '';
      const submittedBy = submission.submittedBy ?? '';

      return (
        employeeName.toLowerCase().includes(normalizedSearch)
        || jobName.toLowerCase().includes(normalizedSearch)
        || submittedBy.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [employees, jobs, submissionSearch, submissionStatusFilter, submissionsForSelectedForm]);

  const submissionCountByFormId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const submission of formSubmissions) {
      counts[submission.formId] = (counts[submission.formId] ?? 0) + 1;
    }
    return counts;
  }, [formSubmissions]);

  const openNewForm = () => {
    setNewFormDraft(emptyFormDraft());
    setNewFormError('');
    setNewFormModalOpen(true);
  };

  const createFormFromDraft = () => {
    setNewFormError('');
    if (!newFormDraft.name.trim()) {
      setNewFormError('Form name is required.');
      return;
    }

    const created = addForm({
      name: newFormDraft.name.trim(),
      description: newFormDraft.description.trim(),
      category: newFormDraft.category,
      status: 'draft',
      assignedTo: 'everyone',
      assignmentValue: '',
      trigger: ['on_demand'],
      division: '',
    });

    setSelectedFormId(created.id);
    setActiveTab('builder');
    setNewFormModalOpen(false);
  };

  const updateSelectedForm = (patch: Partial<FormRecord>) => {
    if (!selectedForm) return;
    updateForm(selectedForm.id, patch);
  };

  const nextFieldOrder = fieldsForSelectedForm.length > 0
    ? Math.max(...fieldsForSelectedForm.map((field) => field.order)) + 1
    : 0;

  const addFieldToSelectedForm = () => {
    if (!selectedForm) return;
    addFormField({
      formId: selectedForm.id,
      type: builderFieldType,
      label: FIELD_TYPES.find((fieldType) => fieldType.value === builderFieldType)?.label ?? 'New Field',
      helpText: '',
      required: false,
      defaultValue: '',
      placeholder: '',
      options: FIELD_TYPES_WITH_OPTIONS.has(builderFieldType) ? ['Option 1', 'Option 2'] : [],
      order: nextFieldOrder,
    });
  };

  const reorderFields = (ordered: FormField[]) => {
    ordered.forEach((field, index) => {
      if (field.order !== index) {
        updateFormField(field.id, { order: index });
      }
    });
  };

  const handleFieldDrop = (targetFieldId: string) => {
    if (!draggingFieldId || draggingFieldId === targetFieldId) {
      setDraggingFieldId(null);
      return;
    }

    const current = [...fieldsForSelectedForm];
    const draggingIndex = current.findIndex((field) => field.id === draggingFieldId);
    const targetIndex = current.findIndex((field) => field.id === targetFieldId);
    if (draggingIndex < 0 || targetIndex < 0) {
      setDraggingFieldId(null);
      return;
    }

    const [dragged] = current.splice(draggingIndex, 1);
    current.splice(targetIndex, 0, dragged);
    reorderFields(current);
    setDraggingFieldId(null);
  };

  const duplicateField = (field: FormField) => {
    addFormField({
      formId: field.formId,
      type: field.type,
      label: `${field.label} (Copy)`,
      helpText: field.helpText ?? '',
      required: field.required,
      defaultValue: field.defaultValue ?? '',
      placeholder: field.placeholder ?? '',
      options: field.options ?? [],
      order: nextFieldOrder,
    });
  };

  const deleteSelectedForm = () => {
    if (!selectedForm) return;

    for (const field of fieldsForSelectedForm) {
      deleteFormField(field.id);
    }

    deleteForm(selectedForm.id);
  };

  const handleUseTemplate = (template: FormTemplate) => {
    const created = addForm({
      name: template.name,
      description: template.description,
      category: template.category,
      status: 'draft',
      assignedTo: 'everyone',
      assignmentValue: '',
      trigger: ['on_demand'],
      division: '',
    });

    template.fields.forEach((field, index) => {
      addFormField({
        formId: created.id,
        type: field.type,
        label: field.label,
        helpText: '',
        required: Boolean(field.required),
        defaultValue: '',
        placeholder: '',
        options: field.options ?? [],
        order: index,
      });
    });

    setSelectedFormId(created.id);
    setActiveTab('builder');
  };

  const openSubmissionScreen = () => {
    if (!selectedForm) return;
    setSubmitAsEmployeeId(employees[0]?.id ?? '');
    setSubmitResponses({});
    setSubmitModalOpen(true);
  };

  const submitFormResponse = () => {
    if (!selectedForm || !submitAsEmployeeId) return;

    const submission = addFormSubmission({
      formId: selectedForm.id,
      employeeId: submitAsEmployeeId,
      jobId: jobs[0]?.id,
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      submittedBy: employees.find((employee) => employee.id === submitAsEmployeeId)?.name ?? 'Employee',
    });

    for (const field of fieldsForSelectedForm) {
      const value = submitResponses[field.id] ?? '';
      upsertFormResponse({
        id: `${submission.id}-${field.id}`,
        submissionId: submission.id,
        fieldId: field.id,
        value,
      });
    }

    setSubmitModalOpen(false);
    setActiveTab('submissions');
  };

  const activeSubmission = viewSubmissionId
    ? (formSubmissions.find((submission) => submission.id === viewSubmissionId) ?? null)
    : null;

  const activeSubmissionResponses = useMemo(() => {
    if (!activeSubmission) return [];
    return formResponses.filter((response) => response.submissionId === activeSubmission.id);
  }, [activeSubmission, formResponses]);

  const assignmentValueControl = selectedForm ? (() => {
    if (selectedForm.assignedTo === 'role') {
      return (
        <Select
          label="Role"
          value={selectedForm.assignmentValue ?? ''}
          onChange={(event) => updateSelectedForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select role</option>
          <option value="admin">Admin</option>
          <option value="foreman">Foreman</option>
          <option value="crew_member">Crew Member</option>
        </Select>
      );
    }

    if (selectedForm.assignedTo === 'employee') {
      return (
        <Select
          label="Employee"
          value={selectedForm.assignmentValue ?? ''}
          onChange={(event) => updateSelectedForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select employee</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name}</option>
          ))}
        </Select>
      );
    }

    if (selectedForm.assignedTo === 'job') {
      return (
        <Select
          label="Job"
          value={selectedForm.assignmentValue ?? ''}
          onChange={(event) => updateSelectedForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>{job.title}</option>
          ))}
        </Select>
      );
    }

    if (selectedForm.assignedTo === 'equipment') {
      return (
        <Select
          label="Equipment"
          value={selectedForm.assignmentValue ?? ''}
          onChange={(event) => updateSelectedForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select equipment</option>
          {equipmentAssets.map((equipment) => (
            <option key={equipment.id} value={equipment.id}>{equipment.name}</option>
          ))}
        </Select>
      );
    }

    if (selectedForm.assignedTo === 'division') {
      return (
        <Select
          label="Division"
          value={selectedForm.assignmentValue ?? ''}
          onChange={(event) => updateSelectedForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select division</option>
          {divisions.filter((division) => division.active).map((division) => (
            <option key={division.id} value={division.id}>{division.name}</option>
          ))}
        </Select>
      );
    }

    return null;
  })() : null;

  return (
    <div>
      <PageHeader
        title="Forms"
        subtitle="Create, manage, assign, and review contractor-friendly digital forms for field operations."
        action={<Button onClick={openNewForm}><Plus size={16} /> New Form</Button>}
      />

      <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {([
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'builder', label: 'Builder' },
          { key: 'submissions', label: 'Submissions' },
          { key: 'templates', label: 'Templates' },
        ] as Array<{ key: FormsTab; label: string }>).map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`rounded px-3 py-1 text-sm ${activeTab === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && (
        <>
          <Card className="p-4 mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by form name or description"
              />
              <Select
                label="Category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value as 'all' | FormCategory)}
              >
                <option value="all">All Categories</option>
                {FORM_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </Select>
              <Select
                label="Status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | FormStatus)}
              >
                <option value="all">All Statuses</option>
                {FORM_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </Select>
            </div>
          </Card>

          {filteredForms.length === 0 ? (
            sortedForms.length === 0 ? (
              <EmptyState
                title="No forms yet"
                description="Create reusable forms for field and office workflows."
                action={<Button onClick={openNewForm}><FilePlus2 size={16} /> New Form</Button>}
              />
            ) : (
              <EmptyState
                title="No forms match your filters"
                description="Try different filters or create a new form if you need a new workflow."
                action={<Button onClick={openNewForm}><FilePlus2 size={16} /> New Form</Button>}
              />
            )
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredForms.map((form) => (
                <Card key={form.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{form.name}</h2>
                      <p className="text-sm text-gray-500 mt-1">{form.description || 'No description yet.'}</p>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${form.status === 'active' ? 'bg-brand-100 text-brand-700' : form.status === 'draft' ? 'bg-gray-100 text-gray-700' : 'bg-accent-50 text-accent-700'}`}>
                      {toLabel(form.status)}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-gray-500">Category:</span> <span className="font-medium text-gray-800">{toLabel(form.category)}</span></div>
                    <div><span className="text-gray-500">Assigned To:</span> <span className="font-medium text-gray-800">{toLabel(form.assignedTo)}</span></div>
                    <div><span className="text-gray-500">Submissions:</span> <span className="font-medium text-gray-800">{submissionCountByFormId[form.id] ?? 0}</span></div>
                    <div><span className="text-gray-500">Last Updated:</span> <span className="font-medium text-gray-800">{new Date(form.updatedAt).toLocaleDateString()}</span></div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setSelectedFormId(form.id);
                        setActiveTab('builder');
                      }}
                    >
                      Open Builder
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setSelectedFormId(form.id);
                        setActiveTab('submissions');
                      }}
                    >
                      View Submissions
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'builder' && (
        selectedForm ? (
          <div className="space-y-6">
            <Card className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Select
                  label="Active Form"
                  value={selectedForm.id}
                  onChange={(event) => setSelectedFormId(event.target.value)}
                >
                  {sortedForms.map((form) => (
                    <option key={form.id} value={form.id}>{form.name}</option>
                  ))}
                </Select>
                <Input
                  label="Form Name"
                  value={selectedForm.name}
                  onChange={(event) => updateSelectedForm({ name: event.target.value })}
                />
                <Select
                  label="Status"
                  value={selectedForm.status}
                  onChange={(event) => updateSelectedForm({ status: event.target.value as FormStatus })}
                >
                  {FORM_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </Select>
              </div>
              <div className="mt-3">
                <TextArea
                  label="Description"
                  value={selectedForm.description}
                  onChange={(event) => updateSelectedForm({ description: event.target.value })}
                />
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <Select
                  label="Category"
                  value={selectedForm.category}
                  onChange={(event) => updateSelectedForm({ category: event.target.value as FormCategory })}
                >
                  {FORM_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </Select>
                <Select
                  label="Assigned To"
                  value={selectedForm.assignedTo}
                  onChange={(event) => updateSelectedForm({ assignedTo: event.target.value as FormAssignmentType, assignmentValue: '' })}
                >
                  {ASSIGNMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
                {assignmentValueControl}
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Trigger Rules (Clock In/Out, Job Start/Completion) are configured here.
                {/* TODO: Enforce trigger completion through backend action guards and policy checks before mutating clock/job state. */}
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                {TRIGGER_OPTIONS.map((trigger) => {
                  const checked = selectedForm.trigger.includes(trigger.value);
                  return (
                    <label key={trigger.value} className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const nextTrigger = checked
                            ? selectedForm.trigger.filter((value) => value !== trigger.value)
                            : [...selectedForm.trigger, trigger.value];
                          updateSelectedForm({ trigger: nextTrigger });
                        }}
                      />
                      <span>{trigger.label}</span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="danger" size="sm" onClick={deleteSelectedForm}><Trash2 size={14} /> Delete Form</Button>
                <Button variant="secondary" size="sm" onClick={openSubmissionScreen}>Preview Submission Screen</Button>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <Select
                  label="Field Type"
                  value={builderFieldType}
                  onChange={(event) => setBuilderFieldType(event.target.value as FormFieldType)}
                  className="sm:w-72"
                >
                  {FIELD_TYPES.map((fieldType) => (
                    <option key={fieldType.value} value={fieldType.value}>{fieldType.label}</option>
                  ))}
                </Select>
                <Button onClick={addFieldToSelectedForm}><Plus size={16} /> Add Field</Button>
              </div>
            </Card>

            {fieldsForSelectedForm.length === 0 ? (
              <EmptyState
                title="No fields yet"
                description="Add your first field to start building this form."
              />
            ) : (
              <div className="space-y-3">
                {fieldsForSelectedForm.map((field) => (
                  <Card key={field.id} className="p-4">
                    <div
                      draggable
                      onDragStart={() => setDraggingFieldId(field.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleFieldDrop(field.id)}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-gray-700">
                          <GripVertical size={16} />
                          <span className="text-sm font-semibold">{toLabel(field.type)}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => duplicateField(field)}><Copy size={13} /></Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteFormField(field.id)}><Trash2 size={13} className="text-accent-700" /></Button>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Input
                            label="Label"
                            value={field.label}
                            onChange={(event) => updateFormField(field.id, { label: event.target.value })}
                          />
                          <Input
                            label="Placeholder"
                            value={field.placeholder ?? ''}
                            onChange={(event) => updateFormField(field.id, { placeholder: event.target.value })}
                          />
                          <Input
                            label="Default Value"
                            value={field.defaultValue ?? ''}
                            onChange={(event) => updateFormField(field.id, { defaultValue: event.target.value })}
                          />
                          <Input
                            label="Order"
                            type="number"
                            min={0}
                            value={field.order}
                            onChange={(event) => updateFormField(field.id, { order: Number(event.target.value) })}
                          />
                        </div>

                        <div className="mt-3">
                          <TextArea
                            label="Help Text"
                            value={field.helpText ?? ''}
                            onChange={(event) => updateFormField(field.id, { helpText: event.target.value })}
                          />
                        </div>

                        {FIELD_TYPES_WITH_OPTIONS.has(field.type) && (
                          <div className="mt-3">
                            <TextArea
                              label="Options (comma-separated)"
                              value={(field.options ?? []).join(', ')}
                              onChange={(event) => updateFormField(field.id, {
                                options: event.target.value
                                  .split(',')
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              })}
                            />
                          </div>
                        )}

                        <div className="mt-3 flex items-center gap-2 text-sm">
                          <input
                            id={`required-${field.id}`}
                            type="checkbox"
                            checked={field.required}
                            onChange={(event) => updateFormField(field.id, { required: event.target.checked })}
                          />
                          <label htmlFor={`required-${field.id}`} className="text-gray-700">Required field</label>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            title="No form selected"
            description="Create a new form or choose one from the dashboard to open the builder."
            action={<Button onClick={openNewForm}><Plus size={16} /> New Form</Button>}
          />
        )
      )}

      {activeTab === 'submissions' && (
        selectedForm ? (
          <div className="space-y-6">
            <Card className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Select
                  label="Form"
                  value={selectedForm.id}
                  onChange={(event) => setSelectedFormId(event.target.value)}
                >
                  {sortedForms.map((form) => (
                    <option key={form.id} value={form.id}>{form.name}</option>
                  ))}
                </Select>
                <Input
                  label="Search"
                  value={submissionSearch}
                  onChange={(event) => setSubmissionSearch(event.target.value)}
                  placeholder="Employee, job, submitted by"
                />
                <Select
                  label="Status"
                  value={submissionStatusFilter}
                  onChange={(event) => setSubmissionStatusFilter(event.target.value as 'all' | FormSubmissionStatus)}
                >
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </Select>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={openSubmissionScreen}>Open Submission Screen</Button>
              </div>
            </Card>

            {filteredSubmissions.length === 0 ? (
              <EmptyState
                title="No submissions"
                description="Submissions will appear here after field employees complete the form."
              />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Job</th>
                        <th className="px-4 py-3 font-medium">Equipment</th>
                        <th className="px-4 py-3 font-medium">Submitted By</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredSubmissions.map((submission) => {
                        const employeeName = employees.find((employee) => employee.id === submission.employeeId)?.name ?? 'Unknown';
                        const jobTitle = jobs.find((job) => job.id === submission.jobId)?.title ?? '—';
                        const equipmentName = equipmentAssets.find((equipment) => equipment.id === submission.equipmentId)?.name ?? '—';
                        const submitted = new Date(submission.submittedAt);
                        return (
                          <tr key={submission.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900 font-medium">{employeeName}</td>
                            <td className="px-4 py-3 text-gray-700">{submitted.toLocaleDateString()}</td>
                            <td className="px-4 py-3 text-gray-700">{submitted.toLocaleTimeString()}</td>
                            <td className="px-4 py-3 text-gray-700 capitalize">{submission.status}</td>
                            <td className="px-4 py-3 text-gray-700">{jobTitle}</td>
                            <td className="px-4 py-3 text-gray-700">{equipmentName}</td>
                            <td className="px-4 py-3 text-gray-700">{submission.submittedBy ?? employeeName}</td>
                            <td className="px-4 py-3">
                              <Button size="sm" variant="ghost" onClick={() => setViewSubmissionId(submission.id)}>View Submission</Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        ) : (
          <EmptyState
            title="No form selected"
            description="Choose a form first to review submission history."
          />
        )
      )}

      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {FORM_TEMPLATES.map((template) => (
            <Card key={template.name} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{template.name}</h2>
                  <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                </div>
                <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                  {toLabel(template.category)}
                </span>
              </div>
              <p className="mt-3 text-xs text-gray-500">{template.fields.length} field(s)</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => handleUseTemplate(template)}>
                  <Plus size={14} /> Add Template
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={newFormModalOpen}
        onClose={() => setNewFormModalOpen(false)}
        title="New Form"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setNewFormModalOpen(false)}>Cancel</Button>
            <Button onClick={createFormFromDraft}>Create Form</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Input
            label="Form Name"
            required
            value={newFormDraft.name}
            onChange={(event) => setNewFormDraft((current) => ({ ...current, name: event.target.value }))}
          />
          <TextArea
            label="Description"
            value={newFormDraft.description}
            onChange={(event) => setNewFormDraft((current) => ({ ...current, description: event.target.value }))}
          />
          <Select
            label="Category"
            value={newFormDraft.category}
            onChange={(event) => setNewFormDraft((current) => ({ ...current, category: event.target.value as FormCategory }))}
          >
            {FORM_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </Select>
          {newFormError && <p className="text-sm text-accent-700">{newFormError}</p>}
        </div>
      </Modal>

      <Modal
        open={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        title={selectedForm ? `Submit: ${selectedForm.name}` : 'Submit Form'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setSubmitModalOpen(false)}>Cancel</Button>
            <Button onClick={submitFormResponse}>Submit</Button>
          </>
        )}
      >
        {!selectedForm ? null : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-900">{selectedForm.name}</p>
              <p className="text-sm text-gray-600 mt-1">{selectedForm.description}</p>
              <p className="text-xs text-gray-500 mt-2">Mobile-friendly field layout with camera/signature support.</p>
              {/* TODO: Add robust offline-first local draft persistence for field users. */}
              {/* TODO: Add periodic auto-save draft sync workflow for poor connectivity environments. */}
            </div>

            <Select
              label="Submit As Employee"
              value={submitAsEmployeeId}
              onChange={(event) => setSubmitAsEmployeeId(event.target.value)}
            >
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </Select>

            <div className="space-y-3">
              {fieldsForSelectedForm.map((field) => {
                const value = submitResponses[field.id] ?? '';

                if (field.type === 'section_header') {
                  return <h3 key={field.id} className="text-base font-semibold text-gray-900">{field.label}</h3>;
                }

                if (field.type === 'paragraph_text') {
                  return <p key={field.id} className="text-sm text-gray-600">{field.label}</p>;
                }

                if (field.type === 'multi_line_text') {
                  return (
                    <TextArea
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      placeholder={field.placeholder}
                      value={value}
                      onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                    />
                  );
                }

                if (field.type === 'yes_no') {
                  return (
                    <Select
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      value={value}
                      onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                    >
                      <option value="">Select</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                  );
                }

                if (FIELD_TYPES_WITH_OPTIONS.has(field.type)) {
                  return (
                    <Select
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      value={value}
                      onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                    >
                      <option value="">Select</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </Select>
                  );
                }

                if (field.type === 'employee_selector') {
                  return (
                    <Select
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      value={value}
                      onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                    >
                      <option value="">Select employee</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.name}>{employee.name}</option>
                      ))}
                    </Select>
                  );
                }

                if (field.type === 'job_selector') {
                  return (
                    <Select
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      value={value}
                      onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                    >
                      <option value="">Select job</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.title}>{job.title}</option>
                      ))}
                    </Select>
                  );
                }

                if (field.type === 'customer_selector') {
                  return (
                    <Select
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      value={value}
                      onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                    >
                      <option value="">Select customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.name}>{customer.name}</option>
                      ))}
                    </Select>
                  );
                }

                if (field.type === 'photo_upload') {
                  return (
                    <div key={field.id} className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-gray-700">{field.label}{field.required ? ' *' : ''}</label>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(event) => {
                          const fileName = event.target.files?.[0]?.name ?? '';
                          setSubmitResponses((current) => ({ ...current, [field.id]: fileName }));
                        }}
                      />
                      {value && <p className="text-xs text-gray-500">Selected: {value}</p>}
                    </div>
                  );
                }

                if (field.type === 'file_upload') {
                  return (
                    <div key={field.id} className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-gray-700">{field.label}{field.required ? ' *' : ''}</label>
                      <input
                        type="file"
                        onChange={(event) => {
                          const fileName = event.target.files?.[0]?.name ?? '';
                          setSubmitResponses((current) => ({ ...current, [field.id]: fileName }));
                        }}
                      />
                      {value && <p className="text-xs text-gray-500">Selected: {value}</p>}
                    </div>
                  );
                }

                if (field.type === 'signature') {
                  return (
                    <Input
                      key={field.id}
                      label={`${field.label} (Signature)`}
                      required={field.required}
                      placeholder="Type full name to sign"
                      value={value}
                      onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                    />
                  );
                }

                const inputType = field.type === 'number' || field.type === 'currency'
                  ? 'number'
                  : field.type === 'date'
                    ? 'date'
                    : field.type === 'time'
                      ? 'time'
                      : 'text';

                return (
                  <Input
                    key={field.id}
                    label={field.label}
                    required={field.required}
                    type={inputType}
                    placeholder={field.placeholder}
                    value={value}
                    onChange={(event) => setSubmitResponses((current) => ({ ...current, [field.id]: event.target.value }))}
                  />
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(activeSubmission)}
        onClose={() => setViewSubmissionId(null)}
        title="Submission Details"
        footer={(
          <div className="flex items-center justify-end gap-2">
            {activeSubmission?.status === 'submitted' && (
              <>
                <Button variant="secondary" onClick={() => updateFormSubmission(activeSubmission.id, { status: 'rejected' })}>Reject</Button>
                <Button onClick={() => updateFormSubmission(activeSubmission.id, { status: 'approved' })}>Approve</Button>
              </>
            )}
            <Button variant="secondary" onClick={() => setViewSubmissionId(null)}>Close</Button>
          </div>
        )}
        wide
      >
        {!activeSubmission ? null : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-gray-500">Submitted:</span> <span className="text-gray-900 font-medium">{formatDateTime(activeSubmission.submittedAt)}</span></div>
              <div><span className="text-gray-500">Status:</span> <span className="text-gray-900 font-medium capitalize">{activeSubmission.status}</span></div>
              <div><span className="text-gray-500">Submitted By:</span> <span className="text-gray-900 font-medium">{activeSubmission.submittedBy ?? '—'}</span></div>
              <div><span className="text-gray-500">Job:</span> <span className="text-gray-900 font-medium">{jobs.find((job) => job.id === activeSubmission.jobId)?.title ?? '—'}</span></div>
              <div><span className="text-gray-500">Equipment:</span> <span className="text-gray-900 font-medium">{equipmentAssets.find((equipment) => equipment.id === activeSubmission.equipmentId)?.name ?? '—'}</span></div>
              <div><span className="text-gray-500">Trigger:</span> <span className="text-gray-900 font-medium">{activeSubmission.trigger ? toLabel(activeSubmission.trigger) : 'Legacy submission'}</span></div>
            </div>
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-left">
                    <th className="px-4 py-3 font-medium">Field</th>
                    <th className="px-4 py-3 font-medium">Response</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeSubmissionResponses.map((response) => {
                    const field = formFields.find((candidate) => candidate.id === response.fieldId);
                    const fieldLabel = field?.label ?? response.fieldId;
                    const displayValue = field?.type === 'employee_selector'
                      ? employees.find((employee) => employee.id === response.value)?.name ?? response.value
                      : field?.type === 'job_selector'
                        ? jobs.find((job) => job.id === response.value)?.title ?? response.value
                        : field?.type === 'customer_selector'
                          ? customers.find((customer) => customer.id === response.value)?.name ?? response.value
                          : response.value;
                    return (
                      <tr key={response.id}>
                        <td className="px-4 py-3 text-gray-700">{fieldLabel}</td>
                        <td className="px-4 py-3 text-gray-900">{displayValue || response.fileIds?.join(', ') || '—'}</td>
                      </tr>
                    );
                  })}
                  {activeSubmissionResponses.length === 0 && (
                    <tr>
                      <td className="px-4 py-3 text-gray-500" colSpan={2}>No responses were saved for this submission.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
}
