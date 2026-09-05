import { ddb, tableName } from '../api/_lib/db.js';
import {
  parseFormDeliveryRuleMigrationArgs,
  runFormDeliveryRuleMigration,
} from './form-delivery-rule-migration.mjs';

try {
  const options = parseFormDeliveryRuleMigrationArgs(process.argv);
  const report = await runFormDeliveryRuleMigration({
    ...options,
    client: ddb,
    tableName,
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Form delivery-rule migration failed.');
  console.error('Usage: npm run migrate:form-delivery-rules -- --business-id <id> [--apply]');
  process.exitCode = 1;
}