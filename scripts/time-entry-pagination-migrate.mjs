import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from '../api/_lib/db.js';
import {
  TIME_ENTRY_INDEX_PK,
  TIME_ENTRY_INDEX_SK,
  timeEntryIndexAttributes,
} from '../api/_lib/timeEntryPagination.js';

const businessFlag = process.argv.indexOf('--business-id');
const businessId = businessFlag >= 0 ? process.argv[businessFlag + 1]?.trim() : '';
const dryRun = process.argv.includes('--dry-run');

if (!businessId) {
  console.error('Usage: npm run migrate:time-entry-pagination -- --business-id <id> [--dry-run]');
  process.exitCode = 1;
} else {
  let exclusiveStartKey;
  let inspected = 0;
  let updated = 0;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `BUSINESS#${businessId}`, ':prefix': 'TIME#' },
      ExclusiveStartKey: exclusiveStartKey,
      ConsistentRead: true,
    }));
    for (const item of result.Items ?? []) {
      inspected += 1;
      const attributes = timeEntryIndexAttributes(businessId, { id: item.entryId, ...item });
      if (item[TIME_ENTRY_INDEX_PK] === attributes[TIME_ENTRY_INDEX_PK]
        && item[TIME_ENTRY_INDEX_SK] === attributes[TIME_ENTRY_INDEX_SK]) continue;
      if (!dryRun) {
        await ddb.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET #indexPk = :indexPk, #indexSk = :indexSk',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #entityType = :entityType',
          ExpressionAttributeNames: {
            '#indexPk': TIME_ENTRY_INDEX_PK,
            '#indexSk': TIME_ENTRY_INDEX_SK,
            '#entityType': 'entityType',
          },
          ExpressionAttributeValues: {
            ':indexPk': attributes[TIME_ENTRY_INDEX_PK],
            ':indexSk': attributes[TIME_ENTRY_INDEX_SK],
            ':entityType': 'TIME_ENTRY',
          },
        }));
      }
      updated += 1;
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  console.info(JSON.stringify({ businessId, dryRun, inspected, updated }));
}