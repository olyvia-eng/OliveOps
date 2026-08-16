import test from 'node:test';
import assert from 'node:assert/strict';

import { createEstimatesHandler } from '../api/estimates.js';
import { ddb } from '../api/_lib/db.js';
import { getJobForBusiness, listJobsForBusiness } from '../api/_lib/authRepo.js';

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

      const equalityMatch = /^(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)$/.exec(clause);
      if (equalityMatch) {
        if (!existing) return false;
        const fieldName = resolveName(equalityMatch[1], names);
        const expectedValue = resolveValue(equalityMatch[2], values);
        if (existing[fieldName] !== expectedValue) return false;
        continue;
      }

      const absentMatch = /^attribute_not_exists\((#[A-Za-z0-9_]+)\)$/.exec(clause);
      if (absentMatch) {
        const fieldName = resolveName(absentMatch[1], names);
        if (existing && typeof existing[fieldName] !== 'undefined') return false;
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

    if (commandType === 'GetCommand') {
      return { Item: readItem(input.Key) };
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

        if (item.Update) {
          const existing = readItem(item.Update.Key);
          const next = applyUpdateExpression(
            existing,
            item.Update.UpdateExpression,
            item.Update.ExpressionAttributeNames,
            item.Update.ExpressionAttributeValues
          );
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

function seedEstimate(store, { businessId, estimateId, customerId }) {
  const createdAt = '2026-08-08T12:00:00.000Z';
  store.set(
    mapKey(`BUSINESS#${businessId}`, `ESTIMATE#${estimateId}`),
    {
      PK: `BUSINESS#${businessId}`,
      SK: `ESTIMATE#${estimateId}`,
      entityType: 'ESTIMATE',
      businessId,
      estimateId,
      customerId,
      proposalNumber: 'EST-2026-0021',
      title: 'Front Entry Remodel',
      description: 'Remodel the front entry and landing.',
      workAreas: [
        {
          id: 'wa-1',
          name: 'Front Entry',
          description: 'Demolition and rebuild',
          sortOrder: 0,
          lineItems: [
            {
              id: 'li-1',
              category: 'labour',
              description: 'Crew labor',
              quantity: 16,
              unit: 'hr',
              unitCost: 55,
              markupPercent: 20,
              sellPrice: 66,
              total: 1056,
            },
            {
              id: 'li-2',
              category: 'material',
              description: 'Composite decking',
              quantity: 1,
              unit: 'lot',
              unitCost: 900,
              markupPercent: 10,
              sellPrice: 990,
              total: 990,
            },
          ],
        },
      ],
      pricingBudgetId: 'budget-1',
      propertyLabel: 'Smith Residence',
      propertyAddressSnapshot: {
        line1: '123 Main St',
        city: 'Nashville',
        state: 'TN',
        postalCode: '37203',
      },
      status: 'accepted',
      taxRate: 9.25,
      notes: 'Preserve existing railing where possible.',
      createdAt,
      updatedAt: createdAt,
      validUntil: '2026-08-31',
    }
  );
}

test('converted job is persisted in canonical job format and returned by the normal jobs list query', async (t) => {
  const store = installDdbMock(t);
  seedEstimate(store, { businessId: 'biz-1', estimateId: 'est-1', customerId: 'customer-1' });

  const handler = createEstimatesHandler({
    requireSession: async () => ({
      id: 'user-foreman-1',
      name: 'Casey Foreman',
      email: 'casey@example.com',
      role: 'foreman',
      businessId: 'biz-1',
      employeeId: 'emp-1',
    }),
    reserveNextJobNumberForBusiness: async () => 'JOB-2026-0008',
  });

  const req = {
    method: 'POST',
    query: { action: 'convert-to-job' },
    body: {
      estimateId: 'est-1',
      title: 'Front Entry Job',
      startDate: '2026-08-15',
      endDate: '2026-08-20',
    },
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.job.jobNumber, 'JOB-2026-0008');
  assert.equal(res.body.job.sourceEstimateId, 'est-1');
  assert.equal(res.body.job.customerId, 'customer-1');
  assert.equal(res.body.job.propertyLabel, 'Smith Residence');
  assert.equal(res.body.job.title, 'Front Entry Job');
  assert.equal(res.body.job.status, 'scheduled');
  assert.equal(res.body.job.startDate, '2026-08-15');
  assert.equal(res.body.job.endDate, '2026-08-20');
  assert.equal(res.body.job.convertedByUserId, 'user-foreman-1');
  assert.equal(res.body.job.convertedToJobId, undefined);
  assert.deepEqual(res.body.job.workAreas, ['Front Entry']);
  assert.equal(res.body.estimate.convertedToJobId, res.body.job.id);

  const persistedJob = await getJobForBusiness('biz-1', res.body.job.id);
  assert.ok(persistedJob);
  assert.equal(persistedJob.jobNumber, 'JOB-2026-0008');
  assert.equal(persistedJob.sourceEstimateId, 'est-1');
  assert.equal(persistedJob.customerId, 'customer-1');
  assert.equal(persistedJob.propertyLabel, 'Smith Residence');
  assert.equal(persistedJob.pricingBudgetId, 'budget-1');
  assert.equal(persistedJob.status, 'scheduled');
  assert.equal(persistedJob.startDate, '2026-08-15');
  assert.equal(persistedJob.endDate, '2026-08-20');
  assert.equal(persistedJob.convertedByUserId, 'user-foreman-1');
  assert.equal(persistedJob.convertedByUserName, 'Casey Foreman');
  assert.equal(persistedJob.convertedFromEstimateAt, res.body.estimate.convertedAt);
  assert.equal(persistedJob.contractValue, 2235.255);
  assert.equal(persistedJob.estimatedCost, 1780);
  assert.equal(persistedJob.originalEstimateSnapshot.estimateId, 'est-1');
  assert.equal(persistedJob.originalEstimateSnapshot.proposalNumber, 'EST-2026-0021');
  assert.equal(persistedJob.originalEstimateSnapshot.total, 2235.255);
  assert.equal(persistedJob.operationalWorkAreas.length, 1);
  assert.equal(persistedJob.operationalWorkAreas[0].lineItems.length, 2);
  assert.equal(persistedJob.operationalWorkAreas[0].estimatedCost, 1780);
  assert.equal(persistedJob.operationalWorkAreas[0].estimatedRevenue, 2046);
  assert.equal(persistedJob.operationalWorkAreas[0].estimatedMargin, 266);

  const businessJobs = await listJobsForBusiness('biz-1');
  assert.equal(businessJobs.length, 1);
  assert.equal(businessJobs[0].id, res.body.job.id);
  assert.equal(businessJobs[0].sourceEstimateId, 'est-1');
  assert.equal(businessJobs[0].jobNumber, 'JOB-2026-0008');

  const otherTenantJobs = await listJobsForBusiness('biz-2');
  assert.deepEqual(otherTenantJobs, []);
});