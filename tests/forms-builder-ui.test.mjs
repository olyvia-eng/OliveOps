import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyFormDeliveryRule,
  createDefaultDeliveryRule,
  createFormBuilderDraft,
  describeFormConfiguration,
  getFormConfigurationWarnings,
  getLegacyConfigurationLabels,
  getTemplateDeliveryRule,
  isFormBuilderDirty,
  moveFormField,
} from '../src/pages/operations/formsBuilderModel.js';

const form = {
  id: 'form-a',
  name: 'Daily Inspection',
  description: 'Check the site.',
  category: 'safety',
  status: 'active',
  assignedTo: 'everyone',
  assignmentValue: '',
  trigger: ['on_demand'],
  deliveryRule: createDefaultDeliveryRule('always_available'),
  deliveryRuleVersion: 1,
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

  const changedRule = createFormBuilderDraft(applyFormDeliveryRule(form, createDefaultDeliveryRule('after_clock_out')), fields);
  assert.equal(isFormBuilderDirty(baseline, changedRule), true);

  assert.equal(isFormBuilderDirty(baseline, createFormBuilderDraft({ ...form, requiresApproval: true }, fields)), true);
  assert.equal(isFormBuilderDirty(baseline, createFormBuilderDraft(form, [{ ...fields[0], acceptedResponse: { value: '2026-08-18', message: 'Use today.' } }, fields[1]])), true);
});

test('delivery rule helpers produce canonical legacy fields and template defaults', () => {
  const clockRule = { ...createDefaultDeliveryRule('before_clock_in'), completionBehavior: 'blocking', allowManualAccess: true };
  const normalized = applyFormDeliveryRule(form, clockRule);
  assert.deepEqual(normalized.trigger, ['before_clock_in', 'on_demand']);
  assert.equal(normalized.completionRequirement, 'required');
  assert.equal(normalized.deliveryRuleVersion, 1);

  for (const name of ['Excavator Daily Inspection', 'Morning Truck Inspection', 'MTO Daily Inspection']) {
    assert.deepEqual(getTemplateDeliveryRule(name), { type: 'before_clock_in', frequency: 'once_daily', completionBehavior: 'blocking', schedule: null, allowManualAccess: false });
  }
  for (const name of ['Vehicle Damage Report', 'Fuel Log', 'Toolbox Talk Attendance', 'Tailgate Safety Meeting']) {
    assert.equal(getTemplateDeliveryRule(name).type, 'always_available');
  }
});

test('drag ordering moves the selected field and normalizes persisted order values', () => {
  const moved = moveFormField(fields, 'field-b', 'field-a');
  assert.deepEqual(moved.map((field) => field.id), ['field-b', 'field-a']);
  assert.deepEqual(moved.map((field) => field.order), [0, 1]);
  assert.deepEqual(fields.map((field) => field.id), ['field-a', 'field-b']);
});

test('Forms editor exposes one normalized delivery decision and contextual controls', async () => {
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
  assert.match(source, /When should employees complete this form\?/);
  assert.match(source, /Before clock-in/);
  assert.match(source, /After clock-out/);
  assert.match(source, /On a schedule/);
  assert.match(source, /Always available/);
  assert.match(source, /Once per day/);
  assert.match(source, /Every time/);
  assert.match(source, /Custom interval/);
  assert.match(source, /Day of month/);
  assert.match(source, /last day of that month/);
  assert.match(source, /Scheduled forms become due/);
  assert.match(source, /Block \{deliveryRule\.type === 'before_clock_in' \? 'clock-in' : 'clock-out'\} until submitted/);
  assert.match(source, /Require approval after submission/);
  assert.match(source, /Also allow employees to open this form anytime/);
  assert.match(source, /generic manual submission does not satisfy a future or pending occurrence unless the employee opens the form from that occurrence/);
  assert.match(source, /How This Form Works/);
  assert.match(source, /Configuration needs review/);
  assert.match(source, /historical settings remain unchanged until then/);
  assert.match(source, /setFieldPickerOpen\(true\)/);
  assert.doesNotMatch(source, /xl:grid-cols-\[minmax\(0,1fr\)_380px\]/);
  assert.doesNotMatch(source, /Add another trigger/);
  assert.doesNotMatch(source, /Before Starting Job/);
  assert.doesNotMatch(source, /After Leaving Job/);
  assert.doesNotMatch(source, /When Job Is Completed/);
});

