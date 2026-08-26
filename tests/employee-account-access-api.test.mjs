import test from 'node:test';
import assert from 'node:assert/strict';

import dataHandler from '../api/data.js';
import labourClassSetupHandler from '../api/labour-class-setup.js';
import { ddb } from '../api/_lib/db.js';
import {
  authenticateUser,
  createAuthUserForBusiness,
  createEmployeeForBusiness,
  createMobileSessionForUser,
  createUserEmployeePair,
  getEmployeeForBusiness,
  listLabourClassesForBusiness,
  listEmployeesForBusiness,
  listUsersForBusiness,
} from '../api/_lib/authRepo.js';

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

  const readItem = (key) => store.get(mapKey(key.PK, key.SK));

  const resolveName = (token, names = {}) => {
    if (typeof token === 'string' && token.startsWith('#')) {
      return names[token] ?? token.slice(1);
    }
    return token;
  };

  const resolveValue = (token, values = {}) => {
    if (typeof token === 'string' && token.startsWith(':')) {
      return values[token];
    }
    return token;
  };

  const evaluateCondition = (conditionExpression, existing, names = {}, values = {}) => {
    if (!conditionExpression || !conditionExpression.trim()) return true;

    const clauses = conditionExpression.split(/\s+AND\s+/i).map((clause) => clause.trim());
    for (const clause of clauses) {
      if (clause === 'attribute_not_exists(PK)' || clause === 'attribute_not_exists(SK)') {
        if (existing) return false;
        continue;
      }
      if (clause === 'attribute_exists(PK)' || clause === 'attribute_exists(SK)') {
        if (!existing) return false;
        continue;
      }

      const match = /^(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)/.exec(clause);
      if (match) {
        if (!existing) return false;
        const fieldName = resolveName(match[1], names);
        const expectedValue = resolveValue(match[2], values);
        if (existing[fieldName] !== expectedValue) return false;
        continue;
      }

      throw new Error(`Unsupported condition expression in test mock: ${clause}`);
    }

    return true;
  };

  const applyUpdateExpression = (existing, updateExpression, names = {}, values = {}) => {
    if (!existing) return null;
    const next = { ...existing };
    const normalized = updateExpression.replace(/^SET\s+/i, '').trim();
    const assignments = normalized.split(',').map((part) => part.trim()).filter(Boolean);

    for (const assignment of assignments) {
      const [left, right] = assignment.split('=').map((part) => part.trim());
      const fieldName = resolveName(left, names);
      const value = resolveValue(right, values);
      next[fieldName] = value;
    }

    return next;
  };

  ddb.send = async (command) => {
    const commandType = command?.constructor?.name;
    const input = command?.input ?? {};

    if (commandType === 'PutCommand') {
      const item = { ...input.Item };
      const existing = readItem(item);
      const ok = evaluateCondition(input.ConditionExpression, existing, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
      if (!ok) {
        const error = new Error('Conditional check failed');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
      store.set(mapKey(item.PK, item.SK), item);
      return {};
    }

    if (commandType === 'GetCommand') {
      return { Item: readItem(input.Key) };
    }

    if (commandType === 'DeleteCommand') {
      store.delete(mapKey(input.Key.PK, input.Key.SK));
      return {};
    }

    if (commandType === 'UpdateCommand') {
      const key = mapKey(input.Key.PK, input.Key.SK);
      const existing = store.get(key);
      const ok = evaluateCondition(input.ConditionExpression, existing, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
      if (!ok) {
        const error = new Error('Conditional check failed');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }

      const next = applyUpdateExpression(existing, input.UpdateExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
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

    if (commandType === 'ScanCommand') {
      const items = [];
      for (const item of store.values()) {
        items.push(item);
      }
      return { Items: items };
    }

    if (commandType === 'TransactWriteCommand') {
      const items = Array.isArray(input.TransactItems) ? input.TransactItems : [];
      const failures = [];

      for (const item of items) {
        if (item.Put) {
          const existing = readItem(item.Put.Item);
          const ok = evaluateCondition(item.Put.ConditionExpression, existing, item.Put.ExpressionAttributeNames, item.Put.ExpressionAttributeValues);
          failures.push({ Code: ok ? 'None' : 'ConditionalCheckFailed' });
          continue;
        }

        if (item.Delete) {
          const existing = readItem(item.Delete.Key);
          const ok = evaluateCondition(item.Delete.ConditionExpression, existing, item.Delete.ExpressionAttributeNames, item.Delete.ExpressionAttributeValues);
          failures.push({ Code: ok ? 'None' : 'ConditionalCheckFailed' });
          continue;
        }

        if (item.Update) {
          const existing = readItem(item.Update.Key);
          const ok = evaluateCondition(item.Update.ConditionExpression, existing, item.Update.ExpressionAttributeNames, item.Update.ExpressionAttributeValues);
          failures.push({ Code: ok ? 'None' : 'ConditionalCheckFailed' });
          continue;
        }

        failures.push({ Code: 'None' });
      }

      if (failures.some((reason) => reason.Code === 'ConditionalCheckFailed')) {
        const error = new Error('Transaction cancelled');
        error.name = 'TransactionCanceledException';
        error.CancellationReasons = failures;
        throw error;
      }

      for (const item of items) {
        if (item.Put) {
          const putItem = { ...item.Put.Item };
          store.set(mapKey(putItem.PK, putItem.SK), putItem);
          continue;
        }

        if (item.Delete) {
          store.delete(mapKey(item.Delete.Key.PK, item.Delete.Key.SK));
          continue;
        }

        if (item.Update) {
          const existing = readItem(item.Update.Key);
          const next = applyUpdateExpression(existing, item.Update.UpdateExpression, item.Update.ExpressionAttributeNames, item.Update.ExpressionAttributeValues);
          store.set(mapKey(item.Update.Key.PK, item.Update.Key.SK), next);
        }
      }

      return {};
    }

    return originalSend(command);
  };

  t.after(() => {
    ddb.send = originalSend;
  });

  return store;
}

function seedBusinessProfile(store, businessId, businessName = 'OliveOps Demo') {
  store.set(
    mapKey(`BUSINESS#${businessId}`, 'PROFILE'),
    {
      PK: `BUSINESS#${businessId}`,
      SK: 'PROFILE',
      entityType: 'BUSINESS',
      businessId,
      name: businessName,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  );
}

async function createBearerTokenForUser({ businessId, userId, role, email, employeeId, token }) {
  await createMobileSessionForUser({
    user: {
      id: userId,
      businessId,
      name: 'Auth User',
      email,
      role,
      businessName: 'OliveOps Demo',
      employeeId,
    },
    accessToken: token,
    expiresInSeconds: 604800,
  });
}

test('employees can be created with no account access', async (t) => {
  installDdbMock(t);

  const owner = await createUserEmployeePair({
    businessId: 'biz-a',
    name: 'Owner One',
    email: 'owner@biza.test',
    password: 'ownerpass123',
    role: 'owner',
  });

  await createBearerTokenForUser({
    businessId: 'biz-a',
    userId: owner.user.id,
    role: 'owner',
    email: owner.user.email,
    employeeId: null,
    token: 'token-owner-a',
  });

  const req = {
    method: 'POST',
    query: { entity: 'employees' },
    headers: { authorization: 'Bearer token-owner-a' },
    body: {
      data: {
        id: 'emp-no-access',
        name: 'No Access Crew',
        email: '',
        phone: '',
        role: 'crew_member',
        hourlyRate: 32,
        compensationType: 'hourly',
        labourType: 'field_producing',
        active: true,
      },
      accountAccess: { mode: 'none' },
    },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.employee.userId, null);

  const users = await listUsersForBusiness('biz-a');
  const employees = await listEmployeesForBusiness('biz-a');
  assert.equal(users.length, 1);
  assert.equal(employees.length, 1);
});

test('owner can link existing account to employee and owner self-unlink is blocked', async (t) => {
  installDdbMock(t);

  const owner = await createUserEmployeePair({
    businessId: 'biz-link',
    name: 'Owner Link',
    email: 'owner@bizlink.test',
    password: 'ownerlink123',
    role: 'owner',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-link',
    employee: {
      id: 'emp-link',
      name: 'Linked Employee',
      email: '',
      phone: '',
      role: 'crew_member',
      hourlyRate: 30,
      compensationType: 'hourly',
      labourType: 'field_producing',
      userId: null,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-link',
    userId: owner.user.id,
    role: 'owner',
    email: owner.user.email,
    employeeId: null,
    token: 'token-owner-link',
  });

  const linkReq = {
    method: 'PATCH',
    query: { entity: 'employees', id: 'emp-link' },
    headers: { authorization: 'Bearer token-owner-link' },
    body: {
      data: {},
      accountAccess: {
        mode: 'link_existing',
        userId: owner.user.id,
      },
    },
  };
  const linkRes = createMockRes();

  await dataHandler(linkReq, linkRes);

  assert.equal(linkRes.statusCode, 200);
  assert.equal(linkRes.body.employee.userId, owner.user.id);

  const unlinkReq = {
    method: 'PATCH',
    query: { entity: 'employees', id: 'emp-link' },
    headers: { authorization: 'Bearer token-owner-link' },
    body: {
      data: {},
      accountAccess: {
        mode: 'none',
      },
    },
  };
  const unlinkRes = createMockRes();

  await dataHandler(unlinkReq, unlinkRes);

  assert.equal(unlinkRes.statusCode, 409);
  assert.equal(unlinkRes.body.ok, false);
  assert.match(unlinkRes.body.error, /cannot be unlinked/i);
});

test('create login access creates linked user + employee pair', async (t) => {
  installDdbMock(t);

  const owner = await createUserEmployeePair({
    businessId: 'biz-create-login',
    name: 'Owner Create',
    email: 'owner@create.test',
    password: 'ownercreate123',
    role: 'owner',
  });

  await createBearerTokenForUser({
    businessId: 'biz-create-login',
    userId: owner.user.id,
    role: 'owner',
    email: owner.user.email,
    employeeId: null,
    token: 'token-owner-create-login',
  });

  const req = {
    method: 'POST',
    query: { entity: 'employees' },
    headers: { authorization: 'Bearer token-owner-create-login' },
    body: {
      data: {
        id: 'emp-create-login',
        name: 'Create Login Crew',
        email: '',
        phone: '',
        role: 'foreman',
        hourlyRate: 38,
        compensationType: 'hourly',
        labourType: 'field_producing',
        active: true,
      },
      accountAccess: {
        mode: 'create_login',
        loginEmail: 'crew@create.test',
        password: 'crewpass123',
        role: 'foreman',
      },
    },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(typeof res.body.user?.id, 'string');
  assert.equal(res.body.employee.userId, res.body.user.id);

  const users = await listUsersForBusiness('biz-create-login');
  assert.equal(users.length, 2);
});

test('cross-tenant link attempt is rejected', async (t) => {
  installDdbMock(t);

  const ownerA = await createUserEmployeePair({
    businessId: 'biz-tenant-a',
    name: 'Owner A',
    email: 'owner@tenanta.test',
    password: 'ownerApass123',
    role: 'owner',
  });

  const userB = await createUserEmployeePair({
    businessId: 'biz-tenant-b',
    name: 'User B',
    email: 'user@tenantb.test',
    password: 'userBpass123',
    role: 'foreman',
  });

  await createEmployeeForBusiness({
    businessId: 'biz-tenant-a',
    employee: {
      id: 'emp-tenant-a',
      name: 'Tenant A Employee',
      email: '',
      phone: '',
      role: 'crew_member',
      hourlyRate: 25,
      compensationType: 'hourly',
      labourType: 'field_producing',
      userId: null,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  await createBearerTokenForUser({
    businessId: 'biz-tenant-a',
    userId: ownerA.user.id,
    role: 'owner',
    email: ownerA.user.email,
    employeeId: null,
    token: 'token-owner-tenant-a',
  });

  const req = {
    method: 'PATCH',
    query: { entity: 'employees', id: 'emp-tenant-a' },
    headers: { authorization: 'Bearer token-owner-tenant-a' },
    body: {
      data: {},
      accountAccess: {
        mode: 'link_existing',
        userId: userB.user.id,
      },
    },
  };
  const res = createMockRes();

  await dataHandler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /not found/i);
});

test('employee cost inputs persist for hourly and salaried compensation while foreign writes fail closed', async (t) => {
  installDdbMock(t);
  const owner = await createUserEmployeePair({
    businessId: 'biz-costs', name: 'Cost Owner', email: 'owner@costs.test', password: 'costowner123', role: 'owner',
  });
  await createEmployeeForBusiness({
    businessId: 'biz-costs',
    employee: {
      id: 'employee-costs', name: 'Cost Employee', email: '', phone: '', role: 'crew_member', hourlyRate: 25,
      compensationType: 'hourly', labourType: 'field_producing', active: true, createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
  await createEmployeeForBusiness({
    businessId: 'biz-foreign',
    employee: {
      id: 'foreign-employee', name: 'Foreign Employee', email: '', phone: '', role: 'crew_member', hourlyRate: 99,
      compensationType: 'hourly', labourType: 'field_producing', active: true, createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
  await createBearerTokenForUser({
    businessId: 'biz-costs', userId: owner.user.id, role: 'owner', email: owner.user.email, employeeId: null, token: 'token-cost-owner',
  });

  const patch = async (id, data) => {
    const res = createMockRes();
    await dataHandler({
      method: 'PATCH', query: { entity: 'employees', id }, headers: { authorization: 'Bearer token-cost-owner' }, body: { data },
    }, res);
    return res;
  };

  const hourly = await patch('employee-costs', {
    hourlyRate: 32.5, compensationType: 'hourly', payrollBurdenPct: 24, benefitsExtraCost: 2500, bonus: 1000,
  });
  assert.equal(hourly.statusCode, 200);
  assert.deepEqual({
    hourlyRate: hourly.body.employee.hourlyRate,
    compensationType: hourly.body.employee.compensationType,
    payrollBurdenPct: hourly.body.employee.payrollBurdenPct,
    benefitsExtraCost: hourly.body.employee.benefitsExtraCost,
    bonus: hourly.body.employee.bonus,
  }, { hourlyRate: 32.5, compensationType: 'hourly', payrollBurdenPct: 24, benefitsExtraCost: 2500, bonus: 1000 });

  const salary = await patch('employee-costs', { hourlyRate: 90000, compensationType: 'salary' });
  assert.equal(salary.statusCode, 200);
  assert.equal(salary.body.employee.hourlyRate, 90000);
  assert.equal(salary.body.employee.compensationType, 'salary');
  assert.equal(salary.body.employee.payrollBurdenPct, 24);

  const invalid = await patch('employee-costs', { hourlyRate: -1 });
  assert.equal(invalid.statusCode, 400);
  const foreign = await patch('foreign-employee', { hourlyRate: 1 });
  assert.equal(foreign.statusCode, 404);
  assert.equal((await getEmployeeForBusiness('biz-foreign', 'foreign-employee')).hourlyRate, 99);
});

test('Labour Classes are tenant-scoped, soft archived, and assigned independently from employee role', async (t) => {
  installDdbMock(t);
  const ownerA = await createUserEmployeePair({ businessId: 'biz-labour-a', name: 'Owner A', email: 'owner-a@labour.test', password: 'password123', role: 'owner' });
  const ownerB = await createUserEmployeePair({ businessId: 'biz-labour-b', name: 'Owner B', email: 'owner-b@labour.test', password: 'password123', role: 'owner' });
  await createBearerTokenForUser({ businessId: 'biz-labour-a', userId: ownerA.user.id, role: 'owner', email: ownerA.user.email, token: 'token-labour-a' });
  await createBearerTokenForUser({ businessId: 'biz-labour-b', userId: ownerB.user.id, role: 'owner', email: ownerB.user.email, token: 'token-labour-b' });

  const createClass = createMockRes();
  await dataHandler({ method: 'POST', query: { entity: 'labour-classes' }, headers: { authorization: 'Bearer token-labour-a' }, body: { data: { id: 'class-foreman', name: 'Foreman', description: 'Field leadership', active: true, customRates: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } } }, createClass);
  assert.equal(createClass.statusCode, 200, JSON.stringify(createClass.body));
  assert.equal(createClass.body.labourClass.name, 'Foreman');

  const duplicateClass = createMockRes();
  await dataHandler({ method: 'POST', query: { entity: 'labour-classes' }, headers: { authorization: 'Bearer token-labour-a' }, body: { data: { id: 'class-foreman-duplicate', name: '  FOREMAN ', description: '', active: true, customRates: {} } } }, duplicateClass);
  assert.equal(duplicateClass.statusCode, 400);
  assert.match(duplicateClass.body.error, /already exists/);

  const tenantAList = createMockRes();
  await dataHandler({ method: 'GET', query: { entity: 'labour-classes' }, headers: { authorization: 'Bearer token-labour-a' } }, tenantAList);
  assert.deepEqual(tenantAList.body.items.map((item) => item.id), ['class-foreman']);
  const tenantBList = createMockRes();
  await dataHandler({ method: 'GET', query: { entity: 'labour-classes' }, headers: { authorization: 'Bearer token-labour-b' } }, tenantBList);
  assert.deepEqual(tenantBList.body.items, []);

  await createEmployeeForBusiness({ businessId: 'biz-labour-a', employee: { id: 'employee-foreman', name: 'Matt Jones', email: '', phone: '', role: 'foreman', hourlyRate: 40, compensationType: 'hourly', labourType: 'field_producing', active: true } });
  await createEmployeeForBusiness({ businessId: 'biz-labour-a', employee: { id: 'employee-legacy', name: 'Legacy Employee', email: '', phone: '', role: 'crew_member', hourlyRate: 25, compensationType: 'hourly', labourType: 'field_producing', active: true } });
  const assign = createMockRes();
  await dataHandler({ method: 'PATCH', query: { entity: 'employees', id: 'employee-foreman' }, headers: { authorization: 'Bearer token-labour-a' }, body: { data: { labourClassId: 'class-foreman' } } }, assign);
  assert.equal(assign.statusCode, 200);
  assert.equal(assign.body.employee.role, 'foreman');
  assert.equal(assign.body.employee.labourClassId, 'class-foreman');
  assert.equal((await getEmployeeForBusiness('biz-labour-a', 'employee-legacy')).labourClassId, null);

  const archive = createMockRes();
  await dataHandler({ method: 'DELETE', query: { entity: 'labour-classes', id: 'class-foreman' }, headers: { authorization: 'Bearer token-labour-a' }, body: {} }, archive);
  assert.equal(archive.statusCode, 200);
  const archivedList = createMockRes();
  await dataHandler({ method: 'GET', query: { entity: 'labour-classes' }, headers: { authorization: 'Bearer token-labour-a' } }, archivedList);
  assert.equal(archivedList.body.items[0].active, false);
  assert.equal((await getEmployeeForBusiness('biz-labour-a', 'employee-foreman')).labourClassId, 'class-foreman');

  const inactiveAssignment = createMockRes();
  await dataHandler({ method: 'PATCH', query: { entity: 'employees', id: 'employee-legacy' }, headers: { authorization: 'Bearer token-labour-a' }, body: { data: { labourClassId: 'class-foreman' } } }, inactiveAssignment);
  assert.equal(inactiveAssignment.statusCode, 400);
  assert.match(inactiveAssignment.body.error, /active Labour Class/);
  const foreignAssignment = createMockRes();
  await dataHandler({ method: 'PATCH', query: { entity: 'employees', id: 'employee-legacy' }, headers: { authorization: 'Bearer token-labour-a' }, body: { data: { labourClassId: 'class-from-another-business' } } }, foreignAssignment);
  assert.equal(foreignAssignment.statusCode, 400);
});

test('guided Labour Class setup is tenant-scoped, preserving, normalized, and idempotent', async (t) => {
  const store = installDdbMock(t);
  const ownerA = await createUserEmployeePair({ businessId: 'biz-setup-a', name: 'Owner A', email: 'owner-a@setup.test', password: 'password123', role: 'owner' });
  const ownerB = await createUserEmployeePair({ businessId: 'biz-setup-b', name: 'Owner B', email: 'owner-b@setup.test', password: 'password123', role: 'owner' });
  await createBearerTokenForUser({ businessId: 'biz-setup-a', userId: ownerA.user.id, role: 'owner', email: ownerA.user.email, token: 'token-setup-a' });
  await createBearerTokenForUser({ businessId: 'biz-setup-b', userId: ownerB.user.id, role: 'owner', email: ownerB.user.email, token: 'token-setup-b' });
  await createEmployeeForBusiness({ businessId: 'biz-setup-a', employee: { id: 'setup-crew', name: 'Crew Member', email: 'crew@setup.test', phone: '555-0100', role: 'crew_member', hourlyRate: 31, compensationType: 'hourly', labourType: 'field_producing', payrollBurdenPct: 19, benefitsExtraCost: 1200, bonus: 400, active: true } });
  await createEmployeeForBusiness({ businessId: 'biz-setup-b', employee: { id: 'foreign-crew', name: 'Foreign Crew', email: '', phone: '', role: 'crew_member', hourlyRate: 99, compensationType: 'hourly', labourType: 'field_producing', active: true } });

  store.set(mapKey('BUSINESS#biz-setup-a', 'BUDGET#preserved'), { PK: 'BUSINESS#biz-setup-a', SK: 'BUDGET#preserved', marker: 'budget-unchanged' });
  store.set(mapKey('BUSINESS#biz-setup-a', 'ESTIMATE#preserved'), { PK: 'BUSINESS#biz-setup-a', SK: 'ESTIMATE#preserved', marker: 'estimate-unchanged' });

  const submit = async (classes, assignments) => {
    const response = createMockRes();
    await labourClassSetupHandler({ method: 'POST', headers: { authorization: 'Bearer token-setup-a' }, body: { classes, assignments } }, response);
    return response;
  };
  const first = await submit([{ key: 'labourer', name: 'Labourer' }], [{ employeeId: 'setup-crew', classKey: 'labourer' }]);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const savedEmployee = await getEmployeeForBusiness('biz-setup-a', 'setup-crew');
  assert.deepEqual({
    role: savedEmployee.role,
    hourlyRate: savedEmployee.hourlyRate,
    compensationType: savedEmployee.compensationType,
    payrollBurdenPct: savedEmployee.payrollBurdenPct,
    benefitsExtraCost: savedEmployee.benefitsExtraCost,
    bonus: savedEmployee.bonus,
  }, { role: 'crew_member', hourlyRate: 31, compensationType: 'hourly', payrollBurdenPct: 19, benefitsExtraCost: 1200, bonus: 400 });
  assert.ok(savedEmployee.labourClassId);

  const second = await submit([{ key: 'labourer-retry', name: '  LABOURER  ' }], [{ employeeId: 'setup-crew', classKey: 'labourer-retry' }]);
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  assert.equal((await listLabourClassesForBusiness('biz-setup-a')).length, 1);
  assert.equal((await getEmployeeForBusiness('biz-setup-a', 'setup-crew')).labourClassId, savedEmployee.labourClassId);

  const foreign = await submit([{ key: 'foreman', name: 'Foreman' }], [{ employeeId: 'foreign-crew', classKey: 'foreman' }]);
  assert.equal(foreign.statusCode, 400);
  assert.equal((await listLabourClassesForBusiness('biz-setup-a')).length, 1);
  assert.equal((await getEmployeeForBusiness('biz-setup-b', 'foreign-crew')).labourClassId, null);
  assert.equal(store.get(mapKey('BUSINESS#biz-setup-a', 'BUDGET#preserved')).marker, 'budget-unchanged');
  assert.equal(store.get(mapKey('BUSINESS#biz-setup-a', 'ESTIMATE#preserved')).marker, 'estimate-unchanged');
});

test('authenticateUser resolves linked employee by explicit userId first', async (t) => {
  const store = installDdbMock(t);
  seedBusinessProfile(store, 'biz-auth-link');

  const userResult = await createAuthUserForBusiness({
    businessId: 'biz-auth-link',
    name: 'Crew Login',
    email: 'crew@login.test',
    password: 'crewlogin123',
    role: 'crew_member',
  });

  assert.equal(userResult.ok, true);

  await createEmployeeForBusiness({
    businessId: 'biz-auth-link',
    employee: {
      id: 'emp-auth-linked',
      name: 'Linked Worker',
      email: 'contact-only@example.test',
      phone: '',
      role: 'crew_member',
      hourlyRate: 22,
      compensationType: 'hourly',
      labourType: 'field_producing',
      userId: userResult.user.id,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  const login = await authenticateUser('crew@login.test', 'crewlogin123');
  assert.equal(login.ok, true);
  assert.equal(login.user.employeeId, 'emp-auth-linked');
});

test('authenticateUser falls back to unique email match when employee.userId is null', async (t) => {
  const store = installDdbMock(t);
  seedBusinessProfile(store, 'biz-auth-fallback');

  const userResult = await createAuthUserForBusiness({
    businessId: 'biz-auth-fallback',
    name: 'Fallback User',
    email: 'fallback@login.test',
    password: 'fallback123',
    role: 'crew_member',
  });

  assert.equal(userResult.ok, true);

  await createEmployeeForBusiness({
    businessId: 'biz-auth-fallback',
    employee: {
      id: 'emp-auth-fallback',
      name: 'Fallback Worker',
      email: 'fallback@login.test',
      phone: '',
      role: 'crew_member',
      hourlyRate: 20,
      compensationType: 'hourly',
      labourType: 'field_producing',
      userId: null,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  const login = await authenticateUser('fallback@login.test', 'fallback123');
  assert.equal(login.ok, true);
  assert.equal(login.user.employeeId, 'emp-auth-fallback');

  const employee = await getEmployeeForBusiness('biz-auth-fallback', 'emp-auth-fallback');
  assert.equal(employee.userId, null);
});
