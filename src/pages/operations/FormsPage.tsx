import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Eye,
  FilePlus2,
  GripVertical,
  Info,
  Pencil,
  Plus,
  Save,
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
import SignaturePad from '../../components/forms/SignaturePad';
import { resolveAttachmentUrl } from '../../utils/fileUpload';
import {
  applyFormDeliveryRule,
  createDefaultDeliveryRule,
  createFormBuilderDraft,
  describeFormConfiguration,
  getFormConfigurationWarnings,
  getLegacyConfigurationLabels,
  isFormBuilderDirty,
  moveFormField,
} from './formsBuilderModel.js';
import { validateFormDeliveryRule } from '../../utils/formDeliveryRules.js';
import { FORM_TEMPLATES, type FormTemplate } from '../../../shared/formTemplates.js';
import type {
  FormAssignmentType,
  FormCategory,
  FormDeliveryRule,
  FormDeliveryType,
  FormField,
  FormFieldType,
  FormRecord,
  FormSchedule,
  FormStatus,
  FormSubmissionStatus,
} from '../../types';

type FormBuilderDraft = ReturnType<typeof createFormBuilderDraft>;

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

const DELIVERY_OPTIONS: Array<{ value: FormDeliveryType; label: string; description: string }> = [
  { value: 'before_clock_in', label: 'Before clock-in', description: 'Prompt employees as they start work.' },
  { value: 'after_clock_out', label: 'After clock-out', description: 'Prompt employees as they finish work.' },
  { value: 'scheduled', label: 'On a schedule', description: 'Make the form due on a recurring cadence.' },
  { value: 'always_available', label: 'Always available', description: 'Employees open the form from Forms when needed.' },
];

const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
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

type FormsTab = 'overview' | 'forms' | 'builder' | 'submissions' | 'templates';

