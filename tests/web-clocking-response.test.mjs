import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyClockingResponse } from '../src/utils/clockingResponse.js';

const activeEntry = { id: 'entry-1', employeeId: 'employee-1', status: 'clocked_in' };

test('web clock-in classifies a normal 200 response as completed', () => {
  assert.deepEqual(classifyClockingResponse({
    action: 'clock-in',
    status: 200,
    payload: { ok: true, timeEntry: activeEntry },
  }), { kind: 'completed', timeEntry: activeEntry });
});

test('web clock-in classifies an authoritative 202 workflow as pending', () => {
  const workflow = {
    ok: true,
    blocked: true,
    workflowOccurrenceId: 'clock-in-workflow-1',
    status: 'clock_in_pending_required_forms',
    requiredFormCount: 1,
    completedRequiredFormCount: 0,
    remainingRequiredFormCount: 1,
    requiredForms: [{ requirementId: 'required-1', formId: 'form-1', title: 'Pre-shift check' }],
    remainingForms: [{ requirementId: 'required-1', formId: 'form-1', title: 'Pre-shift check' }],
  };

  assert.deepEqual(classifyClockingResponse({ action: 'clock-in', status: 202, payload: workflow }), {
    kind: 'pending',
    workflow,
  });
});

test('web clock-out classifies an authoritative 202 workflow as pending', () => {
  const workflow = {
    ok: true,
    blocked: true,
    workflowOccurrenceId: 'clock-out-workflow-1',
    status: 'clock_out_pending_required_forms',
    requiredFormCount: 1,
    completedRequiredFormCount: 0,
    remainingRequiredFormCount: 1,
    requiredForms: [],
    remainingForms: [],
    timeEntryId: 'entry-1',
  };

  assert.equal(classifyClockingResponse({ action: 'clock-out', status: 202, payload: workflow }).kind, 'pending');
});

test('web clocking preserves structured server errors and uses HTTP fallback only when needed', () => {
  assert.deepEqual(classifyClockingResponse({
    action: 'clock-in',
    status: 400,
    payload: { ok: false, error: 'Select a Work Area before clocking Job Work.' },
  }), { kind: 'failed', message: 'Select a Work Area before clocking Job Work.' });
  assert.deepEqual(classifyClockingResponse({
    action: 'clock-in',
    status: 409,
    payload: { ok: false, error: 'Employee is already clocked in.' },
  }), { kind: 'failed', message: 'Employee is already clocked in.' });
  assert.deepEqual(classifyClockingResponse({ action: 'clock-out', status: 500, payload: null }), {
    kind: 'failed',
    message: 'Clock-out failed (HTTP 500).',
  });
});

test('web clocking does not accept a malformed successful response', () => {
  assert.equal(classifyClockingResponse({ action: 'clock-in', status: 200, payload: { ok: true } }).kind, 'failed');
});