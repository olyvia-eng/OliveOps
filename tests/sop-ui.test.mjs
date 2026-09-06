import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const api = readFileSync('src/pages/sops/sopApi.ts', 'utf8');
const library = readFileSync('src/pages/sops/SopLibraryPage.tsx', 'utf8');
const editor = readFileSync('src/pages/sops/SopEditorPage.tsx', 'utf8');
const detail = readFileSync('src/pages/sops/SopDetailPage.tsx', 'utf8');

test('SOP administration uses protected full-page routes and owner/admin navigation', () => {
  for (const route of ['sops', 'sops/new', 'sops/:sopId', 'sops/:sopId/edit']) {
    assert.match(app, new RegExp(`path="${route.replaceAll('/', '\\/')}" element=\\{canManageUsers`));
  }
  assert.match(sidebar, /team-training[^\n]+[\s\S]*team-sops[^\n]+roles: ownerAdminRoles/);
});

test('SOP API client follows the administration contract', () => {
  assert.match(api, /fetch\(`\/api\/sops\?\$\{query\}`/);
  for (const action of ['list', 'detail', 'create', 'update-draft', 'publish', 'duplicate', 'archive', 'reactivate']) {
    assert.match(api, new RegExp(`'${action}'`));
  }
  assert.match(api, /body: \{ requestId: crypto\.randomUUID\(\), sop \}/);
  assert.match(api, /body: \{ sopId, requestId \}/);
});

test('SOP Library exposes search, category, status, version, and lifecycle actions', () => {
  for (const text of ['Search SOPs', 'Filter SOP category', 'Filter SOP status', 'Version', 'Updated', 'Duplicate SOP', 'Archive SOP', 'Reactivate SOP']) {
    assert.match(library, new RegExp(text));
  }
  assert.match(library, /status === 'archived' && sop\.status === 'published' && !sop\.active/);
});

test('SOP editor supports required content and multiple private document attachments', () => {
  for (const label of ['Title', 'Category', 'Short description', 'Purpose', 'Instructions', 'Safety information']) {
    assert.match(editor, new RegExp(`label="${label}"`));
  }
  assert.match(editor, /type="file" multiple/);
  assert.match(editor, /entityType: 'sop', entityId: saved\.id, category: 'attachment'/);
  assert.match(editor, /\.pdf,\.doc,\.docx/);
  assert.match(editor, /publishSop\(saved\.id, publishRequestId\.current\)/);
});

test('SOP detail presents immutable versions without training workflow concepts', () => {
  assert.match(detail, /Version history/);
  assert.match(detail, /version\.publishedAt/);
  assert.match(detail, /version\.purpose/);
  assert.match(detail, /version\.instructions/);
  assert.match(detail, /version\.safetyInformation/);
  for (const source of [library, editor, detail]) {
    assert.doesNotMatch(source, /assignment|completion|recurrence|due date/i);
  }
});