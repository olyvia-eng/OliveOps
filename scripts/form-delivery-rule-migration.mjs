import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { planFormDeliveryRuleMigration } from '../src/utils/formDeliveryRuleMigration.js';

export function parseFormDeliveryRuleMigrationArgs(argv) {
  const options = { apply: false, businessId: '' };
  let dryRunFlag = false;

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') options.apply = true;
    else if (value === '--dry-run') dryRunFlag = true;
    else if (value === '--business-id') {
      options.businessId = argv[index + 1]?.trim() ?? '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!options.businessId) throw new Error('--business-id is required.');
  if (options.apply && dryRunFlag) throw new Error('--apply and --dry-run cannot be used together.');
  return options;
}

function isConditionalConflict(error) {
  return error?.name === 'ConditionalCheckFailedException';
}

function formUpdateCommand({ tableName, businessId, item, updates, migratedAt }) {
  const hasUpdatedAt = Object.hasOwn(item, 'updatedAt') && item.updatedAt !== undefined;
  const updatedAtCondition = hasUpdatedAt
    ? '#updatedAt = :expectedUpdatedAt'
    : 'attribute_not_exists(#updatedAt)';

  return new UpdateCommand({
    TableName: tableName,
    Key: { PK: item.PK, SK: item.SK },
    UpdateExpression: 'SET #deliveryRule = :deliveryRule, #deliveryRuleVersion = :deliveryRuleVersion, #trigger = :trigger, #completionRequirement = :completionRequirement, #updatedAt = :migratedAt',
    ConditionExpression: `attribute_exists(PK) AND attribute_exists(SK) AND #entityType = :entityType AND #businessId = :businessId AND attribute_not_exists(#deliveryRule) AND ${updatedAtCondition}`,
    ExpressionAttributeNames: {
      '#businessId': 'businessId',
      '#completionRequirement': 'completionRequirement',
      '#deliveryRule': 'deliveryRule',
      '#deliveryRuleVersion': 'deliveryRuleVersion',
      '#entityType': 'entityType',
      '#trigger': 'trigger',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':businessId': businessId,
      ':completionRequirement': updates.completionRequirement,
      ':deliveryRule': updates.deliveryRule,
      ':deliveryRuleVersion': updates.deliveryRuleVersion,
      ':entityType': 'FORM',
      ':migratedAt': migratedAt,
      ':trigger': updates.trigger,
      ...(hasUpdatedAt ? { ':expectedUpdatedAt': item.updatedAt } : {}),
    },
  });
}

export async function runFormDeliveryRuleMigration({
  apply = false,
  businessId,
  client,
  tableName,
  now = () => new Date().toISOString(),
}) {
  if (typeof businessId !== 'string' || !businessId.trim()) throw new Error('businessId is required.');
  if (!client || typeof client.send !== 'function') throw new Error('A DynamoDB document client is required.');
  if (typeof tableName !== 'string' || !tableName) throw new Error('tableName is required.');

  const scopedBusinessId = businessId.trim();
  const report = {
    businessId: scopedBusinessId,
    mode: apply ? 'apply' : 'dry-run',
    inspected: 0,
    wouldMigrate: 0,
    migrated: 0,
    unchanged: 0,
    needsReview: 0,
    errors: 0,
    conflicts: 0,
    details: [],
  };
  let exclusiveStartKey;

  do {
    const page = await client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `BUSINESS#${scopedBusinessId}`,
        ':prefix': 'FORM#',
      },
      ExclusiveStartKey: exclusiveStartKey,
      ConsistentRead: true,
    }));

    for (const item of page.Items ?? []) {
      report.inspected += 1;
      const formId = item.formId ?? item.SK?.slice('FORM#'.length);

      if (item.businessId !== scopedBusinessId || item.entityType !== 'FORM' || !formId) {
        report.errors += 1;
        report.details.push({ formId: formId ?? null, status: 'error', message: 'Form identity or tenant metadata is invalid.' });
        continue;
      }

      const plan = planFormDeliveryRuleMigration({ ...item, formId });
      if (plan.action === 'unchanged') {
        report.unchanged += 1;
        continue;
      }
      if (plan.action === 'needs_review') {
        report.needsReview += 1;
        report.details.push({ formId, status: 'needs-review', message: plan.error });
        continue;
      }
      if (plan.action === 'error') {
        report.errors += 1;
        report.details.push({ formId, status: 'error', message: plan.error });
        continue;
      }

      report.wouldMigrate += 1;
      if (!apply) {
        report.details.push({ formId, status: 'would-migrate' });
        continue;
      }

      try {
        await client.send(formUpdateCommand({
          tableName,
          businessId: scopedBusinessId,
          item,
          updates: plan.updates,
          migratedAt: now(),
        }));
        report.migrated += 1;
        report.details.push({ formId, status: 'migrated' });
      } catch (error) {
        if (!isConditionalConflict(error)) throw error;
        report.conflicts += 1;
        report.details.push({ formId, status: 'conflict', message: 'Form changed after it was read; no migration update was applied.' });
      }
    }

    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return report;
}