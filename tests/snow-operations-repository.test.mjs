import test from 'node:test';
import assert from 'node:assert/strict';

import { ddb } from '../api/_lib/db.js';
import { commitSnowIdempotentMutation } from '../api/_lib/snowRepo.js';

function installDdb(t, responder) {
  const original = ddb.send;
  const commands = [];
  ddb.send = async (command) => { commands.push(command); return responder(command, commands); };
  t.after(() => { ddb.send = original; });
  return commands;
}

const route = { id: 'route-a', snowEventId: 'event-a', status: 'active', revision: 2 };

test('idempotent Snow mutation writes state and claim in one transaction', async (t) => {
  const commands = installDdb(t, (command) => command.constructor.name === 'GetCommand' ? {} : {});
  const result = await commitSnowIdempotentMutation({ businessId: 'biz-a', employeeId: 'employee-a', key: 'start-route-1', action: 'start-route', response: { route }, createdAt: '2027-12-02T01:00:00.000Z', writes: [{ kind: 'route', record: route, expectedRevision: 1 }] });
  assert.equal(result.ok, true);
  const transaction = commands.find((command) => command.constructor.name === 'TransactWriteCommand');
  assert.ok(transaction);
  assert.equal(transaction.input.TransactItems.length, 2);
  assert.match(transaction.input.TransactItems[0].Put.Item.SK, /^SNOW_ROUTE#event-a#route-a$/);
  assert.match(transaction.input.TransactItems[1].Put.Item.SK, /^SNOW_IDEMPOTENCY#employee-a#start-route-1$/);
  assert.equal(transaction.input.TransactItems[0].Put.ExpressionAttributeValues[':expectedRevision'], 1);
});

test('existing Snow claim replays without another transaction', async (t) => {
  const commands = installDdb(t, (command) => command.constructor.name === 'GetCommand' ? { Item: { PK: 'BUSINESS#biz-a', SK: 'claim', entityType: 'SNOW_IDEMPOTENCY', action: 'start-route', response: { route } } } : {});
  const result = await commitSnowIdempotentMutation({ businessId: 'biz-a', employeeId: 'employee-a', key: 'start-route-1', action: 'start-route', response: { route }, createdAt: '2027-12-02T01:00:00.000Z', writes: [{ kind: 'route', record: route, expectedRevision: 1 }] });
  assert.deepEqual(result.replay, { route });
  assert.equal(commands.some((command) => command.constructor.name === 'TransactWriteCommand'), false);
});

test('Snow idempotency keys cannot be reused for another action', async (t) => {
  installDdb(t, (command) => command.constructor.name === 'GetCommand' ? { Item: { PK: 'BUSINESS#biz-a', SK: 'claim', entityType: 'SNOW_IDEMPOTENCY', action: 'arrival', response: {} } } : {});
  const result = await commitSnowIdempotentMutation({ businessId: 'biz-a', employeeId: 'employee-a', key: 'shared-key-1', action: 'start-route', response: { route }, createdAt: '2027-12-02T01:00:00.000Z', writes: [{ kind: 'route', record: route, expectedRevision: 1 }] });
  assert.equal(result.keyConflict, true);
});
