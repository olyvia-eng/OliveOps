import test from 'node:test';
import assert from 'node:assert/strict';
import dataHandler from '../api/data.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mapKey(pk, sk) {
  return `${pk}|${sk}`;
}

function installDdbMock(t) {
  const store = new Map();
  const originalSend = ddb.send.bind(ddb);

  ddb.send = async (command) => {
    const commandType = command?.constructor?.name;
    const input = command?.input ?? {};

    if (commandType === 'PutCommand') {
      const item = { ...input.Item };
      store.set(mapKey(item.PK, item.SK), item);
      return {};
    }

    if (commandType === 'GetCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      return { Item: store.get(key) };
    }

    if (commandType === 'DeleteCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      store.delete(key);
      return {};
    }

    if (commandType === 'UpdateCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      const existing = store.get(key);
      if (!existing) {
        const error = new Error('Conditional check failed');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }

      const next = {
        ...existing,
        revokedAt: input.ExpressionAttributeValues[':revokedAt'],
        updatedAt: input.ExpressionAttributeValues[':updatedAt'],
      };
      store.set(key, next);
      return {};
    }

    if (commandType === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      const items = [];
      for (const item of store.values()) {
        if (item.PK === pk && typeof item.SK === 'string' && item.SK.startsWith(prefix)) {
          items.push(item);
        }
      }
      return { Items: items };
    }

    return originalSend(command);
  };

  t.after(() => {
    ddb.send = originalSend;
  });

  return store;
}

