import test from 'node:test';
import assert from 'node:assert/strict';
import { ddb } from '../api/_lib/db.js';
import { deleteSopForBusiness, duplicateSopForBusiness, publishSopVersionForBusiness } from '../api/_lib/sopRepo.js';

const actor = { id: 'admin-a', name: 'Admin', email: 'admin@example.com' };
const content = {
  title: 'Lockout', category: 'Safety', shortDescription: 'Isolation steps', purpose: 'Prevent startup',
  instructions: 'Stop, isolate, and verify.', safetyInformation: 'Wear PPE.', attachmentFileIds: ['file-a'],
};

function item(record, sk) {
  return record ? { Item: { PK: 'BUSINESS#biz-a', SK: sk, entityType: 'TEST', ...record } } : {};
}

function installSequence(t, steps) {
  const original = ddb.send;
  const seen = [];
  ddb.send = async (command) => {
    seen.push(command);
    const step = steps.shift();
    assert.ok(step, `Unexpected ${command.constructor.name}`);
    assert.equal(command.constructor.name, step.command);
    return step.result ?? {};
  };
  t.after(() => { ddb.send = original; });
  return seen;
}

test('publishing writes one immutable snapshot, advances the definition, and audits atomically', async (t) => {
  const seen = installSequence(t, [
    { command: 'GetCommand', result: {} },
    { command: 'GetCommand', result: item({ id: 'sop-a', currentVersion: 1, status: 'published', active: true, ...content }, 'SOP#sop-a') },
    { command: 'TransactWriteCommand' },
  ]);

  const version = await publishSopVersionForBusiness({ businessId: 'biz-a', sopId: 'sop-a', actor, requestId: 'publish-2' });
  assert.equal(version.version, 2);
  const writes = seen[2].input.TransactItems;
  assert.equal(writes.length, 4);
  assert.equal(writes[0].Put.Item.SK, 'SOP_VERSION#sop-a#00000002');
  assert.equal(writes[0].Put.ConditionExpression, 'attribute_not_exists(PK)');
  assert.equal(writes[1].Update.ExpressionAttributeValues[':previous'], 1);
  assert.equal(writes[3].Put.Item.action, 'sop_version_published');
});

test('duplication creates only a fresh draft and its audit event in one transaction', async (t) => {
  const seen = installSequence(t, [
    { command: 'GetCommand', result: item({ id: 'sop-a', currentVersion: 3, status: 'published', active: true, ...content }, 'SOP#sop-a') },
    { command: 'GetCommand', result: {} },
    { command: 'TransactWriteCommand' },
  ]);

  const duplicate = await duplicateSopForBusiness({ businessId: 'biz-a', sopId: 'sop-a', actor, requestId: 'copy-a' });
  assert.equal(duplicate.status, 'draft');
  assert.equal(duplicate.active, false);
  assert.equal(duplicate.currentVersion, 0);
  const writes = seen[2].input.TransactItems;
  assert.equal(writes.length, 2);
  assert.equal(writes[0].Put.Item.SK, 'SOP#copy-a');
  assert.equal(writes[1].Put.Item.action, 'sop_duplicated');
});

test('permanent SOP deletion removes owned records and retains an audit event', async (t) => {
  const seen = installSequence(t, [
    { command: 'GetCommand', result: item({ id: 'sop-a', title: 'Lockout' }, 'SOP#sop-a') },
    { command: 'QueryCommand', result: { Items: [{ PK: 'BUSINESS#biz-a', SK: 'SOP_VERSION#sop-a#00000001' }] } },
    { command: 'QueryCommand', result: { Items: [{ PK: 'BUSINESS#biz-a', SK: 'SOP_PUBLISH_REQUEST#sop-a#hash' }] } },
    { command: 'QueryCommand', result: { Items: [
      { PK: 'BUSINESS#biz-a', SK: 'FILE#owned', entityType: 'sop', entityId: 'sop-a' },
      { PK: 'BUSINESS#biz-a', SK: 'FILE#other', entityType: 'sop', entityId: 'sop-b' },
    ] } },
    { command: 'TransactWriteCommand' },
    { command: 'QueryCommand', result: { Items: [] } },
    { command: 'TransactWriteCommand' },
  ]);

  const result = await deleteSopForBusiness({ businessId: 'biz-a', sopId: 'sop-a', actor });
  assert.equal(result.deletedRecordCount, 4);
  const deletes = seen[4].input.TransactItems.map((entry) => entry.Delete.Key.SK);
  assert.deepEqual(deletes, ['SOP_VERSION#sop-a#00000001', 'SOP_PUBLISH_REQUEST#sop-a#hash', 'FILE#owned']);
  assert.equal(seen[5].input.ExpressionAttributeValues[':prefix'], 'SOP_JOB#sop-a#');
  assert.equal(seen[6].input.TransactItems[0].Delete.Key.SK, 'SOP#sop-a');
  assert.equal(seen[6].input.TransactItems[1].Put.Item.action, 'sop_deleted');
});