import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOW_BREADCRUMB_BATCH_LIMIT,
  SNOW_OCCURRENCE_TRANSITIONS,
  SNOW_STOP_TRANSITIONS,
  canTransitionSnowState,
  deriveSnowStopAttention,
  nextSnowStop,
  normalizeBreadcrumbBatch,
  normalizeGpsEvidence,
  snowNavigationUrl,
  snowRouteProgress,
} from '../src/utils/snowOperationsModel.js';

test('Snow stop and service occurrence state machines reject arbitrary jumps', () => {
  assert.equal(canTransitionSnowState(SNOW_STOP_TRANSITIONS, 'pending', 'en_route'), true);
  assert.equal(canTransitionSnowState(SNOW_STOP_TRANSITIONS, 'pending', 'completed'), false);
  assert.equal(canTransitionSnowState(SNOW_OCCURRENCE_TRANSITIONS, 'not_started', 'active'), false);
  assert.equal(canTransitionSnowState(SNOW_OCCURRENCE_TRANSITIONS, 'awaiting_after_evidence', 'completed'), true);
});

test('GPS evidence never invents coordinates and records explicit unavailable state', () => {
  assert.deepEqual(normalizeGpsEvidence({ unavailableReason: 'permission_denied' }), { status: 'unavailable', unavailableReason: 'permission_denied' });
  assert.deepEqual(normalizeGpsEvidence({ latitude: 45.4, longitude: -75.7, accuracyMeters: 12 }), { status: 'captured', latitude: 45.4, longitude: -75.7, accuracyMeters: 12 });
  assert.equal(normalizeGpsEvidence({ latitude: 45.4, longitude: -75.7, accuracyMeters: 140 }).status, 'low_accuracy');
});

test('breadcrumb batches are bounded, ordered, and reject duplicate sequences', () => {
  const points = [
    { latitude: 45.4, longitude: -75.7, accuracyMeters: 10, deviceCapturedAt: '2026-12-19T02:00:45Z', sequence: 2 },
    { latitude: 45.3, longitude: -75.6, accuracyMeters: 9, deviceCapturedAt: '2026-12-19T02:00:00Z', sequence: 1 },
  ];
  assert.deepEqual(normalizeBreadcrumbBatch(points).map((point) => point.sequence), [1, 2]);
  assert.equal(normalizeBreadcrumbBatch([...points, points[0]]), null);
  assert.equal(normalizeBreadcrumbBatch(Array.from({ length: SNOW_BREADCRUMB_BATCH_LIMIT + 1 }, (_, sequence) => ({ ...points[0], sequence }))), null);
});

test('route progress and next stop preserve duplicate property occurrences', () => {
  const stops = [
    { id: 'stop-1', serviceJobId: 'job-a', sortOrder: 0, status: 'completed' },
    { id: 'stop-2', serviceJobId: 'job-a', sortOrder: 1, status: 'pending' },
    { id: 'stop-3', serviceJobId: 'job-a', sortOrder: 2, status: 'pending' },
  ];
  assert.deepEqual(snowRouteProgress(stops), { total: 3, completed: 1, needsAttention: 0, currentStopId: 'stop-2' });
  assert.equal(nextSnowStop(stops, 'stop-1').id, 'stop-2');
  assert.equal(stops.filter((stop) => stop.serviceJobId === 'job-a').length, 3);
});

test('attention reasons come only from recorded evidence and explicit states', () => {
  const reasons = deriveSnowStopAttention({
    stop: { id: 'stop-1', status: 'needs_attention', manualAttentionReason: 'Failed sync' },
    occurrences: [{ id: 'occ-1', status: 'completed', serviceTypeName: 'Plowing' }],
    evidence: [{ occurrenceId: 'occ-1', eventType: 'GPS_UNAVAILABLE', gps: { status: 'unavailable' } }],
  });
  assert.deepEqual(reasons, ['Failed sync', 'GPS unavailable', 'Missing before photo: Plowing', 'Missing after photo: Plowing']);
});

test('navigation opens platform maps without implementing turn-by-turn routing', () => {
  assert.match(snowNavigationUrl('123 Main St', 'iPhone'), /^https:\/\/maps\.apple\.com/);
  assert.match(snowNavigationUrl('123 Main St', 'Android'), /^https:\/\/www\.google\.com\/maps\/dir/);
  assert.equal(snowNavigationUrl(''), '');
});
