import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientErrorDiagnostic,
  claimChunkRecovery,
  handleClientError,
  isChunkLoadError,
} from '../src/errors/routeErrorRecovery.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('classifies Vite and browser dynamic-import failures without classifying ordinary render errors', () => {
  const chunkFailures = [
    new TypeError('Failed to fetch dynamically imported module: https://app.oliveops.ca/assets/Jobs-old.js'),
    new TypeError('error loading dynamically imported module'),
    new TypeError('Importing a module script failed.'),
    new Error('Loading chunk 42 failed.'),
    Object.assign(new Error('request failed'), { name: 'ChunkLoadError' }),
    new TypeError('Failed to load module script: Expected a JavaScript-or-Wasm module script'),
  ];

  for (const error of chunkFailures) assert.equal(isChunkLoadError(error), true, error.message);
  assert.equal(isChunkLoadError(new Error('Cannot read properties of undefined')), false);
  assert.equal(isChunkLoadError('A normal route failed to render'), false);
});

test('a chunk failure receives at most one automatic reload for the same route and build', () => {
  const storage = createStorage();
  let reloadCount = 0;
  const input = {
    error: new TypeError('Failed to fetch dynamically imported module: /assets/Forms-old.js'),
    route: '/operations/forms',
    source: 'react-boundary',
    storage,
    reload: () => { reloadCount += 1; },
    report: () => undefined,
  };

  assert.equal(handleClientError(input).recoveryStarted, true);
  assert.equal(handleClientError(input).recoveryStarted, false);
  assert.equal(reloadCount, 1);
});

test('ordinary route render failures are diagnosed without automatic reload', () => {
  let reloadCount = 0;
  let captured;
  const result = handleClientError({
    error: new Error('Route component crashed'),
    route: '/employees',
    source: 'react-boundary',
    storage: createStorage(),
    reload: () => { reloadCount += 1; },
    report: (diagnostic) => { captured = diagnostic; },
  });

  assert.equal(result.recoveryStarted, false);
  assert.equal(reloadCount, 0);
  assert.equal(captured.route, '/employees');
  assert.equal(captured.chunkLoadFailure, false);
  assert.equal(captured.errorName, 'Error');
});

test('Vite preload errors are confirmed chunk failures even without a browser-specific message', () => {
  let reloadCount = 0;
  const result = handleClientError({
    error: new Event('vite:preloadError'),
    route: '/sops',
    source: 'vite-preload-error',
    storage: createStorage(),
    reload: () => { reloadCount += 1; },
    report: () => undefined,
    forceChunkLoadFailure: true,
  });
  assert.equal(result.diagnostic.chunkLoadFailure, true);
  assert.equal(result.recoveryStarted, true);
  assert.equal(reloadCount, 1);
});

test('recovery markers are route/build scoped and expire after the recovery window', () => {
  const storage = createStorage();
  assert.equal(claimChunkRecovery({ storage, route: '/jobs', appVersion: 'build-a', now: 1_000 }), true);
  assert.equal(claimChunkRecovery({ storage, route: '/jobs', appVersion: 'build-a', now: 2_000 }), false);
  assert.equal(claimChunkRecovery({ storage, route: '/crm', appVersion: 'build-a', now: 2_000 }), true);
  assert.equal(claimChunkRecovery({ storage, route: '/jobs', appVersion: 'build-b', now: 2_000 }), true);
  assert.equal(claimChunkRecovery({ storage, route: '/jobs', appVersion: 'build-a', now: 3_602_000 }), true);
});

test('diagnostics contain only bounded operational fields', () => {
  const diagnostic = buildClientErrorDiagnostic({
    error: new TypeError(`Request for person@example.com failed with Bearer secret-token at https://app.oliveops.ca/assets/Page.js?token=secret ${'x'.repeat(700)}`),
    route: '/training?employeeId=sensitive#details',
    source: 'unhandled-rejection',
  });
  assert.deepEqual(Object.keys(diagnostic), [
    'source', 'route', 'errorName', 'errorMessage', 'chunkLoadFailure', 'appVersion', 'occurredAt',
  ]);
  assert.equal(diagnostic.errorMessage.length, 500);
  assert.equal(diagnostic.errorMessage.includes('person@example.com'), false);
  assert.equal(diagnostic.errorMessage.includes('secret-token'), false);
  assert.equal(diagnostic.errorMessage.includes('?token=secret'), false);
  assert.equal(diagnostic.route, '/training');
});