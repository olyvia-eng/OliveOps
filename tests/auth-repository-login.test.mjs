import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { ddb } from '../api/_lib/db.js';
import { authenticateUser } from '../api/_lib/authRepo.js';

const VALID_PASSWORD_HASH = bcrypt.hashSync('correct-password', 4);
const GENERIC_FAILURE = { ok: false, error: 'Invalid email or password.' };

function key(pk, sk) {
  return `${pk}|${sk}`;
}

function installAuthStore(t, items = []) {
  const store = new Map(items.map((item) => [key(item.PK, item.SK), item]));
  const commandTypes = [];
  const originalSend = ddb.send.bind(ddb);

  ddb.send = async (command) => {
    const commandType = command?.constructor?.name;
    commandTypes.push(commandType);

    if (commandType === 'GetCommand') {
      return { Item: store.get(key(command.input.Key.PK, command.input.Key.SK)) };
    }

    if (commandType === 'QueryCommand') {
      return { Items: [] };
    }

    throw new Error(`Unexpected ${commandType} in authentication test`);
  };

  t.after(() => {
    ddb.send = originalSend;
  });

  return { commandTypes };
}

function authItems({ active = true, passwordHash = VALID_PASSWORD_HASH } = {}) {
  return [
    {
      PK: 'EMAIL#crew@example.com',
      SK: 'USER',
      entityType: 'EMAIL_LOOKUP',
      businessId: 'biz-a',
      userId: 'user-a',
    },
    {
      PK: 'BUSINESS#biz-a',
      SK: 'USER#user-a',
      entityType: 'USER',
      businessId: 'biz-a',
      userId: 'user-a',
      email: 'crew@example.com',
      active,
      passwordHash,
    },
  ];
}

test('authenticateUser treats an unknown email as a generic indexed lookup failure', async (t) => {
  const { commandTypes } = installAuthStore(t);

  const result = await authenticateUser('missing@example.com', 'wrong-password');

  assert.deepEqual(result, GENERIC_FAILURE);
  assert.deepEqual(commandTypes, ['GetCommand']);
});

test('authenticateUser treats a wrong password as a generic failure', async (t) => {
  installAuthStore(t, authItems());

  const result = await authenticateUser('crew@example.com', 'wrong-password');

  assert.deepEqual(result, GENERIC_FAILURE);
});

test('authenticateUser treats an inactive account as a generic failure', async (t) => {
  installAuthStore(t, authItems({ active: false }));

  const result = await authenticateUser('crew@example.com', 'correct-password');

  assert.deepEqual(result, GENERIC_FAILURE);
});

test('authenticateUser treats a missing password hash as a generic failure', async (t) => {
  installAuthStore(t, authItems({ passwordHash: null }));

  const result = await authenticateUser('crew@example.com', 'correct-password');

  assert.deepEqual(result, GENERIC_FAILURE);
});

test('authenticateUser propagates genuine repository failures', async (t) => {
  const originalSend = ddb.send.bind(ddb);
  ddb.send = async () => {
    throw new Error('DynamoDB unavailable');
  };
  t.after(() => {
    ddb.send = originalSend;
  });

  await assert.rejects(
    authenticateUser('crew@example.com', 'correct-password'),
    /DynamoDB unavailable/
  );
});