function seedBusinessUser(store, { businessId, userId, role, email, employeeId = null, active = true }) {
  store.set(
    mapKey(`BUSINESS#${businessId}`, `USER#${userId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `USER#${userId}`,
      entityType: 'USER',
      businessId,
      userId,
      name: `User ${userId}`,
      email,
      role,
      active,
      passwordHash: 'hash',
      employeeId,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

function seedCrewEntityData(store, { businessId, crewUserId, crewEmployeeId }) {
  const pk = `BUSINESS#${businessId}`;

  store.set(mapKey(pk, 'CUSTOMER#customer-1'), {
    PK: pk,
    SK: 'CUSTOMER#customer-1',
    entityType: 'CUSTOMER',
    businessId,
    customerId: 'customer-1',
    id: 'customer-1',
    name: 'Customer One',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  store.set(mapKey(pk, 'JOB#job-own'), {
    PK: pk,
    SK: 'JOB#job-own',
    entityType: 'JOB',
    businessId,
    jobId: 'job-own',
    title: 'Own Job',
    assignedEmployeeIds: [crewEmployeeId],
    status: 'in_progress',
  });

  store.set(mapKey(pk, 'JOB#job-other'), {
    PK: pk,
    SK: 'JOB#job-other',
    entityType: 'JOB',
    businessId,
    jobId: 'job-other',
    title: 'Other Job',
    assignedEmployeeIds: ['emp-crew-2'],
    status: 'in_progress',
  });

  store.set(mapKey(pk, 'ESTIMATE#estimate-1'), {
    PK: pk,
    SK: 'ESTIMATE#estimate-1',
    entityType: 'ESTIMATE',
    businessId,
    estimateId: 'estimate-1',
    proposalNumber: 'P-100',
    customerId: 'customer-1',
    status: 'draft',
  });

  store.set(mapKey(pk, 'INVOICE#invoice-1'), {
    PK: pk,
    SK: 'INVOICE#invoice-1',
    entityType: 'INVOICE',
    businessId,
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    amount: 100,
    number: 'INV-100',
    status: 'draft',
    date: '2026-01-01',
    dueDate: '2026-02-01',
  });

  store.set(mapKey(pk, 'EXPENSE#expense-1'), {
    PK: pk,
    SK: 'EXPENSE#expense-1',
    entityType: 'EXPENSE',
    businessId,
    expenseId: 'expense-1',
    vendor: 'Vendor',
    description: 'Expense',
    category: 'other',
    amount: 20,
    status: 'pending',
    expenseDate: '2026-01-01',
    notes: '',
  });

  store.set(mapKey(pk, 'BUDGET_META#budget-1'), {
    PK: pk,
    SK: 'BUDGET_META#budget-1',
    entityType: 'BUDGET',
    businessId,
    budgetId: 'budget-1',
    name: 'Budget One',
    budgetType: 'operating',
    fiscalYear: '2026',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  store.set(mapKey(pk, 'BUDGET#budget-item-1'), {
    PK: pk,
    SK: 'BUDGET#budget-item-1',
    entityType: 'BUDGET_ITEM',
    businessId,
    budgetItemId: 'budget-item-1',
    budgetId: 'budget-1',
    category: 'equipment',
    description: 'Row',
    budgeted: 10,
    actual: 0,
    period: '2026-01',
  });

  store.set(mapKey(pk, 'BUDGET_RATE#budget-rate-1'), {
    PK: pk,
    SK: 'BUDGET_RATE#budget-rate-1',
    entityType: 'BUDGET_RATE',
    businessId,
    budgetRateId: 'budget-rate-1',
    budgetId: 'budget-1',
    category: 'labour',
    costCode: 'L1',
    unit: 'hr',
    unitCost: 10,
    defaultMarkupPercent: 20,
    defaultSellPrice: 12,
    active: true,
    sortOrder: 0,
  });

  store.set(mapKey(pk, `EMPLOYEE#${crewEmployeeId}`), {
    PK: pk,
    SK: `EMPLOYEE#${crewEmployeeId}`,
    entityType: 'EMPLOYEE',
    businessId,
    employeeId: crewEmployeeId,
    name: 'Crew One',
    email: 'crew1@example.com',
    phone: '',
    role: 'crew_member',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  store.set(mapKey(pk, 'EMPLOYEE#emp-crew-2'), {
    PK: pk,
    SK: 'EMPLOYEE#emp-crew-2',
    entityType: 'EMPLOYEE',
    businessId,
    employeeId: 'emp-crew-2',
    name: 'Crew Two',
    email: 'crew2@example.com',
    phone: '',
    role: 'crew_member',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  store.set(mapKey(pk, 'TASK#task-own'), {
    PK: pk,
    SK: 'TASK#task-own',
    entityType: 'TASK',
    businessId,
    taskId: 'task-own',
    title: 'Own Task',
    assignedUserId: crewUserId,
    createdByUserId: 'user-foreman-1',
    status: 'todo',
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  store.set(mapKey(pk, 'TASK#task-other'), {
    PK: pk,
    SK: 'TASK#task-other',
    entityType: 'TASK',
    businessId,
    taskId: 'task-other',
    title: 'Other Task',
    assignedUserId: 'user-crew-2',
    createdByUserId: 'user-foreman-1',
    status: 'todo',
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  store.set(mapKey(pk, 'TIME#time-own'), {
    PK: pk,
    SK: 'TIME#time-own',
    entityType: 'TIME_ENTRY',
    businessId,
    entryId: 'time-own',
    employeeId: crewEmployeeId,
    clockIn: '2026-01-01T08:00:00.000Z',
    clockOut: '2026-01-01T16:00:00.000Z',
    breakMinutes: 0,
    status: 'clocked_out',
  });

  store.set(mapKey(pk, 'TIME#time-other'), {
    PK: pk,
    SK: 'TIME#time-other',
    entityType: 'TIME_ENTRY',
    businessId,
    entryId: 'time-other',
    employeeId: 'emp-crew-2',
    clockIn: '2026-01-01T08:00:00.000Z',
    clockOut: '2026-01-01T16:00:00.000Z',
    breakMinutes: 0,
    status: 'clocked_out',
  });

  store.set(mapKey(pk, 'FORM_SUBMISSION#submission-own'), {
    PK: pk,
    SK: 'FORM_SUBMISSION#submission-own',
    entityType: 'FORM_SUBMISSION',
    businessId,
    formSubmissionId: 'submission-own',
    formId: 'form-1',
    employeeId: crewEmployeeId,
    submittedAt: '2026-01-01T08:30:00.000Z',
    status: 'submitted',
    submittedBy: crewUserId,
  });

  store.set(mapKey(pk, 'FORM_SUBMISSION#submission-other'), {
    PK: pk,
    SK: 'FORM_SUBMISSION#submission-other',
    entityType: 'FORM_SUBMISSION',
    businessId,
    formSubmissionId: 'submission-other',
    formId: 'form-1',
    employeeId: 'emp-crew-2',
    submittedAt: '2026-01-01T08:30:00.000Z',
    status: 'submitted',
    submittedBy: 'user-crew-2',
  });

  store.set(mapKey(pk, 'FORM_RESPONSE#response-own'), {
    PK: pk,
    SK: 'FORM_RESPONSE#response-own',
    entityType: 'FORM_RESPONSE',
    businessId,
    formResponseId: 'response-own',
    submissionId: 'submission-own',
    fieldId: 'field-1',
    employeeId: crewEmployeeId,
    value: 'safe',
  });

  store.set(mapKey(pk, 'FORM_RESPONSE#response-other'), {
    PK: pk,
    SK: 'FORM_RESPONSE#response-other',
    entityType: 'FORM_RESPONSE',
    businessId,
    formResponseId: 'response-other',
    submissionId: 'submission-other',
    fieldId: 'field-1',
    employeeId: 'emp-crew-2',
    value: 'private',
  });
}

async function createBearerSession({ businessId, userId, role, email, employeeId, token }) {
  await createMobileSessionForUser({
    user: {
      id: userId,
      businessId,
      name: `User ${userId}`,
      email,
      role,
      businessName: `Business ${businessId}`,
      employeeId,
    },
    accessToken: token,
    expiresInSeconds: 604800,
  });
}

function requestWithToken(token, method, entity, body, id) {
  return {
    method,
    query: id ? { entity, id } : { entity },
    headers: { authorization: `Bearer ${token}` },
    body: body ?? {},
  };
}

test('equipment pricing writes require owner/admin and internal rates are redacted for foremen', async (t) => {
  const store = installDdbMock(t);
  const users = [
    { userId: 'user-owner-1', role: 'owner', email: 'owner@example.com', token: 'token-owner-pricing' },
    { userId: 'user-admin-1', role: 'admin', email: 'admin@example.com', token: 'token-admin-pricing' },
    { userId: 'user-foreman-1', role: 'foreman', email: 'foreman@example.com', token: 'token-foreman-pricing' },
  ];

  for (const user of users) {
    seedBusinessUser(store, { businessId: 'biz-1', ...user });
    await createBearerSession({ businessId: 'biz-1', ...user });
  }

  store.set(mapKey('BUSINESS#biz-1', 'EQUIPMENT#equipment-1'), {
    PK: 'BUSINESS#biz-1',
    SK: 'EQUIPMENT#equipment-1',
    entityType: 'EQUIPMENT_ASSET',
    businessId: 'biz-1',
    equipmentId: 'equipment-1',
    id: 'equipment-1',
    name: 'Compact Excavator',
    type: 'Excavator',
    status: 'available',
    costType: 'owned',
    hourlyCost: 5,
    costRateHourly: 43,
    recommendedSellRate: 69,
    chargeOutRate: 70,
    notes: '',
  });

  for (const role of ['owner', 'admin']) {
    const res = createMockRes();
    await dataHandler(requestWithToken(`token-${role}-pricing`, 'PATCH', 'equipment-assets', {
      data: { chargeOutRate: role === 'owner' ? 71 : 72 },
    }, 'equipment-1'), res);
    assert.equal(res.statusCode, 200, `${role} should be allowed to approve equipment pricing`);
  }

  const deniedRes = createMockRes();
  await dataHandler(requestWithToken('token-foreman-pricing', 'PATCH', 'equipment-assets', {
    data: { costRateHourly: 1, recommendedSellRate: 2, chargeOutRate: 3 },
  }, 'equipment-1'), deniedRes);
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.body.error, 'Only owner/admin can change equipment pricing.');

  const foremanReadRes = createMockRes();
  await dataHandler(requestWithToken('token-foreman-pricing', 'GET', 'equipment-assets'), foremanReadRes);
  assert.equal(foremanReadRes.statusCode, 200);
  assert.equal(foremanReadRes.body.items[0].costRateHourly, undefined);
  assert.equal(foremanReadRes.body.items[0].recommendedSellRate, undefined);
  assert.equal(foremanReadRes.body.items[0].chargeOutRate, 72);
});

test('crew_member /api/data list endpoints are entity and record authorized', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-1',
    userId: 'user-crew-1',
    role: 'crew_member',
    email: 'crew1@example.com',
    employeeId: 'emp-crew-1',
  });
  seedCrewEntityData(store, {
    businessId: 'biz-1',
    crewUserId: 'user-crew-1',
    crewEmployeeId: 'emp-crew-1',
  });
  await createBearerSession({
    businessId: 'biz-1',
    userId: 'user-crew-1',
    role: 'crew_member',
    email: 'crew1@example.com',
    employeeId: 'emp-crew-1',
    token: 'token-crew',
  });

  const checks = [
    { entity: 'customers', expectedStatus: 200, expectedCount: 0 },
    { entity: 'jobs', expectedStatus: 200, expectedCount: 1 },
    { entity: 'estimates', expectedStatus: 403 },
    { entity: 'invoices', expectedStatus: 403 },
    { entity: 'expenses', expectedStatus: 403 },
    { entity: 'budgets', expectedStatus: 200, expectedCount: 0 },
    { entity: 'budget', expectedStatus: 403 },
    { entity: 'budget-rates', expectedStatus: 403 },
    { entity: 'employees', expectedStatus: 200, expectedCount: 1 },
    { entity: 'tasks', expectedStatus: 200, expectedCount: 1 },
    { entity: 'time-entries', expectedStatus: 200, expectedCount: 1 },
    { entity: 'forms', expectedStatus: 403 },
    { entity: 'form-fields', expectedStatus: 403 },
    { entity: 'form-submissions', expectedStatus: 403 },
    { entity: 'form-responses', expectedStatus: 403 },
  ];

  for (const check of checks) {
    const req = requestWithToken('token-crew', 'GET', check.entity);
    const res = createMockRes();
    await dataHandler(req, res);

    assert.equal(res.statusCode, check.expectedStatus, `unexpected status for ${check.entity}`);
    if (check.expectedStatus === 200) {
      assert.equal(Array.isArray(res.body.items), true, `items must be an array for ${check.entity}`);
      assert.equal(res.body.items.length, check.expectedCount, `unexpected filtered count for ${check.entity}`);
    }
  }
});

test('crew_member cannot PATCH/DELETE another employee records by id', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-1',
    userId: 'user-crew-1',
    role: 'crew_member',
    email: 'crew1@example.com',
    employeeId: 'emp-crew-1',
  });
  seedCrewEntityData(store, {
    businessId: 'biz-1',
    crewUserId: 'user-crew-1',
    crewEmployeeId: 'emp-crew-1',
  });
  await createBearerSession({
    businessId: 'biz-1',
    userId: 'user-crew-1',
    role: 'crew_member',
    email: 'crew1@example.com',
    employeeId: 'emp-crew-1',
    token: 'token-crew-write',
  });

  const attempts = [
    {
      req: requestWithToken('token-crew-write', 'PATCH', 'tasks', { data: { title: 'Tampered title' } }, 'task-other'),
      expectedStatus: 403,
    },
    {
      req: requestWithToken('token-crew-write', 'DELETE', 'tasks', {}, 'task-other'),
      expectedStatus: 403,
    },
    {
      req: requestWithToken('token-crew-write', 'PATCH', 'form-submissions', { data: { status: 'approved' } }, 'submission-other'),
      expectedStatus: 403,
    },
    {
      req: requestWithToken('token-crew-write', 'PATCH', 'form-responses', { data: { value: 'tampered' } }, 'response-other'),
      expectedStatus: 403,
    },
    {
      req: requestWithToken('token-crew-write', 'PATCH', 'time-entries', { data: { breakMinutes: 999 } }, 'time-other'),
      expectedStatus: 403,
    },
  ];

  for (const attempt of attempts) {
    const res = createMockRes();
    await dataHandler(attempt.req, res);
    assert.equal(res.statusCode, attempt.expectedStatus);
    assert.equal(res.body.ok, false);
  }

  const taskOther = store.get(mapKey('BUSINESS#biz-1', 'TASK#task-other'));
  assert.equal(taskOther.title, 'Other Task');
});

test('cross-tenant id probes on mutating endpoints do not disclose or mutate records', async (t) => {
  const store = installDdbMock(t);
  seedBusinessUser(store, {
    businessId: 'biz-1',
    userId: 'user-admin-1',
    role: 'admin',
    email: 'admin1@example.com',
    employeeId: 'emp-admin-1',
  });
  seedBusinessUser(store, {
    businessId: 'biz-2',
    userId: 'user-admin-2',
    role: 'admin',
    email: 'admin2@example.com',
    employeeId: 'emp-admin-2',
  });

  store.set(mapKey('BUSINESS#biz-2', 'TASK#task-foreign'), {
    PK: 'BUSINESS#biz-2',
    SK: 'TASK#task-foreign',
    entityType: 'TASK',
    businessId: 'biz-2',
    taskId: 'task-foreign',
    title: 'Foreign Task',
    assignedUserId: 'user-admin-2',
    createdByUserId: 'user-admin-2',
    status: 'todo',
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  await createBearerSession({
    businessId: 'biz-1',
    userId: 'user-admin-1',
    role: 'admin',
    email: 'admin1@example.com',
    employeeId: 'emp-admin-1',
    token: 'token-admin-1',
  });

  const patchReq = requestWithToken('token-admin-1', 'PATCH', 'tasks', { data: { title: 'Cross Tenant Tamper' } }, 'task-foreign');
  const patchRes = createMockRes();
  await dataHandler(patchReq, patchRes);

  assert.equal(patchRes.statusCode, 404);

  const deleteReq = requestWithToken('token-admin-1', 'DELETE', 'tasks', {}, 'task-foreign');
  const deleteRes = createMockRes();
  await dataHandler(deleteReq, deleteRes);

  assert.equal(deleteRes.statusCode, 404);

  const foreignTask = store.get(mapKey('BUSINESS#biz-2', 'TASK#task-foreign'));
  assert.equal(foreignTask.title, 'Foreign Task');
});
