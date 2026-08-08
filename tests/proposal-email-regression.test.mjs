import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');

test('proposal email actions stay manual until backend delivery exists', () => {
  assert.match(estimatesSource, /Open Email Draft/);
  assert.match(estimatesSource, /Open Email Draft uses your local email app only\./);
  assert.doesNotMatch(estimatesSource, /Email draft opened\. Attach the proposal PDF and send\./);

  assert.match(workspaceSource, /Open Email Draft/);
  assert.match(workspaceSource, /OliveOps does not send proposal email directly yet\./);
  assert.doesNotMatch(workspaceSource, /Email draft opened\. Attach the proposal PDF and send\./);
});
