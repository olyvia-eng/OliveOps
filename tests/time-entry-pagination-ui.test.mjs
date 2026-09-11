import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('shared Time Entry pagination rejects stale responses and preserves rows while loading or failing', async () => {
  const hook = await source('../src/hooks/useTimeEntryPage.ts');
  assert.match(hook, /requestSequence/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /completedRequestKey\.current === requestKey/);
  assert.match(hook, /completedRequestKey\.current = requestKey/);
  assert.match(hook, /refresh=\$\{refreshVersion\}/);
  assert.match(hook, /activeRequest\.current\?\.key === requestKey/);
  assert.doesNotMatch(hook, /setItems\(\[\]\)/);
  assert.match(hook, /setError\(/);
  assert.match(hook, /cursorHistory/);
  assert.match(hook, /activeRequest\.current = null/);
  assert.match(hook, /history\.length === 1 && history\[0\] === null \? history : \[null\]/);
  assert.match(hook, /const refresh = useCallback\(\(\) => \{\s*setCursorHistory\(\[null\]\);\s*setPageIndex\(0\)/);
});

test('initial requests omit cursors and blank or false filters', async () => {
  const hook = await source('../src/hooks/useTimeEntryPage.ts');
  assert.match(hook, /value !== undefined && value !== '' && value !== false/);
  assert.match(hook, /if \(cursor\) params\.set\('cursor', cursor\)/);
  assert.doesNotMatch(hook, /params\.set\('cursor', cursor \?\?/);
});

test('main and Job Time Entry surfaces use their required defaults and page sizes', async () => {
  const [reports, job] = await Promise.all([
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
  ]);
  assert.match(reports, /defaultPageSize: \[25, 50, 100\].*\? requestedPageSize : 25/);
  assert.match(reports, /value="25">25/);
  assert.match(reports, /value="50">50/);
  assert.match(reports, /value="100">100/);
  assert.match(job, /defaultPageSize: \[10, 25, 50\].*\? requestedJobPageSize : 10/);
  assert.match(job, /surface: 'job'/);
  assert.match(job, /jobId: id/);
  assert.match(job, /value="10">10/);
  assert.match(job, /value="25">25/);
  assert.match(job, /value="50">50/);
  assert.match(job, /activeTab !== 'project-management'/);
  assert.match(job, /searchParams\.get\('timeEntryPageSize'\) === String\(jobTimeEntryPage\.pageSize\)/);
});

test('pagination controls expose loading, errors, retry, and disabled navigation', async () => {
  const [reports, job] = await Promise.all([
    source('../src/pages/reports/TimeReportsPage.tsx'),
    source('../src/pages/jobs/JobDetailPage.tsx'),
  ]);
  for (const page of [reports, job]) {
    assert.match(page, />Previous</);
    assert.match(page, />Next</);
    assert.match(page, />Retry</);
    assert.match(page, /role="status"/);
    assert.match(page, /role="alert"/);
    assert.match(page, /disabled=\{![^}]*hasPrevious[^}]*loading/);
    assert.match(page, /disabled=\{![^}]*hasNext[^}]*loading/);
    assert.match(page, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  }
  assert.match(reports, /timeEntryPage\.loading \? \([\s\S]*: timeEntryPage\.error \? \([\s\S]*: timeEntryPage\.items\.length === 0 \? \(/);
  assert.match(job, /jobTimeEntryPage\.loading \?[\s\S]*: jobTimeEntryPage\.error \?[\s\S]*: jobTimeEntryPage\.items\.length === 0 \?/);
});