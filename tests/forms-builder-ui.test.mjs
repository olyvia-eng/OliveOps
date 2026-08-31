import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createFormBuilderDraft,
  describeFormConfiguration,
  getFormConfigurationWarnings,
  getScheduleTriggers,
  getWorkflowTriggers,
  hasMultipleFormRequirements,
  isFormBuilderDirty,
  moveFormField,
  setFormOnDemand,
  setFormSchedule,
  setFormWorkflowTrigger,
} from '../src/pages/operations/formsBuilderModel.js';

const form = {
  id: 'form-a',
  name: 'Daily Inspection',
  description: 'Check the site.',
  category: 'safety',
  status: 'active',
  assignedTo: 'everyone',
  assignmentValue: '',
  trigger: ['daily', 'on_demand'],
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
};

const fields = [
  { id: 'field-a', formId: 'form-a', type: 'date', label: 'Inspection Date', required: true, order: 0 },
  { id: 'field-b', formId: 'form-a', type: 'multi_line_text', label: 'Notes', required: false, order: 1 },
];

test('Forms builder dirty state tracks meaningful form and field changes', () => {
  const baseline = createFormBuilderDraft(form, fields);
  assert.equal(isFormBuilderDirty(baseline, createFormBuilderDraft(form, fields)), false);

  const renamed = createFormBuilderDraft({ ...form, name: 'Renamed Inspection' }, fields);
  assert.equal(isFormBuilderDirty(baseline, renamed), true);

  const editedFields = createFormBuilderDraft(form, [{ ...fields[0], required: false }, fields[1]]);
  assert.equal(isFormBuilderDirty(baseline, editedFields), true);

  const reorderedTriggers = createFormBuilderDraft({ ...form, trigger: ['on_demand', 'daily'] }, fields);
  assert.equal(isFormBuilderDirty(baseline, reorderedTriggers), false);

  const changedTriggers = createFormBuilderDraft({ ...form, trigger: ['after_clock_out', 'daily'] }, fields);
  assert.equal(isFormBuilderDirty(baseline, changedTriggers), true);

  assert.equal(isFormBuilderDirty(baseline, createFormBuilderDraft({ ...form, requiresApproval: true }, fields)), true);
  assert.equal(isFormBuilderDirty(baseline, createFormBuilderDraft(form, [{ ...fields[0], acceptedResponse: { value: '2026-08-18', message: 'Use today.' } }, fields[1]])), true);
});

test('Forms trigger groups warn only when workflow and schedule requirements overlap', () => {
  assert.equal(hasMultipleFormRequirements(['after_clock_out']), false);
  assert.equal(hasMultipleFormRequirements(['daily']), false);
  assert.equal(hasMultipleFormRequirements(['on_demand']), false);
  assert.equal(hasMultipleFormRequirements(['after_clock_out', 'daily']), true);
  assert.equal(hasMultipleFormRequirements(['after_clock_out', 'on_demand']), false);
});

test('drag ordering moves the selected field and normalizes persisted order values', () => {
  const moved = moveFormField(fields, 'field-b', 'field-a');
  assert.deepEqual(moved.map((field) => field.id), ['field-b', 'field-a']);
  assert.deepEqual(moved.map((field) => field.order), [0, 1]);
  assert.deepEqual(fields.map((field) => field.id), ['field-a', 'field-b']);
});