const FIELD_TYPES_WITH_OPTIONS = new Set<FormFieldType>(['multiple_choice', 'dropdown', 'checkbox']);
const FIELD_TYPES_WITH_ACCEPTED_RESPONSE = new Set<FormFieldType>(['yes_no', 'multiple_choice', 'dropdown', 'checkbox']);

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
    cloneForm,
    createFormFromTemplate,
    updateForm,
    deleteForm,
    addFormField,
    updateFormField,
    deleteFormField,
    updateFormSubmission,
  } = useStore();

  const [activeTab, setActiveTab] = useState<FormsTab>('overview');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FormCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FormStatus>('all');
  const [newFormModalOpen, setNewFormModalOpen] = useState(false);
  const [newFormDraft, setNewFormDraft] = useState(emptyFormDraft());
  const [newFormError, setNewFormError] = useState('');
  const [selectedFormId, setSelectedFormId] = useState('');
  const [builderDraft, setBuilderDraft] = useState<FormBuilderDraft | null>(null);
  const [builderBaseline, setBuilderBaseline] = useState<FormBuilderDraft | null>(null);
  const [builderSaveError, setBuilderSaveError] = useState('');
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [savingBuilder, setSavingBuilder] = useState(false);
  const [cloningFormId, setCloningFormId] = useState<string | null>(null);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const templateCreationInFlight = useRef(false);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState<'all' | FormSubmissionStatus>('all');
  const [viewSubmissionId, setViewSubmissionId] = useState<string | null>(null);
  const [submissionFileUrls, setSubmissionFileUrls] = useState<Record<string, string>>({});
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitResponses, setSubmitResponses] = useState<Record<string, string>>({});
  const [, setSubmitSignatures] = useState<Record<string, Blob | null>>({});

  const sortedForms = useMemo(() => {
    return forms.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [forms]);

  const archivedSubmissionForms = useMemo(() => {
    const currentFormIds = new Set(forms.map((form) => form.id));
    return [...new Set(formSubmissions.map((submission) => submission.formId))]
      .filter((formId) => !currentFormIds.has(formId))
      .map((formId) => ({ id: formId, name: `Archived form (${formId.slice(0, 8)})` }));
  }, [formSubmissions, forms]);

  const submissionFormOptions = useMemo(() => [
    ...sortedForms.map((form) => ({ id: form.id, name: form.name })),
    ...archivedSubmissionForms,
  ], [archivedSubmissionForms, sortedForms]);

  useEffect(() => {
    const selectableForms = activeTab === 'submissions' ? submissionFormOptions : sortedForms;
    if (selectableForms.length === 0) {
      setSelectedFormId('');
      return;
    }
    if (!selectedFormId || !selectableForms.some((form) => form.id === selectedFormId)) {
      setSelectedFormId(selectableForms[0].id);
    }
  }, [activeTab, selectedFormId, sortedForms, submissionFormOptions]);

  const selectedForm = selectedFormId ? (forms.find((form) => form.id === selectedFormId) ?? null) : null;

  const isBuilderDirty = isFormBuilderDirty(builderBaseline, builderDraft);

  useEffect(() => {
    if (!selectedForm || activeTab !== 'builder' || builderDraft?.form.id === selectedForm.id) return;
    const fields = formFields.filter((field) => field.formId === selectedForm.id);
    const next = createFormBuilderDraft(selectedForm, fields);
    setBuilderDraft(next);
    setBuilderBaseline(next);
    setBuilderSaveError('');
    setEditingFieldId(null);
    setLastSavedAt(selectedForm.updatedAt);
  }, [activeTab, builderDraft?.form.id, formFields, selectedForm]);

  useEffect(() => {
    if (!isBuilderDirty) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isBuilderDirty]);

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

    const deliveryRule = createDefaultDeliveryRule();
    const created = addForm({
      name: newFormDraft.name.trim(),
      description: newFormDraft.description.trim(),
      category: newFormDraft.category,
      status: 'draft',
      assignedTo: 'everyone',
      assignmentValue: '',
      trigger: ['on_demand'],
      deliveryRule,
      deliveryRuleVersion: 1,
      completionRequirement: 'reminder',
      requiresApproval: false,
      division: '',
    });

    setSelectedFormId(created.id);
    setActiveTab('builder');
    setNewFormModalOpen(false);
  };

  const handleCloneForm = async (formId: string) => {
    if (cloningFormId) return;
    setCloningFormId(formId);
    const cloned = await cloneForm(formId);
    setCloningFormId(null);
    if (!cloned) return;
    setSelectedFormId(cloned.id);
    setActiveTab('builder');
  };

  const updateBuilderForm = (patch: Partial<FormRecord>) => {
    setBuilderSaveError('');
    setBuilderDraft((current) => current ? { ...current, form: { ...current.form, ...patch } } : current);
  };

  const updateDeliveryRule = (deliveryRule: FormDeliveryRule) => {
    setBuilderSaveError('');
    setBuilderDraft((current) => current ? { ...current, form: applyFormDeliveryRule(current.form, deliveryRule) } : current);
  };

  const addFieldToDraft = (fieldType: FormFieldType) => {
    if (!builderDraft) return;
    const field: FormField = {
      id: crypto.randomUUID(),
      formId: builderDraft.form.id,
      type: fieldType,
      label: FIELD_TYPES.find((item) => item.value === fieldType)?.label ?? 'New Field',
      helpText: '',
      required: false,
      defaultValue: '',
      placeholder: '',
      options: FIELD_TYPES_WITH_OPTIONS.has(fieldType) ? ['Option 1', 'Option 2'] : [],
      acceptedResponse: undefined,
      order: builderDraft.fields.length,
    };
    setBuilderDraft({ ...builderDraft, fields: [...builderDraft.fields, field] });
    setEditingFieldId(field.id);
    setFieldPickerOpen(false);
  };

  const updateDraftField = (fieldId: string, patch: Partial<FormField>) => {
    setBuilderDraft((current) => current ? {
      ...current,
      fields: current.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field),
    } : current);
  };

  const updateFieldOption = (fieldId: string, optionIndex: number, value: string) => {
    const field = builderDraft?.fields.find((item) => item.id === fieldId);
    if (!field) return;
    const options = [...(field.options ?? [])];
    options[optionIndex] = value;
    updateDraftField(fieldId, { options });
  };

  const addFieldOption = (fieldId: string) => {
    const field = builderDraft?.fields.find((item) => item.id === fieldId);
    if (!field) return;
    updateDraftField(fieldId, { options: [...(field.options ?? []), `Option ${(field.options?.length ?? 0) + 1}`] });
  };

  const moveFieldOption = (fieldId: string, optionIndex: number, direction: -1 | 1) => {
    const field = builderDraft?.fields.find((item) => item.id === fieldId);
    if (!field) return;
    const options = [...(field.options ?? [])];
    const targetIndex = optionIndex + direction;
    if (targetIndex < 0 || targetIndex >= options.length) return;
    [options[optionIndex], options[targetIndex]] = [options[targetIndex], options[optionIndex]];
    updateDraftField(fieldId, { options });
  };

  const removeFieldOption = (fieldId: string, optionIndex: number) => {
    const field = builderDraft?.fields.find((item) => item.id === fieldId);
    if (!field) return;
    updateDraftField(fieldId, { options: (field.options ?? []).filter((_, index) => index !== optionIndex) });
  };

  const handleFieldDrop = (targetFieldId: string) => {
    if (!draggingFieldId || draggingFieldId === targetFieldId) {
      setDraggingFieldId(null);
      return;
    }

    setBuilderDraft((current) => current ? { ...current, fields: moveFormField(current.fields, draggingFieldId, targetFieldId) } : current);
    setDraggingFieldId(null);
  };

  const duplicateField = (field: FormField) => {
    if (!builderDraft) return;
    const duplicate: FormField = {
      ...field,
      id: crypto.randomUUID(),
      label: `${field.label} (Copy)`,
      options: [...(field.options ?? [])],
      order: builderDraft.fields.length,
    };
    setBuilderDraft({ ...builderDraft, fields: [...builderDraft.fields, duplicate] });
    setEditingFieldId(duplicate.id);
  };

  const removeDraftField = (fieldId: string) => {
    setBuilderDraft((current) => current ? {
      ...current,
      fields: current.fields.filter((field) => field.id !== fieldId).map((field, order) => ({ ...field, order })),
    } : current);
    if (editingFieldId === fieldId) setEditingFieldId(null);
  };

  const saveBuilderChanges = async () => {
    if (!builderDraft || !builderBaseline || !isBuilderDirty || savingBuilder) return;
    if (!builderDraft.form.deliveryRule) {
      setBuilderSaveError('Choose one delivery rule before saving this form.');
      return;
    }
    const deliveryError = validateFormDeliveryRule(builderDraft.form.deliveryRule);
    if (deliveryError) {
      setBuilderSaveError(deliveryError);
      return;
    }
    setSavingBuilder(true);
    setBuilderSaveError('');
    const canonicalForm = applyFormDeliveryRule(builderDraft.form, builderDraft.form.deliveryRule);
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...formPatch } = canonicalForm;
    const writes: Array<Promise<unknown>> = [updateForm(builderDraft.form.id, formPatch)];

    const baselineById = new Map(builderBaseline.fields.map((field) => [field.id, field]));
    const draftIds = new Set(builderDraft.fields.map((field) => field.id));
    for (const field of builderBaseline.fields) {
      if (!draftIds.has(field.id)) writes.push(deleteFormField(field.id));
    }
    for (const field of builderDraft.fields) {
      const normalized = { ...field, order: builderDraft.fields.indexOf(field) };
      if (!baselineById.has(field.id)) {
        writes.push(addFormField(normalized));
      } else if (JSON.stringify(baselineById.get(field.id)) !== JSON.stringify(normalized)) {
        const { id: _fieldId, ...fieldPatch } = normalized;
        writes.push(updateFormField(field.id, fieldPatch));
      }
    }
    let results: unknown[];
    try {
      results = await Promise.all(writes);
    } catch {
      setSavingBuilder(false);
      setBuilderSaveError('OliveOps could not save this form. Your changes are still here.');
      return;
    }
    setSavingBuilder(false);
    if (results.some((result) => result === false || result === null)) {
      setBuilderSaveError('OliveOps could not save this form. Your changes are still here.');
      return;
    }
    const savedAt = new Date().toISOString();
    const savedDraft = createFormBuilderDraft({ ...canonicalForm, updatedAt: savedAt }, builderDraft.fields);
    setBuilderDraft(savedDraft);
    setBuilderBaseline(savedDraft);
    setLastSavedAt(savedAt);
  };

  const canLeaveBuilder = () => !isBuilderDirty || window.confirm('You have unsaved changes. Leave without saving?');

  const navigateToTab = (tab: FormsTab) => {
    if (activeTab === 'builder' && tab !== 'builder' && !canLeaveBuilder()) return;
    setActiveTab(tab);
  };

  const deleteSelectedForm = async () => {
    if (!selectedForm) return;

    if (submissionsForSelectedForm.length > 0) {
      await updateForm(selectedForm.id, { status: 'archived' });
      return;
    }

    for (const field of fieldsForSelectedForm) {
      await deleteFormField(field.id);
    }

    deleteForm(selectedForm.id);
  };

  const handleUseTemplate = async (template: FormTemplate) => {
    if (templateCreationInFlight.current) return;
    templateCreationInFlight.current = true;
    setCreatingTemplateId(template.id);
    const created = await createFormFromTemplate(template.id);
    templateCreationInFlight.current = false;
    setCreatingTemplateId(null);
    if (!created) return;
    setSelectedFormId(created.id);
    setActiveTab('builder');
  };

  const openSubmissionScreen = () => {
    if (!selectedForm) return;
    const previewFields = activeTab === 'builder' ? builderDraft?.fields ?? [] : fieldsForSelectedForm;
    const today = new Date().toISOString().slice(0, 10);
    setSubmitResponses(Object.fromEntries(previewFields.map((field) => [
      field.id,
      field.type === 'date' && field.defaultValue?.toLowerCase() === 'today' ? today : field.defaultValue ?? '',
    ])));
    setSubmitSignatures({});
    setSubmitModalOpen(true);
  };

  const activeSubmission = viewSubmissionId
    ? (formSubmissions.find((submission) => submission.id === viewSubmissionId) ?? null)
    : null;

  const activeSubmissionResponses = useMemo(() => {
    if (!activeSubmission) return [];
    return formResponses.filter((response) => response.submissionId === activeSubmission.id);
  }, [activeSubmission, formResponses]);

  useEffect(() => {
    let cancelled = false;
    const fileIds = [...new Set(activeSubmissionResponses.flatMap((response) => response.fileIds ?? []))];
    if (fileIds.length === 0) {
      setSubmissionFileUrls({});
      return undefined;
    }
    void Promise.all(fileIds.map(async (fileId) => [fileId, await resolveAttachmentUrl({ fileId })] as const))
      .then((entries) => {
        if (!cancelled) setSubmissionFileUrls(Object.fromEntries(entries));
      });
    return () => { cancelled = true; };
  }, [activeSubmissionResponses]);

  const builderForm = builderDraft?.form ?? null;
  const builderFields = builderDraft?.fields ?? [];
  const editingField = editingFieldId ? builderFields.find((field) => field.id === editingFieldId) ?? null : null;
  const deliveryRule = builderForm?.deliveryRule ?? null;
  const legacyConfigurationLabels = builderForm && !deliveryRule ? getLegacyConfigurationLabels(builderForm) : [];

  const assignmentLabel = builderForm ? (() => {
    const value = builderForm.assignmentValue;
    if (!value) return '';
    if (builderForm.assignedTo === 'role') return value === 'crew_member' ? 'Crew Member role' : `${toLabel(value)} role`;
    if (builderForm.assignedTo === 'employee') return employees.find((employee) => employee.id === value)?.name ?? value;
    if (builderForm.assignedTo === 'job') return jobs.find((job) => job.id === value)?.title ?? value;
    if (builderForm.assignedTo === 'equipment') return equipmentAssets.find((equipment) => equipment.id === value)?.name ?? value;
    if (builderForm.assignedTo === 'division') return divisions.find((division) => division.id === value)?.name ?? value;
    return value;
  })() : '';

  const configurationWarnings = builderForm ? getFormConfigurationWarnings(builderForm) : [];
  const configurationSummary = builderForm ? describeFormConfiguration(builderForm, { assignmentLabel }) : '';

  const assignmentValueControl = builderForm ? (() => {
    if (builderForm.assignedTo === 'role') {
      return (
        <Select
          label="Role"
          value={builderForm.assignmentValue ?? ''}
          onChange={(event) => updateBuilderForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select role</option>
          <option value="admin">Admin</option>
          <option value="foreman">Foreman</option>
          <option value="crew_member">Crew Member</option>
        </Select>
      );
    }

    if (builderForm.assignedTo === 'employee') {
      return (
        <Select
          label="Employee"
          value={builderForm.assignmentValue ?? ''}
          onChange={(event) => updateBuilderForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select employee</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name}</option>
          ))}
        </Select>
      );
    }

    if (builderForm.assignedTo === 'job') {
      return (
        <Select
          label="Job"
          value={builderForm.assignmentValue ?? ''}
          onChange={(event) => updateBuilderForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>{job.title}</option>
          ))}
        </Select>
      );
    }

    if (builderForm.assignedTo === 'equipment') {
      return (
        <Select
          label="Equipment"
          value={builderForm.assignmentValue ?? ''}
          onChange={(event) => updateBuilderForm({ assignmentValue: event.target.value })}
        >
          <option value="">Select equipment</option>
          {equipmentAssets.map((equipment) => (
            <option key={equipment.id} value={equipment.id}>{equipment.name}</option>
          ))}
        </Select>
      );
    }

    if (builderForm.assignedTo === 'division') {
      return (
        <Select
          label="Division"
          value={builderForm.assignmentValue ?? ''}
          onChange={(event) => updateBuilderForm({ assignmentValue: event.target.value })}
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
      {activeTab !== 'builder' && <>
        <PageHeader
          title="Forms"
          subtitle="Create, manage, assign, and review contractor-friendly digital forms for field operations."
          action={<Button onClick={openNewForm}><Plus size={16} /> New Form</Button>}
        />

        <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'forms', label: 'Forms' },
          { key: 'submissions', label: 'Submissions' },
          { key: 'templates', label: 'Templates' },
        ] as Array<{ key: FormsTab; label: string }>).map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`rounded px-3 py-1 text-sm ${activeTab === tab.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            onClick={() => navigateToTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        </div>
      </>}

      {activeTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-sm text-gray-500">Active forms</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">{forms.filter((form) => form.status === 'active').length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-gray-500">Drafts</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">{forms.filter((form) => form.status === 'draft').length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-gray-500">Submissions</p>
              <p className="mt-1 text-2xl font-semibold text-gray-950">{formSubmissions.length}</p>
            </Card>
          </div>
          <div className="border-t border-gray-200 pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Recently updated</h2>
                <p className="mt-0.5 text-sm text-gray-500">Continue building the forms your team is working on.</p>
              </div>
              <Button variant="secondary" onClick={() => navigateToTab('forms')}>View all forms</Button>
            </div>
            {sortedForms.length === 0 ? (
              <EmptyState title="No forms yet" description="Create the first form for your field team." action={<Button onClick={openNewForm}><Plus size={16} /> New Form</Button>} />
            ) : (
              <div className="divide-y divide-gray-200 border-y border-gray-200">
                {sortedForms.slice(0, 5).map((form) => (
                  <div key={form.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{form.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{toLabel(form.category)} • {toLabel(form.status)} • Updated {new Date(form.updatedAt).toLocaleDateString()}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => { setSelectedFormId(form.id); navigateToTab('builder'); }}>Open</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'forms' && (
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
                        navigateToTab('builder');
                      }}
                    >
                      Open Builder
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setSelectedFormId(form.id);
                        navigateToTab('submissions');
                      }}
                    >
                      View Submissions
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={Boolean(cloningFormId)}
                      onClick={() => void handleCloneForm(form.id)}
                    >
                      <Copy size={14} /> {cloningFormId === form.id ? 'Cloning...' : 'Clone Form'}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'builder' && (
        builderForm ? (
          <div className="space-y-5">
            <div className="sticky top-0 z-10 -mx-2 border-b border-gray-200 bg-gray-50/95 px-2 py-3 backdrop-blur">
              <button type="button" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900" onClick={() => navigateToTab('forms')}>
                <ArrowLeft size={15} /> Back to Forms
              </button>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold text-gray-950">{builderForm.name || 'Untitled Form'}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                    <span>{toLabel(builderForm.category)}</span><span>•</span><span>{toLabel(builderForm.status)}</span><span>•</span>
                    <span className={isBuilderDirty ? 'font-medium text-amber-700' : 'inline-flex items-center gap-1 text-brand-700'}>
                      {!isBuilderDirty && <Check size={14} />}
                      {isBuilderDirty ? 'Unsaved changes' : lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved'}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" onClick={openSubmissionScreen}><Eye size={16} /> Preview</Button>
                  <Button onClick={() => void saveBuilderChanges()} disabled={!isBuilderDirty || savingBuilder}><Save size={16} /> {savingBuilder ? 'Saving...' : 'Save Changes'}</Button>
                </div>
              </div>
            </div>
            <Card className="p-5 sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase text-brand-600">Form Setup</p>
                <h2 className="mt-1 text-lg font-semibold text-gray-950">Configure how this form reaches employees</h2>
              </div>

              <section className="mt-6 border-t border-gray-200 pt-5">
                <h3 className="text-sm font-semibold text-gray-900">Form Details</h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <Input label="Form Name" value={builderForm.name} onChange={(event) => updateBuilderForm({ name: event.target.value })} />
                  <Select label="Category" value={builderForm.category} onChange={(event) => updateBuilderForm({ category: event.target.value as FormCategory })}>
                    {FORM_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                  </Select>
                  <Select label="Status" value={builderForm.status} onChange={(event) => updateBuilderForm({ status: event.target.value as FormStatus })}>
                    {FORM_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </Select>
                  <div className="md:col-span-2 lg:col-span-3"><TextArea label="Description" value={builderForm.description} onChange={(event) => updateBuilderForm({ description: event.target.value })} /></div>
                </div>
              </section>

              <section className="mt-6 border-t border-gray-200 pt-5">
                <h3 className="text-sm font-semibold text-gray-900">Who Should Complete This Form?</h3>
                <p className="mt-1 text-xs text-gray-500">The server verifies assignment and business ownership before showing or accepting this form.</p>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <Select label="Who should complete this?" value={builderForm.assignedTo} onChange={(event) => updateBuilderForm({ assignedTo: event.target.value as FormAssignmentType, assignmentValue: '' })}>
                    {ASSIGNMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                  {assignmentValueControl}
                </div>
              </section>

              <section className="mt-6 border-t border-gray-200 pt-5">
                <h3 className="text-sm font-semibold text-gray-900">When should employees complete this form?</h3>
                {!deliveryRule && (
                  <div className="mt-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-3 text-sm text-amber-950" role="status">
                    <p className="font-semibold">Configuration needs review</p>
                    <p className="mt-1 text-xs leading-5">This historical form used {legacyConfigurationLabels.length ? legacyConfigurationLabels.join(', ') : 'an unsupported configuration'}. OliveOps now supports one delivery rule per form. Choose one option below before saving; the historical settings remain unchanged until then.</p>
                  </div>
                )}
                <fieldset className="mt-4">
                  <legend className="sr-only">When should employees complete this form?</legend>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {DELIVERY_OPTIONS.map((option) => (
                      <label key={option.value} className={`cursor-pointer border px-3 py-3 ${deliveryRule?.type === option.value ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input className="sr-only" type="radio" name="delivery-rule" checked={deliveryRule?.type === option.value} onChange={() => updateDeliveryRule(createDefaultDeliveryRule(option.value))} />
                        <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-gray-500">{option.description}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {deliveryRule && (deliveryRule.type === 'before_clock_in' || deliveryRule.type === 'after_clock_out') && (
                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <fieldset>
                      <legend className="text-sm font-medium text-gray-900">Frequency</legend>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {([
                          { value: 'once_daily', label: 'Once per day', helper: 'One completed occurrence covers that business day.' },
                          { value: 'every_occurrence', label: 'Every time', helper: `Create a new occurrence at each ${deliveryRule.type === 'before_clock_in' ? 'clock-in' : 'clock-out'}.` },
                        ] as const).map((frequency) => (
                          <label key={frequency.value} className={`cursor-pointer border px-3 py-3 ${deliveryRule.frequency === frequency.value ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
                            <input className="sr-only" type="radio" name="delivery-frequency" checked={deliveryRule.frequency === frequency.value} onChange={() => updateDeliveryRule({ ...deliveryRule, frequency: frequency.value })} />
                            <span className="block text-sm font-semibold text-gray-900">{frequency.label}</span><span className="mt-1 block text-xs leading-5 text-gray-500">{frequency.helper}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="text-sm font-medium text-gray-900">Completion</legend>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className={`cursor-pointer border px-3 py-3 ${deliveryRule.completionBehavior === 'reminder' ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
                          <input className="sr-only" type="radio" name="completion-behavior" checked={deliveryRule.completionBehavior === 'reminder'} onChange={() => updateDeliveryRule({ ...deliveryRule, completionBehavior: 'reminder' })} />
                          <span className="block text-sm font-semibold text-gray-900">Remind, but allow them to continue</span><span className="mt-1 block text-xs leading-5 text-gray-500">Employees can complete it later.</span>
                        </label>
                        <label className={`cursor-pointer border px-3 py-3 ${deliveryRule.completionBehavior === 'blocking' ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}>
                          <input className="sr-only" type="radio" name="completion-behavior" checked={deliveryRule.completionBehavior === 'blocking'} onChange={() => updateDeliveryRule({ ...deliveryRule, completionBehavior: 'blocking' })} />
                          <span className="block text-sm font-semibold text-gray-900">Block {deliveryRule.type === 'before_clock_in' ? 'clock-in' : 'clock-out'} until submitted</span><span className="mt-1 block text-xs leading-5 text-gray-500">The employee must submit this occurrence to continue.</span>
                        </label>
                      </div>
                    </fieldset>
                  </div>
                )}

                {deliveryRule?.type === 'scheduled' && deliveryRule.schedule && (
                  <div className="mt-5 max-w-3xl space-y-4">
                    <Select label="Schedule" value={deliveryRule.schedule.cadence} onChange={(event) => {
                      const cadence = event.target.value as FormSchedule['cadence'];
                      const schedule: FormSchedule = cadence === 'weekly' ? { cadence, weekdays: [1] }
                        : cadence === 'monthly' ? { cadence, dayOfMonth: 1 }
                          : cadence === 'custom' ? { cadence, interval: { count: 1, unit: 'weeks' } }
                            : { cadence };
                      updateDeliveryRule({ ...deliveryRule, schedule });
                    }}>
                      <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom interval</option>
                    </Select>
                    {deliveryRule.schedule.cadence === 'weekly' && (
                      <fieldset><legend className="text-sm font-medium text-gray-700">Weekdays <span className="text-accent-700">*</span></legend><div className="mt-2 flex flex-wrap gap-2">{WEEKDAYS.map((day) => {
                        const weekdays = deliveryRule.schedule?.weekdays ?? [];
                        const checked = weekdays.includes(day.value);
                        return <label key={day.value} className={`cursor-pointer border px-3 py-2 text-sm font-medium ${checked ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-700'}`}><input className="sr-only" type="checkbox" checked={checked} onChange={() => updateDeliveryRule({ ...deliveryRule, schedule: { cadence: 'weekly', weekdays: checked ? weekdays.filter((value) => value !== day.value) : [...weekdays, day.value] } })} />{day.label}</label>;
                      })}</div></fieldset>
                    )}
                    {deliveryRule.schedule.cadence === 'monthly' && <div><Input label="Day of month" required type="number" min={1} max={31} step={1} value={deliveryRule.schedule.dayOfMonth ?? 1} onChange={(event) => updateDeliveryRule({ ...deliveryRule, schedule: { cadence: 'monthly', dayOfMonth: Number(event.target.value) } })} /><p className="mt-1 text-xs text-gray-500">If a month has fewer days, the form is due on the last day of that month.</p></div>}
                    {deliveryRule.schedule.cadence === 'custom' && <div className="grid gap-3 sm:grid-cols-2"><Input label="Every" required type="number" min={1} max={365} step={1} value={deliveryRule.schedule.interval?.count ?? 1} onChange={(event) => updateDeliveryRule({ ...deliveryRule, schedule: { cadence: 'custom', interval: { count: Number(event.target.value), unit: deliveryRule.schedule?.interval?.unit ?? 'weeks' } } })} /><Select label="Interval unit" value={deliveryRule.schedule.interval?.unit ?? 'weeks'} onChange={(event) => updateDeliveryRule({ ...deliveryRule, schedule: { cadence: 'custom', interval: { count: deliveryRule.schedule?.interval?.count ?? 1, unit: event.target.value as 'days' | 'weeks' | 'months' } } })}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></Select></div>}
                    <p className="text-xs text-gray-500">Scheduled forms become due on this cadence. They do not block clock-in or clock-out.</p>
                  </div>
                )}

                {deliveryRule && deliveryRule.type !== 'always_available' && (
                  <label className="mt-5 flex cursor-pointer gap-3 border border-gray-200 px-3 py-3">
                    <input type="checkbox" className="mt-0.5" checked={deliveryRule.allowManualAccess} onChange={(event) => updateDeliveryRule({ ...deliveryRule, allowManualAccess: event.target.checked })} />
                    <span><span className="block text-sm font-semibold text-gray-900">Also allow employees to open this form anytime</span><span className="mt-1 block text-xs leading-5 text-gray-500">A generic manual submission does not satisfy a future or pending occurrence unless the employee opens the form from that occurrence.</span></span>
                  </label>
                )}

                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-900">Submission Review</h4>
                  <label className="mt-3 flex cursor-pointer gap-3 border border-gray-200 px-3 py-3">
                    <input type="checkbox" className="mt-0.5" checked={builderForm.requiresApproval ?? false} onChange={(event) => updateBuilderForm({ requiresApproval: event.target.checked })} />
                    <span><span className="block text-sm font-semibold text-gray-900">Require approval after submission</span><span className="mt-1 block text-xs leading-5 text-gray-500">New submissions wait for an administrator to approve or reject them.</span></span>
                  </label>
                </div>
              </section>

              <section className="mt-6 border-t border-gray-200 pt-5">
                <h3 className="text-sm font-semibold uppercase text-gray-500">How This Form Works</h3>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-gray-700">{configurationSummary}</p>
                {configurationWarnings.length > 0 && <div className="mt-4 space-y-2">{configurationWarnings.map((warning) => <div key={warning} className="flex gap-2 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"><Info size={15} className="mt-0.5 shrink-0" /><span>{warning}</span></div>)}</div>}
                {builderSaveError && <p className="mt-3 text-sm font-medium text-accent-700" role="alert">{builderSaveError}</p>}
              </section>
            </Card>

            <section>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="text-xs font-semibold uppercase text-brand-600">Form Fields</p><h2 className="mt-1 text-lg font-semibold text-gray-950">Fields</h2><p className="mt-1 text-sm text-gray-500">Drag fields to set the order employees will see.</p></div>
                <Button onClick={() => setFieldPickerOpen(true)}><Plus size={16} /> Add Field</Button>
              </div>

              {builderFields.length === 0 ? (
                <Card className="mt-4"><EmptyState title="No fields yet" description="Add your first field to start building this form." action={<Button onClick={() => setFieldPickerOpen(true)}><Plus size={16} /> Add Field</Button>} /></Card>
              ) : (
                <div className="mt-4 space-y-2">
                  {builderFields.map((field) => (
                    <Card key={field.id} className="overflow-hidden">
                      <div draggable onDragStart={() => setDraggingFieldId(field.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => handleFieldDrop(field.id)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap">
                        <div className="flex min-w-[180px] flex-1 items-center gap-3 text-gray-700"><GripVertical size={18} className="shrink-0 cursor-grab text-gray-400" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-900">{field.label || 'Untitled field'}</p><p className="mt-0.5 text-xs text-gray-500">{toLabel(field.type)}{field.required ? ' • Required' : ''}</p></div></div>
                        <div className="flex w-full shrink-0 justify-end gap-1 sm:w-auto"><Button variant="ghost" size="sm" onClick={() => setEditingFieldId(field.id)}><Pencil size={13} /> Edit</Button><Button variant="ghost" size="sm" onClick={() => duplicateField(field)}><Copy size={13} /> Duplicate</Button><Button variant="ghost" size="sm" onClick={() => removeDraftField(field.id)}><Trash2 size={13} className="text-accent-700" /> Delete</Button></div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <div className="flex justify-end"><Button variant={submissionsForSelectedForm.length > 0 ? 'secondary' : 'danger'} size="sm" onClick={() => void deleteSelectedForm()}><Trash2 size={14} /> {submissionsForSelectedForm.length > 0 ? 'Archive Form' : 'Delete Form'}</Button></div>
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
        selectedFormId ? (
          <div className="space-y-6">
            <Card className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Select
                  label="Form"
                  value={selectedFormId}
                  onChange={(event) => setSelectedFormId(event.target.value)}
                >
                  {submissionFormOptions.map((form) => (
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
                  <option value="pending_review">Pending Review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </Select>
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
                        <th className="px-4 py-3 font-medium">Division</th>
                        <th className="px-4 py-3 font-medium">Equipment</th>
                        <th className="px-4 py-3 font-medium">Submitted By</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredSubmissions.map((submission) => {
                        const employeeName = employees.find((employee) => employee.id === submission.employeeId)?.name ?? 'Unknown';
                        const jobTitle = jobs.find((job) => job.id === submission.jobId)?.title ?? '—';
                        const divisionName = divisions.find((division) => division.id === submission.divisionId)?.name ?? '—';
                        const equipmentName = equipmentAssets.find((equipment) => equipment.id === submission.equipmentId)?.name ?? '—';
                        const submitted = new Date(submission.submittedAt);
                        return (
                          <tr key={submission.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900 font-medium">{employeeName}</td>
                            <td className="px-4 py-3 text-gray-700">{submitted.toLocaleDateString()}</td>
                            <td className="px-4 py-3 text-gray-700">{submitted.toLocaleTimeString()}</td>
                            <td className="px-4 py-3 text-gray-700 capitalize">{submission.status}</td>
                            <td className="px-4 py-3 text-gray-700">{jobTitle}</td>
                            <td className="px-4 py-3 text-gray-700">{divisionName}</td>
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
            <Card key={template.id} className="p-4">
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
                <Button size="sm" disabled={creatingTemplateId !== null} onClick={() => void handleUseTemplate(template)}>
                  <Plus size={14} /> {creatingTemplateId === template.id ? 'Creating...' : 'Add Template'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={fieldPickerOpen} onClose={() => setFieldPickerOpen(false)} title="Add Field">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FIELD_TYPES.map((fieldType) => (
            <button
              key={fieldType.value}
              type="button"
              className="rounded border border-gray-200 px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:border-brand-400 hover:bg-brand-50"
              onClick={() => addFieldToDraft(fieldType.value)}
            >
              {fieldType.label}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={editingField !== null}
        onClose={() => setEditingFieldId(null)}
        title={editingField ? `Edit Field - ${editingField.label || 'Untitled Field'}` : 'Edit Field'}
        size="wide"
        footer={<Button onClick={() => setEditingFieldId(null)}>Done</Button>}
      >
        {editingField && (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Select label="Field Type" value={editingField.type} disabled>
                {FIELD_TYPES.map((fieldType) => <option key={fieldType.value} value={fieldType.value}>{fieldType.label}</option>)}
              </Select>
              <Input label="Label" value={editingField.label} onChange={(event) => updateDraftField(editingField.id, { label: event.target.value })} />
              <Input label="Placeholder" value={editingField.placeholder ?? ''} onChange={(event) => updateDraftField(editingField.id, { placeholder: event.target.value })} />
              <div>
                <Input label="Default Value" value={editingField.defaultValue ?? ''} onChange={(event) => updateDraftField(editingField.id, { defaultValue: event.target.value })} />
                {editingField.type === 'date' && <p className="mt-1 text-xs text-gray-500">Use “today” to prefill the employee's current date. Employees can still choose another date.</p>}
              </div>
              <div className="md:col-span-2"><TextArea label="Help Text" value={editingField.helpText ?? ''} onChange={(event) => updateDraftField(editingField.id, { helpText: event.target.value })} /></div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" checked={editingField.required} onChange={(event) => updateDraftField(editingField.id, { required: event.target.checked })} /> Required field</label>

            {FIELD_TYPES_WITH_ACCEPTED_RESPONSE.has(editingField.type) && (
              <section className="border-t border-gray-200 pt-5">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" checked={Boolean(editingField.acceptedResponse)} onChange={(event) => updateDraftField(editingField.id, { acceptedResponse: event.target.checked ? { value: editingField.type === 'yes_no' ? 'yes' : editingField.options?.[0] ?? '', message: '' } : undefined })} /> Require a specific answer</label>
                {editingField.acceptedResponse ? <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <Select label="Accepted answer" value={editingField.acceptedResponse.value} onChange={(event) => updateDraftField(editingField.id, { acceptedResponse: { ...editingField.acceptedResponse!, value: event.target.value } })}>
                    {(editingField.type === 'yes_no' ? ['yes', 'no'] : editingField.options ?? []).map((option) => <option key={option} value={option}>{toLabel(option)}</option>)}
                  </Select>
                  <Input label="Message when answer is not accepted" value={editingField.acceptedResponse.message ?? ''} placeholder="Choose the required answer to continue." onChange={(event) => updateDraftField(editingField.id, { acceptedResponse: { ...editingField.acceptedResponse!, message: event.target.value } })} />
                </div> : null}
              </section>
            )}

            {FIELD_TYPES_WITH_OPTIONS.has(editingField.type) && (
              <section className="border-t border-gray-200 pt-5">
                <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-gray-900">Options</h3><p className="mt-1 text-xs text-gray-500">Add and arrange the choices employees can select.</p></div><Button type="button" variant="secondary" size="sm" onClick={() => addFieldOption(editingField.id)}><Plus size={14} /> Add Option</Button></div>
                <div className="mt-3 space-y-2">
                  {(editingField.options ?? []).map((option, optionIndex) => (
                    <div key={optionIndex} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                      <span className="text-xs font-medium text-gray-400">{optionIndex + 1}</span>
                      <Input aria-label={`Option ${optionIndex + 1}`} value={option} onChange={(event) => updateFieldOption(editingField.id, optionIndex, event.target.value)} />
                      <div className="flex"><Button type="button" variant="ghost" size="sm" disabled={optionIndex === 0} onClick={() => moveFieldOption(editingField.id, optionIndex, -1)} aria-label={`Move option ${optionIndex + 1} up`}><ArrowUp size={14} /></Button><Button type="button" variant="ghost" size="sm" disabled={optionIndex === (editingField.options?.length ?? 0) - 1} onClick={() => moveFieldOption(editingField.id, optionIndex, 1)} aria-label={`Move option ${optionIndex + 1} down`}><ArrowDown size={14} /></Button><Button type="button" variant="ghost" size="sm" onClick={() => removeFieldOption(editingField.id, optionIndex)} aria-label={`Remove option ${optionIndex + 1}`}><Trash2 size={14} className="text-accent-700" /></Button></div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </Modal>

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
        title={builderForm ? `Preview: ${builderForm.name}` : selectedForm ? `Submit: ${selectedForm.name}` : 'Submit Form'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setSubmitModalOpen(false)}>{activeTab === 'builder' ? 'Close Preview' : 'Cancel'}</Button>
          </>
        )}
      >
        {!selectedForm ? null : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-900">{builderForm?.name ?? selectedForm.name}</p>
              <p className="text-sm text-gray-600 mt-1">{builderForm?.description ?? selectedForm.description}</p>
              <p className="text-xs text-gray-500 mt-2">Mobile-friendly field layout with camera/signature support.</p>
              {/* TODO: Add robust offline-first local draft persistence for field users. */}
              {/* TODO: Add periodic auto-save draft sync workflow for poor connectivity environments. */}
            </div>

            <div className="space-y-3">
              {(builderForm?.id === selectedForm.id ? builderFields : fieldsForSelectedForm).map((field) => {
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
                    <SignaturePad
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      onChange={(signature) => setSubmitSignatures((current) => ({ ...current, [field.id]: signature }))}
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
            {activeSubmission?.status === 'pending_review' && (
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
              <div><span className="text-gray-500">Form:</span> <span className="text-gray-900 font-medium">{forms.find((form) => form.id === activeSubmission.formId)?.name ?? 'Archived form'}</span></div>
              <div><span className="text-gray-500">Status:</span> <span className="text-gray-900 font-medium capitalize">{activeSubmission.status}</span></div>
              <div><span className="text-gray-500">Submitted By:</span> <span className="text-gray-900 font-medium">{activeSubmission.submittedBy ?? '—'}</span></div>
              <div><span className="text-gray-500">Job:</span> <span className="text-gray-900 font-medium">{jobs.find((job) => job.id === activeSubmission.jobId)?.title ?? '—'}</span></div>
              <div><span className="text-gray-500">Division:</span> <span className="text-gray-900 font-medium">{divisions.find((division) => division.id === activeSubmission.divisionId)?.name ?? '—'}</span></div>
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
                    const fieldLabel = response.labelSnapshot ?? field?.label ?? response.fieldId;
                    const fieldType = response.typeSnapshot ?? field?.type;
                    const displayValue = fieldType === 'employee_selector'
                      ? employees.find((employee) => employee.id === response.value)?.name ?? response.value
                      : fieldType === 'job_selector'
                        ? jobs.find((job) => job.id === response.value)?.title ?? response.value
                        : fieldType === 'customer_selector'
                          ? customers.find((customer) => customer.id === response.value)?.name ?? response.value
                          : response.value;
                    return (
                      <tr key={response.id}>
                        <td className="px-4 py-3 text-gray-700">{fieldLabel}</td>
                        <td className="px-4 py-3 text-gray-900">
                          {fieldType === 'signature' && response.fileIds?.length ? (
                            <div className="space-y-2">
                              {response.fileIds.map((fileId) => submissionFileUrls[fileId] ? (
                                <img key={fileId} src={submissionFileUrls[fileId]} alt={`${fieldLabel} signature`} className="h-28 max-w-64 rounded border border-gray-200 bg-white object-contain" />
                              ) : <span key={fileId} className="text-xs text-gray-400">Signature unavailable</span>)}
                              <p className="text-xs text-gray-500">Signed by: {activeSubmission.submittedBy ?? 'Authenticated user'} · Submitted: {formatDateTime(response.signedAt ?? activeSubmission.submittedAt)}</p>
                            </div>
                          ) : fieldType === 'photo_upload' ? (
                            response.fileIds?.[0] ? (
                              submissionFileUrls[response.fileIds[0]] === undefined ? (
                                <span className="text-xs text-gray-400">Loading photo...</span>
                              ) : submissionFileUrls[response.fileIds[0]] ? (
                                <img
                                  src={submissionFileUrls[response.fileIds[0]]}
                                  alt={fieldLabel}
                                  className="h-36 max-w-72 rounded border border-gray-200 bg-white object-contain"
                                />
                              ) : <span className="text-xs text-gray-400">Photo unavailable</span>
                            ) : <span className="text-xs text-gray-400">Photo unavailable</span>
                          ) : displayValue || response.fileIds?.join(', ') || '—'}
                        </td>
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
