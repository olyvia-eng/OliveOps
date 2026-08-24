import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('api/_lib/authRepo.js', 'utf8');

test('Time Off creation atomically persists durable idempotency, request, and safe audit event', () => {
  assert.match(source, /TIME_OFF_IDEMPOTENCY#/);
  assert.match(source, /TIME_OFF_REQUEST#/);
  assert.match(source, /new TransactWriteCommand\(\{ TransactItems: \[/);
  assert.match(source, /action: 'time_off_request_created'/);
  assert.match(source, /payloadFingerprint/);
  assert.match(source, /ttl/);
  assert.doesNotMatch(source, /metadata: \{[^}]*employeeNote/s);
});

test('review and cancellation condition on pending and return transaction conflicts', () => {
  assert.match(source, /ConditionExpression: 'attribute_exists\(PK\) AND attribute_exists\(SK\) AND #status = :pending'/);
  for (const action of ['time_off_request_approved', 'time_off_request_denied', 'time_off_request_cancelled']) assert.match(source, new RegExp(action));
  assert.match(source, /TransactionCanceledException/);
});

test('future scheduling has an inclusive approved overlap repository query', () => {
  assert.match(source, /listApprovedTimeOffOverlappingForBusiness/);
  assert.match(source, /approvedTimeOffOverlapping\(await listTimeOffRequestsForBusiness/);
});
