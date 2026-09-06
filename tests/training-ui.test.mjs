import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const library = readFileSync('src/pages/training/TrainingLibraryPage.tsx', 'utf8');
const builder = readFileSync('src/pages/training/TrainingBuilderPage.tsx', 'utf8');
const detail = readFileSync('src/pages/training/TrainingDetailPage.tsx', 'utf8');
const employeeTraining = readFileSync('src/components/employees/EmployeeTrainingSection.tsx', 'utf8');
const documentControls = readFileSync('src/components/documents/PdfDocumentControls.tsx', 'utf8');
const upload = readFileSync('src/utils/fileUpload.ts', 'utf8');

test('Training administration uses protected full-page routes and owner/admin navigation', () => {
  for (const route of ['training', 'training/new', 'training/:trainingId', 'training/:trainingId/edit']) {
    assert.match(app, new RegExp(`path="${route.replaceAll('/', '\\/')}"`));
  }
  assert.match(sidebar, /team-training[^\n]+roles: ownerAdminRoles/);
});

test('Training Library presents decision-first counts, filters, and module actions', () => {
  for (const text of ['Active training modules', 'Assigned', 'Due soon', 'Overdue', 'Duplicate', 'Deactivate Training', 'Reactivate Training']) assert.match(library, new RegExp(text));
  assert.match(library, /const \[query, setQuery\]/);
  assert.match(library, /const \[status, setStatus\]/);
});

test('Training row ellipsis opens an accessible menu without changing status', () => {
  assert.match(library, /aria-label={`Actions for \$\{training\.title\}`}/);
  assert.match(library, /aria-haspopup="menu"/);
  assert.match(library, /role="menu"/);
  assert.match(library, /role="menuitem"/);
  assert.match(library, /setMenuTrainingId\(\(current\) => current === training\.id \? null : training\.id\)/);
  assert.doesNotMatch(library, /onClick=\{\(\) => void (?:deactivate|setActive)\(training\)\}/);
  assert.match(library, /onClick=\{\(\) => void setActive\(\)\}/);
});

test('Training menu actions follow status rules and preserve immutable history', () => {
  for (const text of ['Edit draft', 'Preview', 'Publish', 'View Training', 'Assign to employees', 'View assignments', 'View completion history', 'Create new version', 'View version history']) assert.match(library, new RegExp(text));
  assert.doesNotMatch(library, />Delete draft</);
  assert.match(library, /training\.active && training\.currentVersion > 0/);
  assert.match(library, /Current incomplete assignments remain active and accessible/);
  assert.match(library, /Existing completion history and immutable version records remain unchanged/);
  assert.match(library, /statusRequestInFlight\.current/);
  assert.match(library, /duplicateRequestInFlight\.current/);
  assert.match(library, /Delete Training/);
  assert.match(library, /all assignments, all completion history/);
  assert.match(library, /trainingRequest\('delete', \{ method: 'POST', body: \{ trainingId: deleteConfirmation\.id \} \}\)/);
  assert.match(library, /training: \{ \.\.\.training, title: `\$\{training\.title\} Copy`, attachmentFileId: null, document: null \}/);
});

test('Training builder supports immutable publish choices and stable checklist editing', () => {
  assert.match(builder, /crypto\.randomUUID\(\)/);
  assert.match(builder, /start-draft/);
  assert.match(builder, /Keep current assignments valid/);
  assert.match(builder, /Require selected employees to complete this version/);
  assert.match(builder, /requireEmployeeIds/);
  assert.match(builder, /New version due date/);
});

test('Training document authoring is PDF-only and retains completion controls', () => {
  assert.match(builder, /CreationMethodChoice resource="Training"/);
  assert.match(documentControls, /Build in OliveOps/);
  assert.match(documentControls, /Upload a PDF/);
  assert.match(documentControls, /category:\s*["']document["']/);
  assert.match(documentControls, /AuthorizedPdfPreview/);
  assert.match(documentControls, /<iframe/);
  assert.match(upload, /PDF files are supported/);
  assert.match(upload, /XMLHttpRequest/);
  assert.match(builder, /Completion checklist/);
  assert.match(builder, /Acknowledgement/);
  assert.match(builder, /Renewal/);
});

test('Training new routing derives durable isolated mode state from the URL', () => {
  assert.match(documentControls, /resource === "Training" \? "\/training" : "\/sops"/);
  assert.match(documentControls, /to=\{`\$\{base\}\/new\?mode=structured`\}/);
  assert.match(documentControls, /to=\{`\$\{base\}\/new\?mode=document`\}/);
  assert.match(builder, /searchParams\.get\("mode"\)/);
  assert.match(builder, /requestedMode !== "structured" &&\s*requestedMode !== "document"/);
  assert.match(builder, /return <CreationMethodChoice resource="Training"/);
  assert.match(builder, /<TrainingBuilder\s+key=\{trainingId \?\? initialMode\}/);
  assert.match(builder, /useState<Draft>\(\(\) => emptyDraft\(initialMode\)\)/);
  assert.match(builder, /body: \{ requestId: crypto\.randomUUID\(\), training: draft \}/);
  assert.match(builder, /contentMode: editable\.contentMode \?\? "structured"/);
});

test('Training document mode hides structured instructions and requires a ready PDF', () => {
  assert.match(builder, /\{!isDocument \? \([\s\S]*label="Employee instructions"/);
  assert.match(builder, /\{isDocument \? \([\s\S]*<PdfDropzone/);
  assert.match(builder, /onRemove=\{\(\) => \{[\s\S]*document: null[\s\S]*update-draft/);
  assert.match(builder, /isDocument && draft\.document\?\.status !== "ready"/);
  assert.match(builder, /to=\{definition \? `\/training\/\$\{definition\.id\}` : "\/training\/new"\}/);
  assert.match(builder, /attachmentFileId: null,\s*document: null/);
});

test('Training detail and employee profile expose assignment operations and transparent compliance', () => {
  assert.match(detail, /useSearchParams/);
  assert.match(detail, /searchParams\.get\('tab'\)/);
  assert.match(detail, /searchParams\.get\('assign'\) === '1'/);
  assert.match(detail, /All currently active employees/);
  assert.match(detail, /does not include future hires/);
  assert.match(detail, /Change due/);
  assert.match(detail, /Completion history/);
  assert.match(employeeTraining, /Training compliance/);
  assert.match(employeeTraining, /No training assigned/);
  assert.match(employeeTraining, /completion\.checklistItems/);
});
