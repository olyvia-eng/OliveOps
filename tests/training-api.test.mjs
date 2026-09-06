import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingHandler } from '../api/training.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function harness({
  session = { id: 'user-a', businessId: 'biz-a', employeeId: 'emp-a', role: 'crew_member', name: 'Alex', email: 'alex@example.com' },
  employee = { id: 'emp-a', userId: 'user-a', name: 'Alex', email: 'alex@example.com', active: true },
  assignments = [],
  completions = [],
  version = { businessId: 'biz-a', trainingId: 'training-a', version: 1, checklist: [] },
} = {}) {
  const calls = [];
  const handler = createTrainingHandler({
    requireSession: async () => session,
    getBusinessProfile: async (businessId) => { calls.push(['profile', businessId]); return { timezone: 'America/Toronto' }; },
    getEmployeeForBusiness: async (businessId, employeeId) => { calls.push(['employee', businessId, employeeId]); return employee?.id === employeeId ? employee : null; },
    listEmployeesForBusiness: async (businessId) => { calls.push(['employees', businessId]); return employee ? [employee] : []; },
    listTrainingDefinitionsForBusiness: async (businessId) => { calls.push(['definitions', businessId]); return [{ id: 'training-a' }]; },
    listTrainingAssignmentsForBusiness: async (businessId) => { calls.push(['assignments', businessId]); return assignments; },
    listTrainingCompletionsForBusiness: async (businessId) => { calls.push(['completions', businessId]); return completions; },
    listTrainingVersionsForBusiness: async () => [],
    getTrainingDefinitionForBusiness: async () => ({ id: 'training-a' }),
    getTrainingAssignmentForBusiness: async (businessId, assignmentId) => { calls.push(['assignment', businessId, assignmentId]); return assignments.find((item) => item.id === assignmentId) ?? null; },
    getTrainingVersionForBusiness: async () => version,
    presentTrainingAssignments: (items) => items.map((item) => ({ ...item, presentationStatus: item.presentationStatus ?? 'not_started' })),
    publishTrainingVersionForBusiness: async (input) => { calls.push(['publish', input]); return { trainingId: input.trainingId, version: 1 }; },
    deleteTrainingForBusiness: async (input) => { calls.push(['delete', input]); return { ok: true, deletedRecordCount: 8, deletedFileKeys: ['biz-a/file-a/training.pdf'] }; },
    removeStoredFile: async (input) => { calls.push(['remove-file', input]); return { ok: true }; },
    completeTrainingAssignmentForBusiness: async (input) => { calls.push(['complete', input]); return { completion: { id: 'completion-a' }, replayed: false }; },
  });
  return { handler, calls };
}

async function call(handler, method, action, { body = {}, query = {} } = {}) {
  const res = response();
  await handler({ method, query: { action, ...query }, body }, res);
  return res;
}

