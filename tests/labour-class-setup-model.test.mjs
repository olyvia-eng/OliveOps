import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLabourClassSetupDraft,
  mergeLabourClassSetupGroups,
  normalizeLabourClassName,
  shouldOfferLabourClassSetup,
  suggestLabourClassName,
} from '../src/pages/data-center/labourClassSetupModel.js';

const employee = (overrides = {}) => ({
  id: 'employee-1',
  name: 'Field Employee',
  role: 'crew_member',
  labourType: 'field_producing',
  active: true,
  ...overrides,
});

test('existing field workforce with no Labour Classes is offered guided setup', () => {
  assert.equal(shouldOfferLabourClassSetup({ employees: [employee()] }), true);
  assert.equal(shouldOfferLabourClassSetup({ employees: [] }), false);
});

test('planned Employees without active classes are offered setup without hiding valid classes', () => {
  const labourClasses = [{ id: 'class-foreman', name: 'Foreman', active: true }];
  const employees = [
    employee({ id: 'assigned', role: 'foreman', labourClassId: 'class-foreman' }),
    employee({ id: 'unassigned' }),
  ];
  const planningItems = [
    { id: 'plan-assigned', category: 'labour', employeeId: 'assigned' },
    { id: 'plan-unassigned', category: 'labour', employeeId: 'unassigned' },
  ];
  assert.equal(shouldOfferLabourClassSetup({ employees, labourClasses, planningItems }), true);
  assert.equal(shouldOfferLabourClassSetup({ employees, labourClasses, planningItems: planningItems.slice(0, 1) }), false);
});

test('suggestions classify field roles conservatively and are draft-only', () => {
  assert.equal(suggestLabourClassName(employee({ role: 'foreman' })), 'Foreman');
  assert.equal(suggestLabourClassName(employee({ role: 'crew_member' })), 'Labourer');
  assert.equal(suggestLabourClassName(employee({ role: 'admin' })), null);
  assert.equal(suggestLabourClassName(employee({ role: 'owner' })), null);
  assert.equal(suggestLabourClassName(employee({ role: 'manager' })), null);
  assert.equal(suggestLabourClassName(employee({ role: 'foreman', labourType: 'overhead' })), null);

  const employees = [employee({ id: 'foreman', role: 'foreman' }), employee({ id: 'crew' }), employee({ id: 'admin', role: 'admin' })];
  const original = structuredClone(employees);
  const draft = buildLabourClassSetupDraft({ employees });
  assert.deepEqual(employees, original);
  assert.deepEqual(draft.classes.map((item) => item.name), ['Foreman', 'Labourer']);
  assert.equal(draft.assignments.admin, null);
});

test('existing class names are reused and capitalization variants collapse', () => {
  const draft = buildLabourClassSetupDraft({
    employees: [employee({ id: 'crew' })],
    labourClasses: [{ id: 'existing-labourer', name: 'labourer', active: true }],
  });
  assert.deepEqual(draft.classes, [{ key: 'existing:existing-labourer', id: 'existing-labourer', name: 'labourer' }]);
  assert.equal(draft.assignments.crew, 'existing:existing-labourer');
  assert.equal(normalizeLabourClassName('  LABOURER  '), 'labourer');
  assert.deepEqual(
    mergeLabourClassSetupGroups([
      { key: 'one', id: null, name: ' Labourer ' },
      { key: 'two', id: null, name: 'LABOURER' },
    ]),
    [{ key: 'one', id: null, name: 'Labourer' }],
  );
});

test('Employees assigned to inactive classes return to setup review', () => {
  const draft = buildLabourClassSetupDraft({
    employees: [employee({ id: 'legacy', role: 'foreman', labourClassId: 'inactive-foreman' })],
    labourClasses: [{ id: 'inactive-foreman', name: 'Foreman', active: false }],
  });
  assert.equal(draft.assignments.legacy, 'new:foreman');
  assert.deepEqual(draft.classes.map((item) => item.name), ['Foreman']);
});