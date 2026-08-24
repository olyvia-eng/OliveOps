import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const jobSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const tasksSource = readFileSync('src/pages/home/OutstandingTasks.tsx', 'utf8');
const typesSource = readFileSync('src/types/index.ts', 'utf8');
const dataApiSource = readFileSync('api/data.js', 'utf8');
const authRepoSource = readFileSync('api/_lib/authRepo.js', 'utf8');

test('Job Project Management renders the reusable Tasks card first', () => {
  const projectManagement = jobSource.slice(jobSource.indexOf("activeTab === 'project-management'"), jobSource.indexOf("activeTab === 'invoices'"));
  assert.match(projectManagement, /<OutstandingTasks/);
  assert.ok(projectManagement.indexOf('<OutstandingTasks') < projectManagement.indexOf('>Notes</h2>'));
  assert.match(projectManagement, /heading="Job Tasks"/);
});

test('Job Tasks are scoped by the authoritative related Job fields', () => {
  assert.match(jobSource, /task\.relatedEntityType === 'job' && task\.relatedEntityId === id/);
  assert.match(jobSource, /relatedEntityType: 'job'/);
  assert.match(jobSource, /relatedEntityId: job\.id/);
  assert.match(jobSource, /assignedUserId: currentUserId/);
  assert.match(appSource, /<JobDetailPage currentUserRole=\{sessionUser\.role\} currentUserId=\{sessionUser\.id\}/);
});

test('Job task headers enter inline editing on double click and persist on the Job', () => {
  assert.match(tasksSource, /onDoubleClick=\{\(\) => \{ if \(!onRenameFilter\) return;/);
  assert.match(tasksSource, /Double-click to rename/);
  assert.match(tasksSource, /Rename \$\{label\} task header/);
  assert.match(jobSource, /taskHeaderLabels: \{ \.\.\.job\.taskHeaderLabels, \[filter\]: name \}/);
  assert.match(typesSource, /taskHeaderLabels\?: Partial<Record<'all' \| 'completed', string>>/);
  assert.match(authRepoSource, /taskHeaderLabels: item\.taskHeaderLabels/);
});

test('Job task header persistence rejects unknown, blank, and oversized labels', () => {
  assert.match(dataApiSource, /Object\.keys\(record\.taskHeaderLabels\)[\s\S]*!\['all', 'completed'\]\.includes\(key\)/);
  assert.match(dataApiSource, /typeof label !== 'string' \|\| !label\.trim\(\) \|\| label\.trim\(\)\.length > 30/);
  assert.match(dataApiSource, /Job task header labels are invalid\./);
});

test('Job Tasks retain task editing, completion, deletion, priorities, due dates, and subtasks', () => {
  assert.match(jobSource, /onUpdate=\{async \(taskId, input\) => \(await updateTask\(taskId, input\)\)\.ok\}/);
  assert.match(jobSource, /status: 'completed', completedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(jobSource, /onDelete=\{async \(taskId\) => \{ await deleteTask\(taskId\); \}\}/);
  assert.match(tasksSource, /openAddSubtask/);
  assert.match(tasksSource, /aria-label="Priority"/);
  assert.match(tasksSource, /aria-label="Due date"/);
});