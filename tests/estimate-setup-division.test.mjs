import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import dataHandler from '../api/data.js';
import { ddb } from '../api/_lib/db.js';
import { createMobileSessionForUser } from '../api/_lib/authRepo.js';
import { activeDivisionsForBudget, resolveEstimateDivisionId } from '../src/pages/estimates/estimateSetupModel.js';

const estimatesPageSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const dataApiSource = readFileSync('api/data.js', 'utf8');

const divisions = [
  { id: 'snow', budgetId: 'budget-a', name: 'Snow', status: 'active', sortOrder: 2 },
  { id: 'landscape', budgetId: 'budget-a', name: 'Landscape', status: 'active', sortOrder: 1 },
  { id: 'archived-a', budgetId: 'budget-a', name: 'Archived', status: 'archived', sortOrder: 0 },
  { id: 'concrete', budgetId: 'budget-b', name: 'Concrete', status: 'active', sortOrder: 0 },
];

function createMockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function installDdbMock(t) {
  const records = new Map();
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const input = command?.input ?? {};
    const commandType = command?.constructor?.name;
    const key = input.Key ? `${input.Key.PK}|${input.Key.SK}` : null;
    if (commandType === 'PutCommand') {
      records.set(`${input.Item.PK}|${input.Item.SK}`, structuredClone(input.Item));
      return {};
    }
    if (commandType === 'GetCommand') {
      return { Item: key && records.has(key) ? structuredClone(records.get(key)) : undefined };
    }
    if (commandType === 'QueryCommand') {
      const pk = input.ExpressionAttributeValues[':pk'];
      const prefix = input.ExpressionAttributeValues[':prefix'];
      return { Items: [...records.values()].filter((item) => item.PK === pk && item.SK.startsWith(prefix)).map(structuredClone) };
    }
    return originalSend(command);
  };
  t.after(() => { ddb.send = originalSend; });
  return records;
}

function seed(records, businessId, sk, record) {
  records.set(`BUSINESS#${businessId}|${sk}`, { PK: `BUSINESS#${businessId}`, SK: sk, businessId, ...record });
}

