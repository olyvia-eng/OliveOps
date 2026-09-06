import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const api = readFileSync('src/pages/sops/sopApi.ts', 'utf8');
const library = readFileSync('src/pages/sops/SopLibraryPage.tsx', 'utf8');
const editor = readFileSync('src/pages/sops/SopEditorPage.tsx', 'utf8');
const detail = readFileSync('src/pages/sops/SopDetailPage.tsx', 'utf8');
const documentControls = readFileSync('src/components/documents/PdfDocumentControls.tsx', 'utf8');
const richTextEditor = readFileSync('src/components/rich-text/RichTextEditor.tsx', 'utf8');
const richTextViewer = readFileSync('src/components/rich-text/RichTextViewer.tsx', 'utf8');
const repository = readFileSync('api/_lib/sopRepo.js', 'utf8');

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
  for (const text of ['Search SOPs', 'Filter SOP category', 'Filter SOP status', 'Version', 'Updated', 'Duplicate SOP', 'Archive SOP', 'Reactivate SOP', 'Delete SOP']) {
    assert.match(library, new RegExp(text));
  }
  assert.match(library, /status === ["']archived["'] &&\s*sop\.status === ["']published["'] &&\s*!sop\.active/);
  assert.match(library, /This action cannot be undone\. Archive the SOP instead/);
  assert.match(library, /await deleteSop\(deleteConfirmation\.id\)/);
});

test('SOP editor supports required content and multiple private document attachments', () => {
  for (const label of ['Title', 'Category', 'Short description']) {
    assert.match(editor, new RegExp(`label="${label}"`));
  }
  assert.match(editor, /<RichTextEditor/);
  assert.match(editor, /ariaLabel="Procedure content"/);
  assert.doesNotMatch(editor, /label="(?:Purpose|Instructions|Safety information)"/);
  assert.match(editor, /type="file"\s+multiple/);
  assert.match(editor, /entityType:\s*["']sop["'],\s*entityId:\s*saved\.id,\s*category:\s*["']attachment["']/);
  assert.match(editor, /\.pdf,\.doc,\.docx/);
  assert.match(editor, /publishSop\(saved\.id, publishRequestId\.current\)/);
});

test('SOP detail presents immutable versions without training workflow concepts', () => {
  assert.match(detail, /Version history/);
  assert.match(detail, /version\.publishedAt/);
  assert.match(detail, /RichTextViewer document=\{sopRichTextContent\(definition\)\}/);
  assert.match(detail, /RichTextViewer document=\{sopRichTextContent\(version\)\}/);
  for (const source of [library, editor, detail]) {
    assert.doesNotMatch(source, /assignment|completion|recurrence|due date/i);
  }
});

test('SOP document authoring uses one validated PDF and an authorized inline preview', () => {
  assert.match(editor, /CreationMethodChoice resource="SOP"/);
  assert.match(editor, /contentMode.*document/);
  assert.match(editor, /<PdfDropzone\s+entityType="sop"/);
  assert.match(editor, /<AuthorizedPdfPreview/);
  assert.match(documentControls, /accept="\.pdf,application\/pdf"/);
  assert.match(documentControls, /category:\s*["']document["']/);
  assert.match(documentControls, /document \? "Replace PDF" : "Browse files"/);
  assert.match(documentControls, /aria-label="Remove PDF"/);
  assert.match(detail, /AuthorizedPdfPreview/);
});

test('SOP new routing derives durable isolated mode state from the URL', () => {
  assert.match(documentControls, /resource === "Training" \? "\/training" : "\/sops"/);
  assert.match(documentControls, /to=\{`\$\{base\}\/new\?mode=structured`\}/);
  assert.match(documentControls, /to=\{`\$\{base\}\/new\?mode=document`\}/);
  assert.match(editor, /searchParams\.get\("mode"\)/);
  assert.match(editor, /requestedMode !== "structured" &&\s*requestedMode !== "document"/);
  assert.match(editor, /return <CreationMethodChoice resource="SOP"/);
  assert.match(editor, /<SopEditor key=\{sopId \?\? initialMode\} initialMode=\{initialMode\}/);
  assert.match(editor, /useState<SopContent>\(\(\) =>\s*emptySop\(initialMode\)/);
  assert.match(editor, /createSop\(draft\)/);
  assert.match(editor, /contentMode: payload\.definition\.contentMode \?\? "structured"/);
});

test('SOP document mode hides structured fields and requires a ready PDF to publish', () => {
  assert.match(editor, /\{!isDocument \? \([\s\S]*<RichTextEditor/);
  assert.match(editor, /\{isDocument \? \([\s\S]*<PdfDropzone/);
  assert.match(editor, /onRemove=\{\(\) => \{[\s\S]*document: null[\s\S]*updateSopDraft/);
  assert.match(editor, /isDocument && draft\.document\?\.status !== "ready"/);
  assert.match(editor, /to=\{definition \? `\/sops\/\$\{definition\.id\}` : "\/sops\/new"\}/);
});

test('SOP duplicate preserves explicit mode without reusing the source PDF association', () => {
  assert.match(repository, /normalizeSopDraft\(\{ \.\.\.source,[\s\S]*document: null \}\)/);
  assert.match(repository, /snapshot = \{ sopId, businessId, version, \.\.\.validation\.draft/);
});

test('SOP structured content uses the constrained editor and safe read-only renderer', () => {
  for (const command of ['setParagraph', 'toggleHeading', 'toggleBold', 'toggleItalic', 'toggleBulletList', 'toggleOrderedList', 'undo', 'redo', 'unsetAllMarks']) {
    assert.match(richTextEditor, new RegExp(command));
  }
  assert.match(editor, /sopRichTextContent\(payload\.definition\)/);
  assert.match(richTextViewer, /normalizeRichTextDocument\(document\)/);
  assert.doesNotMatch(richTextViewer, /dangerouslySetInnerHTML|contentEditable/);
});