test('Forms save waits for persistence and session loss clears cached business data', async () => {
  const formsSource = await readFile(new URL('../src/pages/operations/FormsPage.tsx', import.meta.url), 'utf8');
  const storeSource = await readFile(new URL('../src/store/index.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(formsSource, /await Promise\.all\(writes\)/);
  assert.match(formsSource, /savingBuilder \? 'Saving\.\.\.' : 'Save Changes'/);
  assert.match(formsSource, /updateForm\(builderDraft\.form\.id, formPatch\)/);
  assert.match(formsSource, /applyFormDeliveryRule\(builderDraft\.form, builderDraft\.form\.deliveryRule\)/);
  assert.match(formsSource, /Your changes are still here/);
  assert.match(formsSource, /setBuilderBaseline\(savedDraft\)/);
  assert.match(storeSource, /updateForm: async/);
  assert.match(storeSource, /addFormField: async/);
  assert.match(appSource, /if \(!sessionUser\) \{[\s\S]*clearBusinessDataStore\(\)/);
});

test('ambiguous historical automation is preserved for review until one rule is selected', () => {
  const historical = { ...form, deliveryRule: undefined, deliveryRuleVersion: undefined, trigger: ['after_completing_job', 'daily', 'on_demand'] };
  const draft = createFormBuilderDraft(historical, fields);
  assert.equal(draft.form.deliveryRule, undefined);
  assert.deepEqual(draft.form.trigger, historical.trigger);
  assert.deepEqual(getLegacyConfigurationLabels(draft.form), ['After Completing Job', 'Daily', 'Always Available']);
  assert.match(getFormConfigurationWarnings(draft.form).join(' '), /Configuration needs review/);
  assert.match(describeFormConfiguration(draft.form), /historical delivery settings need review/);

  const selected = applyFormDeliveryRule(draft.form, createDefaultDeliveryRule('scheduled'));
  assert.deepEqual(selected.trigger, ['daily']);
  assert.equal(getFormConfigurationWarnings(selected).length, 0);
});

test('unambiguous legacy schedules retain their historical due day when normalized for editing', () => {
  const weekly = createFormBuilderDraft({ ...form, deliveryRule: undefined, deliveryRuleVersion: undefined, trigger: ['weekly'] }, fields);
  assert.deepEqual(weekly.form.deliveryRule.schedule, { cadence: 'weekly', weekdays: [1] });
  assert.deepEqual(weekly.form.trigger, ['weekly']);

  const monthly = createFormBuilderDraft({ ...form, deliveryRule: undefined, deliveryRuleVersion: undefined, trigger: ['monthly'] }, fields);
  assert.deepEqual(monthly.form.deliveryRule.schedule, { cadence: 'monthly', dayOfMonth: 1 });
  assert.deepEqual(monthly.form.trigger, ['monthly']);
});

test('configuration summaries cover audience, timing, frequency, blocking, and manual access in at most two sentences', () => {
  const configured = applyFormDeliveryRule(form, {
    type: 'after_clock_out', frequency: 'every_occurrence', completionBehavior: 'blocking', schedule: null, allowManualAccess: true,
  });
  const summary = describeFormConfiguration(configured);
  assert.match(summary, /all employees/);
  assert.match(summary, /after clock-out, every time/);
  assert.match(summary, /blocks clock-out/);
  assert.match(summary, /generic manual submission/);
  assert.ok(summary.split('.').filter((sentence) => sentence.trim()).length <= 2);
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
  assert.match(formsSource, /fieldType === 'photo_upload'/);
  assert.match(formsSource, /Loading photo\.\.\./);
  assert.match(formsSource, /Photo unavailable/);
  assert.match(formsSource, /resolveAttachmentUrl\(\{ fileId \}\)/);
  assert.match(signatureSource, /onPointerDown/);
  assert.match(signatureSource, /onPointerMove/);
  assert.match(signatureSource, /onPointerUp/);
  assert.match(signatureSource, /setPointerCapture/);
  assert.match(signatureSource, /touch-none/);
  assert.match(signatureSource, />Clear<\/Button>/);
  assert.match(signatureSource, /toBlob\([^]*'image\/png'/);
  assert.match(signatureSource, /aria-label=\{`\$\{label\} signature pad`\}/);
});