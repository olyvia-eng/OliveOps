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
  // The Project Management tab's cards are user-customizable (see CustomizableCardList /
  // useJobProjectManagementCardPreferences), so their content now lives in the pmCardDefinitions
  // array rather than inline JSX - slice that array instead of the old fixed render block.
  const projectManagement = jobSource.slice(jobSource.indexOf('const pmCardDefinitions'), jobSource.indexOf("\n  return (\n    <div>"));
  assert.match(projectManagement, /<OutstandingTasks/);
  assert.ok(projectManagement.indexOf('<OutstandingTasks') < projectManagement.indexOf('>Notes</h2>'));
  assert.match(projectManagement, /heading="Job Tasks"/);
});

test('Job Tasks are scoped by the authoritative related Job fields', () => {
  assert.match(jobSource, /task\.relatedEntityType === 'job' && task\.relatedEntityId === id/);
  assert.match(jobSource, /relatedEntityType: 'job'/);
  assert.match(jobSource, /relatedEntityId: job\.id/);
  assert.match(jobSource, /assignedUserId: currentUserId/);
  assert.match(appSource, /<JobDetailRoute currentUserRole=\{sessionUser\.role\} currentUserId=\{sessionUser\.id\}/);
  assert.match(appSource, /<JobDetailPage currentUserRole=\{currentUserRole\} currentUserId=\{currentUserId\}/);
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

test('existing Job task headings remain accessible as tabs with a General fallback', () => {
  assert.match(jobSource, /jobTaskHeadings\.filter\(\(heading\) => heading\.jobId === id\)/);
  assert.match(tasksSource, /role="tablist" aria-label="Job task tabs"/);
  assert.match(tasksSource, /role="tab" aria-selected=/);
  assert.match(tasksSource, /\[\{ id: 'general', name: 'General' \}, \.\.\.jobTaskHeadings\]/);
  assert.match(jobSource, /jobTasks\.filter\(\(task\) => !task\.parentTaskId\)/);
  assert.match(tasksSource, /!task\.headingId \|\| !jobTaskHeadings\.some/);
  assert.match(tasksSource, /aria-label=\{`\$\{openCount\} open tasks`\}/);
  assert.match(tasksSource, /!jobTaskHeadings \? <div[^>]+aria-label="Task filters"/);
});

test('selected task tab menu owns management while drag and menu actions reorder accessibly', () => {
  assert.match(tasksSource, /Add Tab/);
  assert.match(tasksSource, /openAdd\(jobTaskHeadings && activeHeadingId !== 'general' \? activeHeadingId : ''\)/);
  assert.match(tasksSource, /selected && persisted && canManageJobTaskHeadings/);
  assert.match(tasksSource, /aria-label=\{`Manage \$\{tab\.name\} tab`\}/);
  assert.match(tasksSource, /role="menu"/);
  assert.match(tasksSource, />Rename tab</);
  assert.match(tasksSource, />Delete tab</);
  assert.match(tasksSource, /draggable=\{persisted && canManageJobTaskHeadings\}/);
  assert.match(tasksSource, /onDrop=\{\(\) => \{ if \(persisted && draggedHeadingId\) moveHeadingTo/);
  assert.match(tasksSource, />Move left</);
  assert.match(tasksSource, />Move right</);
  assert.match(tasksSource, /onReorderHeadings\(orderedIds\)/);
  assert.doesNotMatch(tasksSource, /aria-label=\{`Rename \$\{tab\.name\} tab`\}/);
  assert.doesNotMatch(tasksSource, /aria-label=\{`Delete \$\{tab\.name\} tab`\}/);
});

test('non-empty task tabs require an explicit destination before deletion', () => {
  assert.match(tasksSource, /Choose what should happen to them\./);
  assert.match(tasksSource, /label="Move tasks to"/);
  assert.match(tasksSource, /Move Tasks and Delete Tab/);
  assert.match(tasksSource, /Delete Tasks and Tab/);
  assert.match(tasksSource, /Delete the tasks in this tab/);
  assert.match(tasksSource, /await onUpdate\(task\.id, \{[\s\S]*headingId: moveHeadingTasksTo/);
  assert.match(tasksSource, /await onDelete\(task\.id\)/);
  assert.match(tasksSource, /General always remains available/);
});

test('task add and edit preserve or change the optional heading relationship', () => {
  assert.match(tasksSource, /setHeadingId\(task\.headingId \?\? ''\)/);
  assert.match(tasksSource, /headingId: headingId \|\| undefined/);
  assert.match(tasksSource, /aria-label="Task tab"/);
  assert.match(typesSource, /headingId\?: ID/);
});

test('open tasks lead and completed tasks expand inline without duplicate actions', () => {
  assert.match(tasksSource, /const openTasks = sectionTasks\.filter\(\(task\) => task\.status === 'open'\)/);
  assert.match(tasksSource, /const completedTasks = sectionTasks\.filter\(\(task\) => task\.status === 'completed'\)/);
  assert.ok(tasksSource.indexOf('renderJobTaskList(openTasks)') < tasksSource.indexOf('Completed tasks ({completedTasks.length})'));
  assert.match(tasksSource, /aria-expanded=\{completedTasksExpanded\}/);
  assert.match(tasksSource, /completedTasksExpanded \? renderJobTaskList\(completedTasks\) : null/);
  assert.match(tasksSource, /No open tasks in this tab\./);
  assert.doesNotMatch(tasksSource, /title=\{filter === 'completed' \? 'No completed tasks'/);
  const jobPanelSource = tasksSource.slice(tasksSource.indexOf('id="job-task-tab-panel"'), tasksSource.indexOf(': visibleTasks.length === 0'));
  assert.doesNotMatch(jobPanelSource, /<EmptyState|<Plus \/>Add Task/);
});