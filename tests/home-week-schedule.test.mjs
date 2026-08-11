import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/home/HomePage.tsx', 'utf8');

test('Home answers what company work is scheduled this week using the shared schedule model', () => {
  assert.match(source, /This Week/);
  assert.match(source, /startOfWeek\(today, \{ weekStartsOn: 1 \}\)/);
  assert.match(source, /groupScheduleEntriesByDay/);
  assert.match(source, /getEffectiveDivision/);
  assert.match(source, /resolveScheduleColour\(\{ colourBy: 'crew'/);
  assert.match(source, /Unassigned crew/);
});