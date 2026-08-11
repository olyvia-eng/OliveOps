import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/home/HomePage.tsx', 'utf8');
const summarySource = readFileSync('src/components/calendar/WeeklyScheduleSummary.tsx', 'utf8');

test('Home answers what company work is scheduled this week using the shared schedule model', () => {
  assert.match(source, /This Week/);
  assert.match(source, /useMemo\(\(\) => startOfWeek\(new Date\(\), \{ weekStartsOn: 1 \}\), \[\]\)/);
  assert.match(source, /getEffectiveDivision/);
  assert.match(source, /normalizeExternalScheduleEntry/);
  assert.match(source, /<WeeklyScheduleSummary/);
  assert.doesNotMatch(source, /googleEvents\.slice\(0, 5\)\.map/);
  assert.match(summarySource, /buildWeeklyScheduleSpans/);
  assert.match(summarySource, /showWeekend/);
  assert.match(summarySource, /todayKey/);
  assert.match(source, /Unassigned crew/);
});

test('Home renders date-only work without redundant all-day text and keeps source-aware quick views', () => {
  assert.match(source, /window\.allDay \? '' : formatScheduleTimeLabel\(job\)/);
  assert.match(source, /entry\.source === 'external'/);
  assert.match(source, /setSelectedExternalEvent\(entry\.externalEvent\)/);
  assert.match(source, /setSelectedJobId\(entry\.jobId \?\? null\)/);
  assert.match(summarySource, /entry\.allDay \? '' : entry\.timeLabel/);
});