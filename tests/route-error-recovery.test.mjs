import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientErrorDiagnostic,
  claimChunkRecovery,
  clearChunkRecovery,
  handleClientError,
  installGlobalErrorHandlers,
  isChunkLoadError,
} from '../src/errors/routeErrorRecovery.js';

function createStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
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
    new TypeError('Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".'),
  ];

  for (const error of chunkFailures) assert.equal(isChunkLoadError(error), true, error.message);
  assert.equal(isChunkLoadError(new Error('Cannot read properties of undefined')), false);
  assert.equal(isChunkLoadError('A normal route failed to render'), false);
});

test('a chunk failure receives at most one automatic reload for the same route and build', () => {
  const storage = createStorage();
  let reloadCount = 0;
  const diagnostics = [];
  const input = {
    error: new TypeError('Failed to fetch dynamically imported module: https://app.oliveops.ca/assets/FormsPage-old.js?token=secret'),
    route: '/operations/forms',
    source: 'react-boundary',
    storage,
    reload: () => { reloadCount += 1; },
    report: (diagnostic) => diagnostics.push(diagnostic),
  };

  assert.equal(handleClientError(input).recoveryStarted, true);
  assert.equal(handleClientError(input).recoveryStarted, false);
  assert.equal(reloadCount, 1);
  assert.equal(diagnostics[0].failedAssetUrl, '/assets/FormsPage-old.js');
  assert.equal(diagnostics[0].automaticRecoveryAttempted, true);
  assert.equal(diagnostics[1].automaticRecoveryAttempted, false);
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

test('a successful route commit clears prior-build recovery markers for that route', () => {
  const storage = createStorage();
  assert.equal(claimChunkRecovery({ storage, route: '/operations/forms', appVersion: 'old-build', now: 1_000 }), true);
  assert.equal(claimChunkRecovery({ storage, route: '/operations/forms', appVersion: 'old-build', now: 2_000 }), false);
  assert.equal(clearChunkRecovery({ storage, route: '/operations/forms', appVersion: 'new-build' }), true);
  assert.equal(storage.length, 0);
  assert.equal(claimChunkRecovery({ storage, route: '/operations/forms', appVersion: 'old-build', now: 3_000 }), true);
});

test('global handlers share one classifier and cleanup every listener', () => {
  const listeners = new Map();
  const target = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const storage = createStorage();
  const diagnostics = [];
  let reloadCount = 0;
  let route = '/employees';
  const cleanup = installGlobalErrorHandlers({
    target,
    storage,
    reload: () => { reloadCount += 1; },
    route: () => route,
    report: (diagnostic) => diagnostics.push(diagnostic),
  });

  listeners.get('error')({ type: 'error' });
  assert.equal(diagnostics.length, 0);
  listeners.get('error')({ error: new Error('Ordinary script failure') });
  route = '/operations/forms';
  listeners.get('unhandledrejection')({ reason: new TypeError('Failed to fetch dynamically imported module: /assets/FormsPage-old.js') });
  route = '/training';
  let prevented = false;
  listeners.get('vite:preloadError')({ payload: new Error('preload failed'), preventDefault: () => { prevented = true; } });

  assert.deepEqual([...listeners.keys()].sort(), ['error', 'unhandledrejection', 'vite:preloadError']);
  assert.equal(diagnostics[0].source, 'window-error');
  assert.equal(diagnostics[0].chunkLoadFailure, false);
  assert.equal(diagnostics[1].failedAssetUrl, '/assets/FormsPage-old.js');
  assert.equal(diagnostics[2].source, 'vite-preload-error');
  assert.equal(reloadCount, 2);
  assert.equal(prevented, true);

  cleanup();
  assert.equal(listeners.size, 0);
});

test('diagnostics contain only bounded operational fields', () => {
  const diagnostic = buildClientErrorDiagnostic({
    error: new TypeError(`Request for person@example.com failed with Bearer secret-token at https://app.oliveops.ca/assets/Page.js?token=secret ${'x'.repeat(700)}`),
    route: '/training?employeeId=sensitive#details',
    source: 'unhandled-rejection',
  });
  assert.deepEqual(Object.keys(diagnostic), [
    'source', 'route', 'errorName', 'errorMessage', 'failedAssetUrl', 'chunkLoadFailure',
    'automaticRecoveryAttempted', 'appVersion', 'occurredAt',
  ]);
  assert.equal(diagnostic.errorMessage.length, 500);
  assert.equal(diagnostic.errorMessage.includes('person@example.com'), false);
  assert.equal(diagnostic.errorMessage.includes('secret-token'), false);
  assert.equal(diagnostic.errorMessage.includes('?token=secret'), false);
  assert.equal(diagnostic.route, '/training');
});