test('Forms editor exposes full-width setup, explicit automation concepts, and save lifecycle', async () => {
  const source = await readFile(new URL('../src/pages/operations/FormsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /Save Changes/);
  assert.match(source, /Unsaved changes/);
  assert.match(source, /beforeunload/);
  assert.match(source, /Back to Forms/);
  assert.match(source, /activeTab === 'overview'/);
  assert.match(source, /activeTab === 'forms'/);
  assert.match(source, /Recently updated/);
  assert.match(source, /View all forms/);
  assert.match(source, /Form Setup/);
  assert.match(source, /Form Details/);
  assert.match(source, /Who Should Complete This Form\?/);
  assert.match(source, /Availability &amp; Automation/);
  assert.match(source, /Workflow Trigger/);
  assert.match(source, /After Leaving Job/);
  assert.match(source, /When Job Is Completed/);
  assert.match(source, /Add another trigger/);
  assert.match(source, /No recurring schedule/);
  assert.match(source, /Completion Requirement/);
  assert.match(source, /Require approval after submission/);
  assert.match(source, /Reminder Only/);
  assert.match(source, /Allow employees to open this form anytime/);
  assert.match(source, /How This Form Works/);
  assert.match(source, /Multiple requirements enabled/);
  assert.match(source, /Daily \+ After Clock Out/);
  assert.match(source, /setFieldPickerOpen\(true\)/);
  assert.doesNotMatch(source, /xl:grid-cols-\[minmax\(0,1fr\)_380px\]/);
  assert.doesNotMatch(source, /When should this form appear\?/);
  assert.doesNotMatch(source, /label="Active Form"/);
  assert.doesNotMatch(source, /label="Order"/);
  assert.doesNotMatch(source, /Trigger Rules \(Clock In\/Out/);
});

test('Forms save waits for persistence and session loss clears cached business data', async () => {
  const formsSource = await readFile(new URL('../src/pages/operations/FormsPage.tsx', import.meta.url), 'utf8');
  const storeSource = await readFile(new URL('../src/store/index.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(formsSource, /await Promise\.all\(writes\)/);
  assert.match(formsSource, /savingBuilder \? 'Saving\.\.\.' : 'Save Changes'/);
  assert.match(formsSource, /updateForm\(builderDraft\.form\.id, formPatch\)/);
  assert.match(formsSource, /setBuilderBaseline\(createFormBuilderDraft/);
  assert.match(storeSource, /updateForm: async/);
  assert.match(storeSource, /addFormField: async/);
  assert.match(appSource, /if \(!sessionUser\) \{[\s\S]*clearBusinessDataStore\(\)/);
});

test('builder automation helpers preserve legacy values until the admin changes that concept', () => {
  const legacy = ['after_completing_job', 'daily', 'weekly', 'on_demand'];
  assert.deepEqual(getWorkflowTriggers(legacy), ['after_completing_job']);
  assert.deepEqual(getScheduleTriggers(legacy), ['daily', 'weekly']);
  assert.deepEqual(setFormOnDemand(legacy, false), ['after_completing_job', 'daily', 'weekly']);
  assert.deepEqual(setFormSchedule(legacy, 'monthly'), ['after_completing_job', 'on_demand', 'monthly']);
  assert.deepEqual(setFormWorkflowTrigger(legacy, 0, 'after_leaving_job'), ['after_leaving_job', 'daily', 'weekly', 'on_demand']);
});

test('legacy forms default to reminder and generated guidance reflects draft configuration', () => {
  const legacy = createFormBuilderDraft({ ...form, completionRequirement: undefined }, fields);
  assert.equal(legacy.form.completionRequirement, 'reminder');
  assert.match(describeFormConfiguration({ ...legacy.form, trigger: ['after_clock_out', 'daily', 'on_demand'] }), /after clocking out/);
  assert.match(describeFormConfiguration({ ...legacy.form, trigger: ['after_clock_out', 'daily', 'on_demand'] }), /daily schedule/);
  assert.match(describeFormConfiguration({ ...legacy.form, trigger: ['after_clock_out', 'daily', 'on_demand'] }), /open it manually/);

  const inaccessible = { ...legacy.form, trigger: [], assignedTo: 'division', assignmentValue: '', completionRequirement: 'required' };
  assert.equal(getFormConfigurationWarnings(inaccessible).length, 2);
  for (const trigger of ['before_clock_in', 'after_clock_out']) {
    assert.doesNotMatch(getFormConfigurationWarnings({ ...inaccessible, assignedTo: 'everyone', trigger: [trigger] }).join(' '), /enforcement is not yet available/);
  }
  for (const trigger of ['before_starting_job', 'after_completing_job', 'after_leaving_job', 'job_completed']) {
    assert.match(getFormConfigurationWarnings({ ...inaccessible, assignedTo: 'everyone', trigger: [trigger] }).join(' '), /enforcement is not yet available/);
  }
  assert.match(describeFormConfiguration({ ...legacy.form, completionRequirement: 'required', trigger: ['after_clock_out'] }), /must submit it before clock-out can be finalized/);
  assert.match(describeFormConfiguration({ ...legacy.form, completionRequirement: 'required', trigger: ['before_clock_in'] }), /must submit it before clock-in can be finalized/);
  assert.match(describeFormConfiguration({ ...legacy.form, completionRequirement: 'required', trigger: ['before_starting_job'] }), /advisory for workflow triggers other than Before Clock In and After Clock Out/);
});

test('field configuration is contextual and option editing is structured', async () => {
  const source = await readFile(new URL('../src/pages/operations/FormsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /title=\{editingField \? `Edit Field/);
  assert.match(source, /open=\{editingField !== null\}/);
  assert.match(source, /label="Field Type"/);
  assert.match(source, /Add Option/);
  assert.match(source, /Require a specific answer/);
  assert.match(source, /Accepted answer/);
  assert.match(source, /moveFieldOption/);
  assert.match(source, /removeFieldOption/);
  assert.doesNotMatch(source, /Options \(comma-separated\)/);
  assert.match(source, /activeTab !== 'builder' &&/);
  assert.match(source, /field\.type === 'date' && field\.defaultValue\?\.toLowerCase\(\) === 'today'/);
});

test('Signature uses reusable pointer capture with Clear and Form cloning opens the returned draft', async () => {
  const formsSource = await readFile(new URL('../src/pages/operations/FormsPage.tsx', import.meta.url), 'utf8');
  const signatureSource = await readFile(new URL('../src/components/forms/SignaturePad.tsx', import.meta.url), 'utf8');
  assert.match(formsSource, /<SignaturePad/);
  assert.doesNotMatch(formsSource, /Type full name to sign/);
  assert.match(formsSource, /Clone Form/);
  assert.match(formsSource, /await cloneForm\(formId\)/);
  assert.match(formsSource, /setActiveTab\('builder'\)/);
  assert.match(formsSource, /response\.typeSnapshot \?\? field\?\.type/);
  assert.match(formsSource, /response\.labelSnapshot \?\? field\?\.label/);
  assert.match(signatureSource, /onPointerDown/);
  assert.match(signatureSource, /onPointerMove/);
  assert.match(signatureSource, /onPointerUp/);
  assert.match(signatureSource, /setPointerCapture/);
  assert.match(signatureSource, /touch-none/);
  assert.match(signatureSource, />Clear<\/Button>/);
  assert.match(signatureSource, /toBlob\([^]*'image\/png'/);
  assert.match(signatureSource, /aria-label=\{`\$\{label\} signature pad`\}/);
});