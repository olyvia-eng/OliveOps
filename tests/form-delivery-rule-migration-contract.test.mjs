import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFormDeliveryRuleMigrationArgs,
  runFormDeliveryRuleMigration,
} from '../scripts/form-delivery-rule-migration.mjs';

const legacyForm = (overrides = {}) => ({
  PK: 'BUSINESS#biz-1',
  SK: 'FORM#form-1',
  entityType: 'FORM',
  businessId: 'biz-1',
  formId: 'form-1',
  trigger: ['before_clock_in'],
  completionRequirement: 'required',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

test('CLI arguments require a tenant and default to dry-run', () => {
  assert.deepEqual(parseFormDeliveryRuleMigrationArgs(['node', 'script', '--business-id', ' biz-1 ']), {
    apply: false,
    businessId: 'biz-1',
  });
  assert.deepEqual(parseFormDeliveryRuleMigrationArgs(['node', 'script', '--business-id', 'biz-1', '--apply']), {
    apply: true,
    businessId: 'biz-1',
  });
  assert.throws(() => parseFormDeliveryRuleMigrationArgs(['node', 'script']), /business-id is required/);
  assert.throws(
    () => parseFormDeliveryRuleMigrationArgs(['node', 'script', '--business-id', 'biz-1', '--apply', '--dry-run']),
    /cannot be used together/,
  );
});

test('dry-run paginates tenant Form queries and performs no updates', async () => {
  const commands = [];
  const pages = [
    {
      Items: [
        legacyForm(),
        legacyForm({
          SK: 'FORM#form-2',
          formId: 'form-2',
          deliveryRule: {
            type: 'always_available', frequency: null, completionBehavior: 'manual', schedule: null, allowManualAccess: true,
          },
        }),
      ],
      LastEvaluatedKey: { PK: 'BUSINESS#biz-1', SK: 'FORM#form-2' },
    },
    { Items: [legacyForm({ SK: 'FORM#form-3', formId: 'form-3', trigger: ['before_clock_in', 'daily'] })] },
  ];
  const client = {
    async send(command) {
      commands.push(command);
      assert.equal(command.constructor.name, 'QueryCommand');
      return pages.shift();
    },
  };

  const report = await runFormDeliveryRuleMigration({ businessId: 'biz-1', client, tableName: 'test-table' });

  assert.equal(commands.length, 2);
  assert.equal(commands[0].input.KeyConditionExpression, 'PK = :pk AND begins_with(SK, :prefix)');
  assert.deepEqual(commands[0].input.ExpressionAttributeValues, { ':pk': 'BUSINESS#biz-1', ':prefix': 'FORM#' });
  assert.deepEqual(commands[1].input.ExclusiveStartKey, { PK: 'BUSINESS#biz-1', SK: 'FORM#form-2' });
  assert.deepEqual({
    mode: report.mode,
    inspected: report.inspected,
    wouldMigrate: report.wouldMigrate,
    migrated: report.migrated,
    unchanged: report.unchanged,
    needsReview: report.needsReview,
  }, {
    mode: 'dry-run', inspected: 3, wouldMigrate: 1, migrated: 0, unchanged: 1, needsReview: 1,
  });
});

test('apply updates only canonical fields and treats stale records as conflicts', async () => {
  const updates = [];
  let queryComplete = false;
  const client = {
    async send(command) {
      if (command.constructor.name === 'QueryCommand') {
        assert.equal(queryComplete, false);
        queryComplete = true;
        return { Items: [legacyForm(), legacyForm({ SK: 'FORM#form-2', formId: 'form-2' })] };
      }
      updates.push(command.input);
      if (updates.length === 2) {
        const error = new Error('stale');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
      return {};
    },
  };

  const report = await runFormDeliveryRuleMigration({
    apply: true,
    businessId: 'biz-1',
    client,
    tableName: 'test-table',
    now: () => '2026-09-05T12:00:00.000Z',
  });

  assert.equal(updates.length, 2);
  assert.match(updates[0].UpdateExpression, /#deliveryRule = :deliveryRule/);
  assert.match(updates[0].ConditionExpression, /attribute_not_exists\(#deliveryRule\)/);
  assert.match(updates[0].ConditionExpression, /#updatedAt = :expectedUpdatedAt/);
  assert.equal(updates[0].ExpressionAttributeValues[':businessId'], 'biz-1');
  assert.equal(updates[0].ExpressionAttributeValues[':expectedUpdatedAt'], '2026-01-01T00:00:00.000Z');
  assert.deepEqual({ migrated: report.migrated, conflicts: report.conflicts }, { migrated: 1, conflicts: 1 });
});

test('apply protects legacy records that have no updatedAt value', async () => {
  let update;
  const client = {
    async send(command) {
      if (command.constructor.name === 'QueryCommand') {
        const item = legacyForm();
        delete item.updatedAt;
        return { Items: [item] };
      }
      update = command.input;
      return {};
    },
  };

  await runFormDeliveryRuleMigration({ apply: true, businessId: 'biz-1', client, tableName: 'test-table' });

  assert.match(update.ConditionExpression, /attribute_not_exists\(#updatedAt\)/);
  assert.equal(':expectedUpdatedAt' in update.ExpressionAttributeValues, false);
});