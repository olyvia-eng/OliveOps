import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const workspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');

test('proposal email uses one secure versioned delivery path', () => {
  assert.match(estimatesSource, /Prepare and Send/);
  assert.match(estimatesSource, /navigate\(`\/estimates\/\$\{proposalEstimate\.id\}\?tab=proposal`\)/);
  assert.match(workspaceSource, /\/api\/proposal-delivery\?action=send/);
  assert.match(workspaceSource, /Send to Customer/);
  assert.match(workspaceSource, /Send New Version/);
  assert.doesNotMatch(estimatesSource + workspaceSource, /mailto:|Open Email Draft|local email app only/);
});
