import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientDiagnosticsHandler } from '../api/client-diagnostics.js';

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('client diagnostics require a session and accept only a sanitized schema', async () => {
  let captured;
  const handler = createClientDiagnosticsHandler({
    requireSession: async () => ({ id: 'user-secret', businessId: 'business-secret', role: 'owner' }),
    writeDiagnostic: (diagnostic) => { captured = diagnostic; },
  });
  const res = createResponse();

  await handler({
    method: 'POST',
    body: {
      source: 'unhandled-rejection',
      route: '/jobs?token=must-not-be-logged',
      errorName: 'TypeError',
      errorMessage: 'Failed for person@example.com with Bearer must-not-be-logged',
      failedAssetUrl: '/assets/FormsPage-old.js?token=must-not-be-logged',
      chunkLoadFailure: true,
      automaticRecoveryAttempted: true,
      appVersion: 'commit-123',
      token: 'must-not-be-logged',
      customer: { name: 'must-not-be-logged' },
    },
  }, res);

  assert.equal(res.statusCode, 202);
  assert.deepEqual(Object.keys(captured), [
    'source', 'route', 'errorName', 'errorMessage', 'failedAssetUrl', 'chunkLoadFailure',
    'automaticRecoveryAttempted', 'appVersion', 'occurredAt',
  ]);
  assert.equal(captured.route, '/jobs');
  assert.equal(captured.failedAssetUrl, '/assets/FormsPage-old.js');
  assert.equal(captured.chunkLoadFailure, true);
  assert.equal(captured.automaticRecoveryAttempted, true);
  assert.equal(JSON.stringify(captured).includes('must-not-be-logged'), false);
  assert.equal(JSON.stringify(captured).includes('person@example.com'), false);
  assert.equal(JSON.stringify(captured).includes('business-secret'), false);
});

test('client diagnostics stop when authentication fails', async () => {
  let writes = 0;
  const handler = createClientDiagnosticsHandler({
    requireSession: async (_req, res) => { res.status(401).json({ ok: false }); return null; },
    writeDiagnostic: () => { writes += 1; },
  });
  const res = createResponse();
  await handler({ method: 'POST', body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(writes, 0);
});