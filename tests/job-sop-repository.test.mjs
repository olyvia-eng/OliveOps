import test from 'node:test';
import assert from 'node:assert/strict';
import { ddb } from '../api/_lib/db.js';
import {
  addJobSopAssociationForBusiness,
  listJobSopAssociationsForBusiness,
  removeJobSopAssociationForBusiness,
  removeJobSopAssociationsForJob,
  removeJobSopAssociationsForSop,
} from '../api/_lib/jobSopRepo.js';

const actor = { id: 'admin-a', name: 'Admin' };

function installSequence(t, steps) {
  const original = ddb.send;
  const seen = [];
  ddb.send = async (command) => {
    seen.push(command);
    const step = steps.shift();
    assert.ok(step, `Unexpected ${command.constructor.name}`);
    assert.equal(command.constructor.name, step.command);
    if (step.error) throw step.error;
    return step.result ?? {};
  };
  t.after(() => { ddb.send = original; });
  return seen;
}

test('adding a Job SOP writes deterministic forward and reverse records atomically', async (t) => {
  const seen = installSequence(t, [
    { command: 'GetCommand' },
    { command: 'TransactWriteCommand' },
  ]);

  const association = await addJobSopAssociationForBusiness({ businessId: 'biz-a', jobId: 'job-a', sopId: 'sop-a', actor });
  assert.equal(association.sopId, 'sop-a');
  const writes = seen[1].input.TransactItems;
  assert.deepEqual(writes.map((entry) => entry.Put.Item.SK), ['JOB_SOP#job-a#sop-a', 'SOP_JOB#sop-a#job-a']);
  assert.ok(writes.every((entry) => entry.Put.Item.PK === 'BUSINESS#biz-a'));
});

test('adding an existing Job SOP is idempotent', async (t) => {
  const existing = { businessId: 'biz-a', jobId: 'job-a', sopId: 'sop-a', addedAt: '2026-01-01T00:00:00.000Z' };
  const seen = installSequence(t, [
    { command: 'GetCommand', result: { Item: { PK: 'BUSINESS#biz-a', SK: 'JOB_SOP#job-a#sop-a', entityType: 'JOB_SOP_ASSOCIATION', ...existing } } },
  ]);

  assert.deepEqual(await addJobSopAssociationForBusiness({ businessId: 'biz-a', jobId: 'job-a', sopId: 'sop-a', actor }), existing);
  assert.equal(seen.length, 1);
});

test('listing and cleanup use tenant-scoped key prefixes without scans', async (t) => {
  const record = { PK: 'BUSINESS#biz-a', SK: 'JOB_SOP#job-a#sop-a', businessId: 'biz-a', jobId: 'job-a', sopId: 'sop-a' };
  const seen = installSequence(t, [
    { command: 'QueryCommand', result: { Items: [record] } },
    { command: 'QueryCommand', result: { Items: [record] } },
    { command: 'TransactWriteCommand' },
    { command: 'QueryCommand', result: { Items: [{ ...record, SK: 'SOP_JOB#sop-a#job-a' }] } },
    { command: 'TransactWriteCommand' },
  ]);

  assert.equal((await listJobSopAssociationsForBusiness('biz-a', 'job-a')).length, 1);
  assert.equal(await removeJobSopAssociationsForJob('biz-a', 'job-a'), 1);
  assert.equal(await removeJobSopAssociationsForSop('biz-a', 'sop-a'), 1);
  assert.deepEqual(seen.filter((command) => command.constructor.name === 'QueryCommand').map((command) => command.input.ExpressionAttributeValues), [
    { ':pk': 'BUSINESS#biz-a', ':prefix': 'JOB_SOP#job-a#' },
    { ':pk': 'BUSINESS#biz-a', ':prefix': 'JOB_SOP#job-a#' },
    { ':pk': 'BUSINESS#biz-a', ':prefix': 'SOP_JOB#sop-a#' },
  ]);
});

test('removing one association deletes only its paired link records', async (t) => {
  const seen = installSequence(t, [{ command: 'TransactWriteCommand' }]);
  await removeJobSopAssociationForBusiness({ businessId: 'biz-a', jobId: 'job-a', sopId: 'sop-a' });
  assert.deepEqual(seen[0].input.TransactItems.map((entry) => entry.Delete.Key.SK), ['JOB_SOP#job-a#sop-a', 'SOP_JOB#sop-a#job-a']);
});