function estimate(id, budgetId, divisionId) {
  return {
    id,
    customerId: 'customer-a',
    pricingBudgetId: budgetId,
    proposalNumber: `PROP-2026-${id}`,
    title: 'Driveway Estimate',
    description: '',
    workAreas: [{ id: `area-${id}`, divisionId, name: 'General', description: '', sortOrder: 0, lineItems: [] }],
    lineItems: [],
    status: 'draft',
    taxRate: 13,
    notes: '',
    validUntil: '2026-09-30',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

async function postEstimate(data) {
  const response = createMockRes();
  await dataHandler({ method: 'POST', query: { entity: 'estimates' }, headers: { authorization: 'Bearer estimate-setup-token' }, body: { data } }, response);
  return response;
}

test('Division stays hidden until a Pricing Budget is selected without disturbing Customer or Property', () => {
  assert.match(estimatesPageSource, /createForm\.pricingBudgetId && pricingDivisions\.length > 0 \? \(/);
  assert.match(estimatesPageSource, /label="Customer"[\s\S]*label="Pricing Budget"[\s\S]*createForm\.pricingBudgetId[\s\S]*label="Division"[\s\S]*label="Property \(optional\)"[\s\S]*label="Proposal Number"/);
  assert.match(estimatesPageSource, /customerId: event\.target\.value, propertyRef: ''/);
  assert.match(estimatesPageSource, /selectedProperty \? formatPropertyAddress\(selectedProperty\) : ''/);
});

test('Pricing Budget selection exposes only its active Divisions in deterministic order', () => {
  assert.deepEqual(activeDivisionsForBudget(divisions, ''), []);
  assert.deepEqual(activeDivisionsForBudget(divisions, 'budget-a').map((division) => division.id), ['landscape', 'snow']);
  assert.deepEqual(activeDivisionsForBudget(divisions, 'budget-b').map((division) => division.id), ['concrete']);
  assert.equal(activeDivisionsForBudget(divisions, 'budget-a').some((division) => division.id === 'concrete'), false);
  assert.equal(activeDivisionsForBudget(divisions, 'budget-a').some((division) => division.id === 'archived-a'), false);
});

test('Budget changes clear stale Divisions while one active Division auto-selects', () => {
  const budgetA = activeDivisionsForBudget(divisions, 'budget-a');
  const budgetB = activeDivisionsForBudget(divisions, 'budget-b');
  assert.equal(resolveEstimateDivisionId('concrete', budgetA), '');
  assert.equal(resolveEstimateDivisionId('landscape', budgetA), 'landscape');
  assert.equal(resolveEstimateDivisionId('', budgetA), '');
  assert.equal(resolveEstimateDivisionId('', budgetB), 'concrete');
  assert.equal(resolveEstimateDivisionId('stale', []), '');
  assert.match(estimatesPageSource, /pricingBudgetId: event\.target\.value, divisionId: ''/);
});

test('multiple or zero active Divisions prevent creation until a valid choice exists', () => {
  assert.equal(resolveEstimateDivisionId('', activeDivisionsForBudget(divisions, 'budget-a')), '');
  assert.match(estimatesPageSource, /This Budget has no active Divisions\./);
  assert.match(estimatesPageSource, /disabled=\{creatingEstimate \|\| !canCreateEstimate\}/);
  assert.match(estimatesPageSource, /selectedDivisionIsValid/);
});

test('Estimate API accepts an active matching Division and rejects stale Budget relationships', async (t) => {
  const records = installDdbMock(t);
  seed(records, 'biz-a', 'USER#user-a', { entityType: 'USER', userId: 'user-a', name: 'Admin', email: 'admin@example.com', role: 'admin', active: true, passwordHash: 'hash' });
  seed(records, 'biz-a', 'BUDGET_META#budget-a', { entityType: 'BUDGET', budgetId: 'budget-a', id: 'budget-a', name: 'Budget A', planningModel: 'divisions_v1', status: 'active' });
  seed(records, 'biz-a', 'BUDGET_META#budget-b', { entityType: 'BUDGET', budgetId: 'budget-b', id: 'budget-b', name: 'Budget B', planningModel: 'divisions_v1', status: 'active' });
  seed(records, 'biz-a', 'BUDGET_DIVISION#budget-a#DIVISION#active-a', { entityType: 'BUDGET_DIVISION', budgetId: 'budget-a', divisionId: 'active-a', id: 'active-a', name: 'Active A', status: 'active' });
  seed(records, 'biz-a', 'BUDGET_DIVISION#budget-a#DIVISION#inactive-a', { entityType: 'BUDGET_DIVISION', budgetId: 'budget-a', divisionId: 'inactive-a', id: 'inactive-a', name: 'Inactive A', status: 'archived' });
  seed(records, 'biz-a', 'BUDGET_DIVISION#budget-b#DIVISION#active-b', { entityType: 'BUDGET_DIVISION', budgetId: 'budget-b', divisionId: 'active-b', id: 'active-b', name: 'Active B', status: 'active' });
  seed(records, 'biz-b', 'BUDGET_DIVISION#budget-a#DIVISION#foreign', { entityType: 'BUDGET_DIVISION', budgetId: 'budget-a', divisionId: 'foreign', id: 'foreign', name: 'Foreign', status: 'active' });
  await createMobileSessionForUser({ user: { id: 'user-a', businessId: 'biz-a', name: 'Admin', email: 'admin@example.com', role: 'admin', businessName: 'Business A' }, accessToken: 'estimate-setup-token', expiresInSeconds: 3600 });

  const accepted = await postEstimate(estimate('valid', 'budget-a', 'active-a'));
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.estimate.workAreas[0].divisionId, 'active-a');
  assert.equal(records.has('BUSINESS#biz-a|ESTIMATE#valid'), true);

  for (const [id, budgetId, divisionId] of [
    ['cross-budget', 'budget-a', 'active-b'],
    ['inactive', 'budget-a', 'inactive-a'],
    ['foreign', 'budget-a', 'foreign'],
    ['missing', 'budget-a', ''],
  ]) {
    const rejected = await postEstimate(estimate(id, budgetId, divisionId));
    assert.equal(rejected.statusCode, 400);
    assert.match(rejected.body.error, /Division/);
    assert.equal(records.has(`BUSINESS#biz-a|ESTIMATE#${id}`), false);
  }

  assert.match(dataApiSource, /getBudgetDivisionForBusiness\(businessId, estimate\.pricingBudgetId, area\.divisionId\)/);
  assert.match(estimatesPageSource, /if \(!estimateId\) return;\s*setCreateModalOpen\(false\);\s*navigate\(`\/estimates\/\$\{estimateId\}`\)/);
});