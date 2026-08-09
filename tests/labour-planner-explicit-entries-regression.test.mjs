import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('budget labour planner keeps explicit entries and supports reorder/remove interactions', () => {
  const source = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');

  assert.doesNotMatch(source, /for \(const employee of employees\.filter\(\(value\) => value\.active\)\)/);
  assert.match(source, /const labourPlansForYear = useMemo\(\(\) =>/);
  assert.match(source, /draggable/);
  assert.match(source, /Remove from Budget/);
  assert.match(source, /updateLabourPlan\(row\.employee\.id, 'description'/);
  assert.match(source, /sortOrder/);
});
