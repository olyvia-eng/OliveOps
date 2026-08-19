import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFormBuilderDraft, hasMultipleFormRequirements, isFormBuilderDirty, moveFormField } from '../src/pages/operations/formsBuilderModel.js';

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

test('Forms editor exposes explicit save lifecycle and compact builder navigation', async () => {
  const source = await readFile(new URL('../src/pages/operations/FormsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /Save Changes/);
  assert.match(source, /Unsaved changes/);
  assert.match(source, /beforeunload/);
  assert.match(source, /Back to Forms/);
  assert.match(source, /activeTab === 'overview'/);
  assert.match(source, /activeTab === 'forms'/);
  assert.match(source, /Recently updated/);
  assert.match(source, /View all forms/);
  assert.match(source, /When should this form appear\?/);
  assert.match(source, /Choose one or more ways employees can access this form\. Each enabled option creates a separate reason for the form to appear\./);
  assert.match(source, /Workflow Triggers/);
  assert.match(source, /Show this form when an employee performs a specific action\./);
  assert.match(source, /Require this form on a recurring schedule\./);
  assert.match(source, /Allow employees to open this form whenever they need it\./);
  assert.match(source, /Available On Demand/);
  assert.match(source, /Multiple requirements enabled/);
  assert.match(source, /Daily \+ After Clock Out/);
  assert.match(source, /setFieldPickerOpen\(true\)/);
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