test('owner can list only through the authenticated business scope', async () => {
  const { handler, calls } = harness({ session: { id: 'owner-a', businessId: 'biz-a', role: 'owner', name: 'Owner', email: 'owner@example.com' } });
  const result = await call(handler, 'GET', 'list', { query: { businessId: 'biz-b' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.filter(([name]) => ['profile', 'definitions', 'assignments'].includes(name)).map(([, businessId]) => businessId), ['biz-a', 'biz-a', 'biz-a']);
});

test('foreman cannot access training administration', async () => {
  const { handler } = harness({ session: { id: 'foreman-a', businessId: 'biz-a', employeeId: 'emp-a', role: 'foreman', name: 'Foreman', email: 'foreman@example.com' } });
  assert.equal((await call(handler, 'GET', 'list')).statusCode, 403);
  assert.equal((await call(handler, 'POST', 'publish', { body: { trainingId: 'training-a', requestId: 'publish-a' } })).statusCode, 403);
  assert.equal((await call(handler, 'POST', 'delete', { body: { trainingId: 'training-a' } })).statusCode, 403);
});

test('owner can permanently delete Training and its tenant-scoped stored files', async () => {
  const session = { id: 'owner-a', businessId: 'biz-a', role: 'owner', name: 'Owner', email: 'owner@example.com' };
  const { handler, calls } = harness({ session });
  const result = await call(handler, 'POST', 'delete', { body: { businessId: 'biz-b', trainingId: 'training-a' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deletedRecordCount, 8);
  assert.equal('deletedFileKeys' in result.body, false);
  assert.equal(calls.find(([name]) => name === 'delete')[1].businessId, 'biz-a');
  assert.deepEqual(calls.find(([name]) => name === 'remove-file')[1], { businessId: 'biz-a', key: 'biz-a/file-a/training.pdf' });
});

test('employee endpoints require an active employee linked to the session user', async () => {
  const inactive = harness({ employee: { id: 'emp-a', userId: 'user-a', active: false } });
  assert.equal((await call(inactive.handler, 'GET', 'my-list')).statusCode, 403);
  const wrongUser = harness({ employee: { id: 'emp-a', userId: 'other-user', active: true } });
  assert.equal((await call(wrongUser.handler, 'GET', 'my-list')).statusCode, 403);
});

test('employee detail fails closed for another employee assignment', async () => {
  const { handler } = harness({ assignments: [{ id: 'assignment-b', employeeId: 'emp-b', trainingId: 'training-a', assignedVersion: 1 }] });
  const result = await call(handler, 'GET', 'my-detail', { query: { assignmentId: 'assignment-b' } });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.error, 'Training assignment was not found.');
});

test('revoked employee assignment returns a stable stale-assignment conflict', async () => {
  const { handler } = harness({ assignments: [{ id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 1, revokedAt: '2026-08-01T00:00:00.000Z' }] });
  const result = await call(handler, 'GET', 'my-detail', { query: { assignmentId: 'assignment-a' } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'stale_assignment');
});

test('employee detail and history preserve immutable document mode metadata', async () => {
  const document = { fileId: 'file-pdf', originalFileName: 'training.pdf', mimeType: 'application/pdf', sizeBytes: 2048, status: 'ready', version: 3 };
  const version = { businessId: 'biz-a', trainingId: 'training-a', version: 3, checklist: [], contentMode: 'document', document };
  const completion = { id: 'completion-a', employeeId: 'emp-a', trainingId: 'training-a', completedVersion: 3, contentMode: 'document', document, completedAt: '2026-08-01T00:00:00.000Z' };
  const assignments = [{ id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 3 }];
  const { handler } = harness({ assignments, completions: [completion], version });
  const detail = await call(handler, 'GET', 'my-detail', { query: { assignmentId: 'assignment-a' } });
  const history = await call(handler, 'GET', 'my-history');
  assert.equal(detail.body.version.contentMode, 'document');
  assert.deepEqual(detail.body.version.document, document);
  assert.equal(history.body.completions[0].contentMode, 'document');
  assert.deepEqual(history.body.completions[0].document, document);
});

test('employee detail exposes ordered Training Sections from the assigned immutable version', async () => {
  const trainingSections = [
    { sectionId: 'section-a', title: 'Inspection', description: 'Check first.', sortOrder: 0, checklistItems: [{ itemId: 'item-a', text: 'Check oil', required: true, sortOrder: 0 }] },
    { sectionId: 'section-b', title: 'Operation', description: 'Operate safely.', sortOrder: 1, checklistItems: [{ itemId: 'item-b', text: 'Wear seatbelt', required: true, sortOrder: 0 }] },
  ];
  const version = { businessId: 'biz-a', trainingId: 'training-a', version: 4, trainingSections, checklist: trainingSections.flatMap((section) => section.checklistItems) };
  const assignments = [{ id: 'assignment-a', employeeId: 'emp-a', trainingId: 'training-a', assignedVersion: 4 }];
  const { handler } = harness({ assignments, version });
  const detail = await call(handler, 'GET', 'my-detail', { query: { assignmentId: 'assignment-a' } });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.body.version.trainingSections, trainingSections);
});

test('completion derives business and employee identity from the session', async () => {
  const { handler, calls } = harness();
  const body = { assignmentId: 'assignment-a', submissionId: 'submission-a', checklistResponses: [], acknowledged: true, businessId: 'biz-b', employeeId: 'emp-b' };
  const result = await call(handler, 'POST', 'complete', { body });
  assert.equal(result.statusCode, 200);
  const input = calls.find(([name]) => name === 'complete')[1];
  assert.equal(input.businessId, 'biz-a');
  assert.equal(input.employee.id, 'emp-a');
  assert.equal(input.assignmentId, 'assignment-a');
});

test('publish requires owner/admin and forwards a stable request ID', async () => {
  const session = { id: 'admin-a', businessId: 'biz-a', role: 'admin', name: 'Admin', email: 'admin@example.com' };
  const { handler, calls } = harness({ session });
  const result = await call(handler, 'POST', 'publish', { body: { trainingId: 'training-a', requestId: 'publish-request-a' } });
  assert.equal(result.statusCode, 200);
  const input = calls.find(([name]) => name === 'publish')[1];
  assert.equal(input.businessId, 'biz-a');
  assert.equal(input.requestId, 'publish-request-a');
  assert.equal(input.actor.id, 'admin-a');
});
