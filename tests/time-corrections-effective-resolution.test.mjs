import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveTimeEntries } from '../api/_lib/timeCorrections.js';

const baseEntry = {
  id: 'entry-1',
  employeeId: 'emp-1',
  jobId: 'job-1',
  jobIds: ['job-1'],
  workType: 'job',
  clockIn: '2026-08-06T07:30:00.000Z',
  clockOut: '2026-08-06T22:00:00.000Z',
  breakMinutes: 0,
  notes: '',
  status: 'clocked_out',
};

test('pending corrections do not alter effective values', () => {
  const entries = [baseEntry];
  const corrections = [
    {
      id: 'corr-1',
      timeEntryId: 'entry-1',
      status: 'pending',
      requestedClockOutAt: '2026-08-06T16:30:00.000Z',
      createdAt: '2026-08-06T23:00:00.000Z',
      updatedAt: '2026-08-06T23:00:00.000Z',
    },
  ];

  const effective = buildEffectiveTimeEntries(entries, corrections);
  assert.equal(effective[0].clockOut, baseEntry.clockOut);
});

test('approved correction overrides effective end time and preserves raw source externally', () => {
  const entries = [baseEntry];
  const corrections = [
    {
      id: 'corr-1',
      timeEntryId: 'entry-1',
      status: 'approved',
      requestedClockOutAt: '2026-08-06T16:30:00.000Z',
      reviewedAt: '2026-08-07T00:00:00.000Z',
      createdAt: '2026-08-06T23:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    },
  ];

  const effective = buildEffectiveTimeEntries(entries, corrections);
  assert.equal(effective[0].clockOut, '2026-08-06T16:30:00.000Z');
  assert.equal(entries[0].clockOut, '2026-08-06T22:00:00.000Z');
});

test('physically applied approved correction does not overlay the authoritative entry again', () => {
  const entries = [{ ...baseEntry, clockOut: '2026-08-06T18:00:00.000Z' }];
  const corrections = [{
    id: 'corr-applied',
    timeEntryId: 'entry-1',
    status: 'approved',
    requestedClockOutAt: '2026-08-06T16:30:00.000Z',
    mutationAppliedAt: '2026-08-07T00:00:00.000Z',
    reviewedAt: '2026-08-07T00:00:00.000Z',
  }];
  const effective = buildEffectiveTimeEntries(entries, corrections);
  assert.equal(effective[0].clockOut, '2026-08-06T18:00:00.000Z');
});

test('newer direct edit supersedes a legacy approved correction overlay', () => {
  const entries = [{ ...baseEntry, clockOut: '2026-08-06T18:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z' }];
  const corrections = [{
    id: 'corr-legacy',
    timeEntryId: 'entry-1',
    status: 'approved',
    requestedClockOutAt: '2026-08-06T16:30:00.000Z',
    reviewedAt: '2026-08-07T00:00:00.000Z',
  }];
  assert.equal(buildEffectiveTimeEntries(entries, corrections)[0].clockOut, '2026-08-06T18:00:00.000Z');
});

test('rejected corrections do not alter effective values', () => {
  const entries = [baseEntry];
  const corrections = [
    {
      id: 'corr-1',
      timeEntryId: 'entry-1',
      status: 'rejected',
      requestedClockOutAt: '2026-08-06T16:30:00.000Z',
      reviewedAt: '2026-08-07T00:00:00.000Z',
      createdAt: '2026-08-06T23:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    },
  ];

  const effective = buildEffectiveTimeEntries(entries, corrections);
  assert.equal(effective[0].clockOut, baseEntry.clockOut);
});

test('latest approved correction wins deterministically', () => {
  const entries = [baseEntry];
  const corrections = [
    {
      id: 'corr-1',
      timeEntryId: 'entry-1',
      status: 'approved',
      requestedClockOutAt: '2026-08-06T17:00:00.000Z',
      reviewedAt: '2026-08-06T23:00:00.000Z',
      createdAt: '2026-08-06T23:00:00.000Z',
      updatedAt: '2026-08-06T23:00:00.000Z',
    },
    {
      id: 'corr-2',
      timeEntryId: 'entry-1',
      status: 'approved',
      requestedClockOutAt: '2026-08-06T16:30:00.000Z',
      reviewedAt: '2026-08-07T00:30:00.000Z',
      createdAt: '2026-08-07T00:30:00.000Z',
      updatedAt: '2026-08-07T00:30:00.000Z',
    },
  ];

  const effective = buildEffectiveTimeEntries(entries, corrections);
  assert.equal(effective[0].clockOut, '2026-08-06T16:30:00.000Z');
});

test('approved wrong-job/activity corrections update effective job and work type only after approval', () => {
  const entries = [baseEntry];
  const corrections = [
    {
      id: 'corr-1',
      timeEntryId: 'entry-1',
      status: 'approved',
      requestedJobId: 'job-2',
      requestedActivityType: 'drive_time',
      reviewedAt: '2026-08-07T00:30:00.000Z',
      createdAt: '2026-08-07T00:30:00.000Z',
      updatedAt: '2026-08-07T00:30:00.000Z',
    },
  ];

  const effective = buildEffectiveTimeEntries(entries, corrections);
  assert.equal(effective[0].jobId, 'job-2');
  assert.deepEqual(effective[0].jobIds, ['job-2']);
  assert.equal(effective[0].workType, 'drive_time');
});

test('approved non-billable correction overlays category fields and leaves source entry unchanged', () => {
  const entries = [
    {
      ...baseEntry,
      workType: 'job',
      unbillableCategoryId: undefined,
      unbillableCategoryName: undefined,
    },
  ];
  const corrections = [
    {
      id: 'corr-unbillable-1',
      timeEntryId: 'entry-1',
      status: 'approved',
      requestedActivityType: 'non_billable',
      requestedUnbillableCategoryId: 'cat-training',
      requestedUnbillableCategoryName: 'Training',
      reviewedAt: '2026-08-07T00:30:00.000Z',
      createdAt: '2026-08-07T00:30:00.000Z',
      updatedAt: '2026-08-07T00:30:00.000Z',
    },
  ];

  const effective = buildEffectiveTimeEntries(entries, corrections);
  assert.equal(effective[0].workType, 'non_billable');
  assert.equal(effective[0].unbillableCategoryId, 'cat-training');
  assert.equal(effective[0].unbillableCategoryName, 'Training');
  assert.equal(entries[0].workType, 'job');
  assert.equal(entries[0].unbillableCategoryId, undefined);
});
