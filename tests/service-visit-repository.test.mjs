import test from 'node:test';
import assert from 'node:assert/strict';
import { ddb } from '../api/_lib/db.js';
import { createServiceVisitForBusiness, listServiceVisitsForSchedule } from '../api/_lib/serviceVisitRepo.js';

test('Service Visit schedule query uses the business partition without a GSI and handles every page', async (t) => {
  const originalSend = ddb.send.bind(ddb);
  const calls = [];
  ddb.send = async (command) => {
    const input = command.input;
    calls.push(input);
    if (!input.ExclusiveStartKey) return {
      Items: [
        { PK: 'BUSINESS#biz-a', SK: 'SERVICE_VISIT#job-a#late', entityType: 'SERVICE_VISIT', id: 'late', jobId: 'job-a', scheduledDate: '2027-04-03', scheduledStartAt: '2027-04-03T14:00:00.000Z' },
        { PK: 'BUSINESS#biz-a', SK: 'JOB#job-a', entityType: 'JOB', id: 'job-a' },
        { PK: 'BUSINESS#biz-other', SK: 'SERVICE_VISIT#job-x#foreign', entityType: 'SERVICE_VISIT', id: 'foreign', jobId: 'job-x', scheduledDate: '2027-04-02' },
      ],
      LastEvaluatedKey: { PK: 'BUSINESS#biz-a', SK: 'PAGE#1' },
    };
    return { Items: [
      { PK: 'BUSINESS#biz-a', SK: 'SERVICE_VISIT#job-a#early', entityType: 'SERVICE_VISIT', id: 'early', jobId: 'job-a', scheduledDate: '2027-04-01', scheduledStartAt: '2027-04-01T08:00:00.000Z' },
      { PK: 'BUSINESS#biz-a', SK: 'SERVICE_VISIT#job-a#before', entityType: 'SERVICE_VISIT', id: 'before', jobId: 'job-a', scheduledDate: '2027-03-31' },
      { PK: 'BUSINESS#biz-a', SK: 'SERVICE_VISIT#job-a#after', entityType: 'SERVICE_VISIT', id: 'after', jobId: 'job-a', scheduledDate: '2027-04-04' },
    ] };
  };
  t.after(() => { ddb.send = originalSend; });

  const visits = await listServiceVisitsForSchedule('biz-a', '2027-04-01', '2027-04-03');
  assert.deepEqual(visits.map((visit) => visit.id), ['early', 'late']);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((input) => input.IndexName === undefined), true);
  assert.equal(calls.every((input) => input.KeyConditionExpression === 'PK = :pk'), true);
  assert.equal(calls.every((input) => input.ExpressionAttributeValues[':pk'] === 'BUSINESS#biz-a'), true);
  assert.deepEqual(calls[1].ExclusiveStartKey, { PK: 'BUSINESS#biz-a', SK: 'PAGE#1' });
});

test('new Service Visit records do not write Time Entry index attributes', async (t) => {
  const originalSend = ddb.send.bind(ddb);
  let item;
  ddb.send = async (command) => { item = command.input.Item; return {}; };
  t.after(() => { ddb.send = originalSend; });
  await createServiceVisitForBusiness({ businessId: 'biz-a', visit: { id: 'visit-a', jobId: 'job-a', scheduledDate: '2027-04-01' } });
  assert.equal(item.PK, 'BUSINESS#biz-a');
  assert.equal(item.SK, 'SERVICE_VISIT#job-a#visit-a');
  assert.equal('timeEntryIndexPk' in item, false);
  assert.equal('timeEntryIndexSk' in item, false);
});