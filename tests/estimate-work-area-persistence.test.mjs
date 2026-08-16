import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ddb } from '../api/_lib/db.js';
import {
  createEstimateForBusiness,
  getEstimateForBusiness,
  updateEstimateForBusiness,
} from '../api/_lib/authRepo.js';
import {
  createDefaultEstimateWorkAreaModel,
  ensureDefaultEstimateWorkAreaModel,
  legacyEstimateWorkAreaIdModel,
} from '../src/utils/estimateWorkAreaIdentity.js';

const estimatesPageSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const builderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');
const dataApiSource = readFileSync('api/data.js', 'utf8');

function installDdbMock(t) {
  const records = new Map();
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const input = command?.input ?? {};
    const commandType = command?.constructor?.name;
    const key = input.Key ? `${input.Key.PK}|${input.Key.SK}` : null;

    if (commandType === 'PutCommand') {
      const itemKey = `${input.Item.PK}|${input.Item.SK}`;
      records.set(itemKey, structuredClone(input.Item));
      return {};
    }
    if (commandType === 'GetCommand') {
      return { Item: key && records.has(key) ? structuredClone(records.get(key)) : undefined };
    }
    return originalSend(command);
  };
  t.after(() => {
    ddb.send = originalSend;
  });
  return records;
}

function estimateRecord(workAreas) {
  return {
    id: 'estimate-1',
    customerId: 'customer-1',
    pricingBudgetId: 'budget-1',
    proposalNumber: 'PROP-2026-0001',
    title: 'Driveway Estimate',
    description: '',
    workAreas,
    status: 'draft',
    lineItems: [],
    taxRate: 13,
    notes: '',
    validUntil: '2026-09-15',
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
  };
}

test('new estimate default General uses one stable unique ID and is not duplicated', () => {
  let sequence = 0;
  const generateId = () => `work-area-${++sequence}`;
  const general = createDefaultEstimateWorkAreaModel(generateId);
  const second = createDefaultEstimateWorkAreaModel(generateId);

  assert.equal(general.name, 'General');
  assert.equal(general.id, 'work-area-1');
  assert.equal(second.id, 'work-area-2');
  assert.notEqual(general.id, second.id);

  const estimate = estimateRecord([general]);
  const ensured = ensureDefaultEstimateWorkAreaModel(estimate, generateId);
  assert.strictEqual(ensured, estimate);
  assert.equal(ensured.workAreas.length, 1);
  assert.equal(ensured.workAreas[0].id, general.id);
});

test('empty API estimate input receives one persisted General while legacy IDs stay deterministic', () => {
  let sequence = 0;
  const ensured = ensureDefaultEstimateWorkAreaModel(estimateRecord([]), () => `api-area-${++sequence}`);
  assert.equal(ensured.workAreas.length, 1);
  assert.equal(ensured.workAreas[0].name, 'General');
  assert.equal(ensured.workAreas[0].id, 'api-area-1');

  const firstLegacyId = legacyEstimateWorkAreaIdModel('estimate-legacy', 'legacy scope', () => 'unused');
  const refreshedLegacyId = legacyEstimateWorkAreaIdModel('estimate-legacy', 'legacy scope', () => 'unused');
  assert.equal(firstLegacyId, refreshedLegacyId);
  assert.match(firstLegacyId, /^legacy-wa-[a-z0-9]+$/);
  assert.doesNotMatch(firstLegacyId, /general|work-area-1|estimate-legacy/);
});

test('persisted General survives refresh/direct lookup and remains tenant isolated', async (t) => {
  installDdbMock(t);
  const general = createDefaultEstimateWorkAreaModel(() => 'general-persisted-id');
  const estimate = estimateRecord([general]);

  await createEstimateForBusiness({ businessId: 'business-a', estimate });
  const firstRead = await getEstimateForBusiness('business-a', estimate.id);
  const refreshRead = await getEstimateForBusiness('business-a', estimate.id);

  assert.equal(firstRead.workAreas.length, 1);
  assert.equal(firstRead.workAreas[0].id, 'general-persisted-id');
  assert.equal(refreshRead.workAreas[0].id, firstRead.workAreas[0].id);
  assert.equal(refreshRead.workAreas[0].name, 'General');
  assert.equal(await getEstimateForBusiness('business-b', estimate.id), null);
});

test('adding and deleting embedded work areas preserves distinct authoritative IDs', async (t) => {
  installDdbMock(t);
  const general = createDefaultEstimateWorkAreaModel(() => 'general-id');
  const patio = { ...createDefaultEstimateWorkAreaModel(() => 'patio-id'), name: 'Patio', sortOrder: 1 };
  const estimate = estimateRecord([general]);
  await createEstimateForBusiness({ businessId: 'business-a', estimate });

  await updateEstimateForBusiness({ businessId: 'business-a', estimate: { ...estimate, workAreas: [general, patio] } });
  const afterAdd = await getEstimateForBusiness('business-a', estimate.id);
  assert.deepEqual(afterAdd.workAreas.map((area) => area.id), ['general-id', 'patio-id']);

  await updateEstimateForBusiness({ businessId: 'business-a', estimate: { ...afterAdd, workAreas: [patio] } });
  const afterDelete = await getEstimateForBusiness('business-a', estimate.id);
  assert.deepEqual(afterDelete.workAreas.map((area) => area.id), ['patio-id']);
  assert.equal(afterDelete.workAreas.find((area) => area.id === 'general-id'), undefined);
});

test('creation, navigation, add, and delete flows use persisted embedded IDs', () => {
  assert.match(estimatesPageSource, /const generalWorkArea = createDefaultEstimateWorkArea\(\)/);
  assert.match(estimatesPageSource, /const estimateId = await addEstimate\(\{/);
  assert.match(estimatesPageSource, /workAreas: \[generalWorkArea\]/);
  assert.match(estimatesPageSource, /if \(!estimateId\) return;\s*setCreateModalOpen\(false\);\s*navigate\(`\/estimates\/\$\{estimateId\}`\)/);
  assert.match(storeSource, /addEstimate: async \(e\) =>/);
  assert.match(storeSource, /const response = await fetch\(dataUrl\('estimates'\)/);
  assert.match(storeSource, /if \(!payload\.ok \|\| !payload\.estimate\)/);
  assert.match(storeSource, /estimates: \[\.\.\.s\.estimates, payload\.estimate as Estimate\]/);
  assert.match(dataApiSource, /record = ensureDefaultEstimateWorkArea\(record\)/);

  assert.match(workspaceSource, /createNewEstimateWorkArea\(form\.workAreas\)/);
  assert.match(workspaceSource, /saved = await persistEstimateForm\(nextForm\)/);
  assert.match(workspaceSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{nextWorkArea\.id\}`\)/);
  assert.match(workspaceSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{workArea\.id\}`\)/);

  assert.match(builderSource, /workAreas\.find\(\(area\) => area\.id === workAreaId\)/);
  assert.match(builderSource, /filter\(\(area\) => area\.id !== workArea\.id\)/);
  assert.match(builderSource, /await updateEstimate\(estimate\.id, payload\)/);
});
