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
  mergeEstimateSnapshotsModel,
  nextEstimateUpdatedAtModel,
  shouldApplySequencedResponseModel,
} from '../src/utils/estimatePersistenceState.js';

const dataApiSource = readFileSync('api/data.js', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const estimatesPageSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');

function installDdbMock(t) {
  const records = new Map();
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async (command) => {
    const input = command?.input ?? {};
    const commandType = command?.constructor?.name;
    const key = input.Key ? `${input.Key.PK}|${input.Key.SK}` : null;

    if (commandType === 'PutCommand') {
      const itemKey = `${input.Item.PK}|${input.Item.SK}`;
      const expectedUpdatedAt = input.ExpressionAttributeValues?.[':expectedUpdatedAt'];
      if (expectedUpdatedAt && records.get(itemKey)?.updatedAt !== expectedUpdatedAt) {
        const error = new Error('Conditional write failed');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
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

function estimateRecord(title = 'Draft Estimate PROP-2026-0005') {
  return {
    id: 'estimate-title-1',
    customerId: 'customer-1',
    pricingBudgetId: 'budget-1',
    proposalNumber: 'PROP-2026-0005',
    title,
    description: '',
    workAreas: [{ id: 'general-1', name: 'General', description: '', sortOrder: 0, lineItems: [] }],
    status: 'draft',
    lineItems: [],
    taxRate: 13,
    notes: '',
    validUntil: '2026-09-15',
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
  };
}

test('renamed estimate title survives repository reread and tenant isolation', async (t) => {
  installDdbMock(t);
  const initial = estimateRecord();
  await createEstimateForBusiness({ businessId: 'business-a', estimate: initial });

  const renamed = {
    ...initial,
    title: 'Smith Backyard Patio',
    updatedAt: '2026-08-16T12:05:00.000Z',
  };
  await updateEstimateForBusiness({ businessId: 'business-a', estimate: renamed });

  const refreshed = await getEstimateForBusiness('business-a', initial.id);
  assert.equal(refreshed.title, 'Smith Backyard Patio');
  assert.equal(refreshed.updatedAt, renamed.updatedAt);
  assert.equal(await getEstimateForBusiness('business-b', initial.id), null);
});

test('legacy estimate naming fields map into authoritative title without adding duplicate fields', async (t) => {
  const records = installDdbMock(t);
  const legacy = estimateRecord(undefined);
  delete legacy.title;
  legacy.name = 'Legacy Retaining Wall';
  records.set('BUSINESS#business-a|ESTIMATE#estimate-title-1', {
    PK: 'BUSINESS#business-a',
    SK: 'ESTIMATE#estimate-title-1',
    entityType: 'ESTIMATE',
    businessId: 'business-a',
    estimateId: legacy.id,
    ...legacy,
  });

  const mapped = await getEstimateForBusiness('business-a', legacy.id);
  assert.equal(mapped.title, 'Legacy Retaining Wall');
  assert.equal(Object.hasOwn(mapped, 'name'), false);
});

test('estimate API and store use the persisted Estimate returned by create and update', () => {
  assert.match(dataApiSource, /entity === 'estimates' \? \{ ok: true, estimate: persistedEstimate \} : \{ ok: true \}/);
  assert.match(storeSource, /const payload = \(await response\.json\(\)\) as \{ ok\?: boolean; estimate\?: Estimate \}/);
  assert.match(storeSource, /updateEstimate: \(id: ID, data: Partial<Estimate>\) => Promise<Estimate \| null>/);
  assert.match(storeSource, /return payload\.estimate/);
});

test('stale bootstrap snapshots cannot replace a newer persisted title', () => {
  const stale = estimateRecord();
  const saved = {
    ...stale,
    title: 'Smith Backyard Patio',
    updatedAt: '2026-08-16T12:05:00.000Z',
  };

  const merged = mergeEstimateSnapshotsModel(
    [saved],
    [stale],
    Date.parse('2026-08-16T12:01:00.000Z'),
  );
  assert.equal(merged[0].title, 'Smith Backyard Patio');
  assert.strictEqual(merged[0], saved);
});

test('bootstrap retains estimates created after its request started and drops ordinary removals', () => {
  const existing = estimateRecord('Existing Estimate');
  const createdDuringRequest = {
    ...estimateRecord('New Estimate'),
    id: 'estimate-title-2',
    createdAt: '2026-08-16T12:03:00.000Z',
    updatedAt: '2026-08-16T12:03:00.000Z',
  };
  const requestStartedAt = Date.parse('2026-08-16T12:02:00.000Z');

  assert.deepEqual(
    mergeEstimateSnapshotsModel([existing, createdDuringRequest], [], requestStartedAt).map((item) => item.id),
    ['estimate-title-2'],
  );
});

test('only the latest sequenced bootstrap or mutation response may update local state', () => {
  assert.equal(shouldApplySequencedResponseModel(2, 2), true);
  assert.equal(shouldApplySequencedResponseModel(1, 2), false);
  assert.match(storeSource, /baseUpdatedAt/);
  assert.match(storeSource, /estimateMutationSequences/);
  assert.match(appSource, /businessDataRequestSequence/);
  assert.match(appSource, /mergeEstimateSnapshotsModel\(state\.estimates, payload\.estimates \?\? \[\], requestStartedAt\)/);
});

test('Estimate update versions advance even within the same millisecond', () => {
  const previous = '2026-08-16T12:00:00.000Z';
  assert.equal(
    nextEstimateUpdatedAtModel(previous, Date.parse(previous)),
    '2026-08-16T12:00:00.001Z',
  );
});

test('DynamoDB version condition rejects an older Estimate update', async (t) => {
  installDdbMock(t);
  const initial = estimateRecord();
  await createEstimateForBusiness({ businessId: 'business-a', estimate: initial });

  const saved = {
    ...initial,
    title: 'Smith Backyard Patio',
    updatedAt: '2026-08-16T12:05:00.000Z',
  };
  assert.deepEqual(
    await updateEstimateForBusiness({
      businessId: 'business-a',
      estimate: saved,
      expectedUpdatedAt: initial.updatedAt,
    }),
    { ok: true },
  );

  const staleResult = await updateEstimateForBusiness({
    businessId: 'business-a',
    estimate: { ...initial, title: 'Stale Default', updatedAt: '2026-08-16T12:04:00.000Z' },
    expectedUpdatedAt: initial.updatedAt,
  });
  assert.equal(staleResult.ok, false);
  assert.equal((await getEstimateForBusiness('business-a', initial.id)).title, 'Smith Backyard Patio');
});

test('default title is creation-only and workspace save retains failed edits', () => {
  assert.match(estimatesPageSource, /const draftTitle = `Draft Estimate \$\{proposalNumber\}`/);
  assert.match(estimatesPageSource, /title: draftTitle/);
  assert.doesNotMatch(workspaceSource, /Draft Estimate/);
  assert.match(workspaceSource, /\[id, persistedEstimateUpdatedAt\]/);
  assert.match(workspaceSource, /if \(!saved\) return;\s*setForm\(loadFormState\(saved\)\)/);
  assert.match(workspaceSource, /\{savingEstimate \? 'Saving\.\.\.' : 'Save Changes'\}/);
  assert.match(workspaceSource, /savingEstimate \|\| saveInFlight\.current/);
  assert.match(workspaceSource, /saveInFlight\.current = true/);
  assert.match(workspaceSource, /finally \{\s*saveInFlight\.current = false;\s*setSavingEstimate\(false\);\s*\}/);
});