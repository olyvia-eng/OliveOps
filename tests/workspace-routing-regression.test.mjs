import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const budgetsSource = readFileSync('src/pages/budget/BudgetsPage.tsx', 'utf8');
const budgetDetailSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const estimateWorkspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const workAreaBuilderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const jobWorkspaceSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const combinedBudgetSource = readFileSync('src/pages/budget/CombinedBudgetPage.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const sidebarConfigSource = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const userAccessPageSource = readFileSync('src/pages/users/UserAccessPage.tsx', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');

test('estimate and job workspaces are wired with the current user role', () => {
  assert.match(appSource, /path="estimates\/:id"/);
  assert.match(appSource, /<EstimateWorkspacePage currentUserRole=\{sessionUser\.role\} \/>/);
  assert.match(appSource, /<JobDetailPage currentUserRole=\{sessionUser\.role\} \/>/);
});

test('lightweight estimate creation returns an id and opens the workspace', () => {
  assert.match(storeSource, /addEstimate: \(e: Omit<Estimate,[^\n]+\) => ID;/);
  assert.match(estimatesSource, /const estimateId = addEstimate\(\{/);
  assert.match(estimatesSource, /workAreas: \[\],\s+lineItems: \[\],/);
  assert.match(estimatesSource, /navigate\(`\/estimates\/\$\{estimateId\}`\);/);
  assert.match(estimatesSource, /Customer and pricing budget are required to start an estimate\./);
});

test('estimate list title and action both open the dedicated workspace', () => {
  const workspaceNavigations = estimatesSource.match(/navigate\(`\/estimates\/\$\{estimate\.id\}`\)/g) ?? [];
  assert.equal(workspaceNavigations.length, 2);
  assert.match(estimatesSource, /title="Open Workspace"/);
});

test('estimate editing uses a URL-backed tab workspace with restricted analysis', () => {
  for (const tab of ['info', 'work-areas', 'proposal', 'project-management', 'analysis']) {
    assert.match(estimateWorkspaceSource, new RegExp(`key: '${tab}'`));
  }
  assert.match(estimateWorkspaceSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(estimateWorkspaceSource, /activeTab === 'analysis' && canViewAnalysis/);
  assert.match(estimateWorkspaceSource, /setSearchParams\(\(previous\) =>/);
  assert.match(estimateWorkspaceSource, /No work areas yet/);
  assert.match(estimateWorkspaceSource, /Estimated Cost/);
  assert.match(estimateWorkspaceSource, /Open Work Area/);
  assert.match(estimateWorkspaceSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{workArea\.id\}`\)/);
  assert.match(estimateWorkspaceSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{workAreaId\}`\)/);
  assert.match(estimateWorkspaceSource, /\{budgets\.map\(\(budget\) => \(/);
  assert.match(estimateWorkspaceSource, /Your proposal isn't ready yet/);
  assert.match(estimateWorkspaceSource, /Nothing to analyze yet/);
});

test('work-area builder uses a dedicated nested route and returns to estimate work-areas tab', () => {
  assert.match(appSource, /path="estimates\/:id\/work-areas\/:workAreaId"/);
  assert.match(appSource, /<EstimateWorkAreaBuilderPage currentUserRole=\{sessionUser\.role\} \/>/);
  assert.match(workAreaBuilderSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\?tab=work-areas`\)/);
  assert.match(workAreaBuilderSource, /Pricing: \$\{pricingBudget\.name\}/);
  assert.match(workAreaBuilderSource, /rate\.budgetId === estimate\.pricingBudgetId/);
  assert.match(workAreaBuilderSource, /Custom Line Item|Custom \$\{CATEGORY_LABEL\[customItemCategory\]\} Item/);
  assert.match(workAreaBuilderSource, /Delete Work Area/);
});

test('budget screens use free-text division input and keep detail display formatting', () => {
  assert.match(budgetsSource, /<Input\s+label="Division"/);
  assert.match(budgetsSource, /const payload = \{/);
  assert.match(budgetsSource, /const created = await addBudget\(payload\);/);
  assert.match(budgetsSource, /const startInlineBudgetNameEdit = \(budgetId: string, currentName: string\) => \{/);
  assert.match(budgetsSource, /const saveInlineBudgetNameEdit = \(budgetId: string\) => \{/);
  assert.match(budgetsSource, /onKeyDown=\{\(event\) => \{/);
  assert.match(budgetsSource, /if \(event.key === 'Enter'\)/);
  assert.match(budgetsSource, /if \(event.key === 'Escape'\)/);
  assert.match(budgetsSource, /aria-label=\{`Edit \$\{budget\.name\}`\}/);
  assert.match(budgetDetailSource, /Budget not found/);
  assert.match(budgetDetailSource, /toOptionLabel\(activeBudget\.division\)/);
  assert.match(budgetsSource, /View Combined Budget/);
  assert.match(budgetsSource, /Select all visible budgets/);
  assert.match(appSource, /path="budgets\/combined"/);
  assert.match(combinedBudgetSource, /Read-only reporting view across multiple existing budgets/);
  assert.match(combinedBudgetSource, /Back to Budgets/);
});

test('budget list row navigation and control interactions remain consistent', () => {
  assert.match(budgetsSource, /onClick=\{\(\) => navigate\(`\/budgets\/\$\{budget\.id\}`\)\}/);
  assert.match(budgetsSource, /tabIndex=\{0\}/);
  assert.match(budgetsSource, /if \(event\.target !== event\.currentTarget\) return;/);
  assert.match(budgetsSource, /if \(event\.key === 'Enter' \|\| event\.key === ' '\)/);
  assert.match(budgetsSource, /<td className="px-4 py-3 font-medium text-gray-900">/);
  assert.doesNotMatch(budgetsSource, /<td className="px-4 py-3 font-medium text-gray-900" onClick=\{\(event\) => event\.stopPropagation\(\)\}>/);

  assert.match(budgetsSource, /<td className="px-4 py-3" onClick=\{\(event\) => event\.stopPropagation\(\)\}>/);
  assert.match(budgetsSource, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*startInlineBudgetNameEdit\(budget\.id, budget\.name\);/);
  assert.match(budgetsSource, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*setBudgetToDelete\(budget\.id\);/);
  assert.match(budgetsSource, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*saveInlineBudgetNameEdit\(budget\.id\);/);
  assert.match(budgetsSource, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*cancelInlineBudgetNameEdit\(\);/);
  assert.match(budgetsSource, /<div className="space-y-2" onClick=\{\(event\) => event\.stopPropagation\(\)\}>/);

  assert.match(budgetsSource, /View Combined Budget/);
  assert.match(budgetsSource, /Select all visible budgets/);
});

test('job workspace preserves operational tabs and scopes related invoices to the job', () => {
  for (const tab of ['info', 'work-areas', 'proposal', 'project-management', 'analysis', 'invoices']) {
    assert.match(jobWorkspaceSource, new RegExp(`key: '${tab}'`));
  }
  assert.match(jobWorkspaceSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(jobWorkspaceSource, /invoices\.filter\(\(invoice\) => invoice\.jobId === id\)/);
  assert.match(jobWorkspaceSource, /activeTab === 'invoices'/);
  assert.match(jobWorkspaceSource, /activeTab === 'project-management'/);
  assert.match(jobWorkspaceSource, /No work areas have been added to this job/);
  assert.match(jobWorkspaceSource, /Job analysis will appear as costs and progress are recorded/);
  assert.match(jobWorkspaceSource, /No invoices yet/);
});

test('company setup sidebar keeps existing routes and account terminology', () => {
  assert.match(sidebarSource, /Company Setup/);
  assert.match(sidebarSource, /Users & Access/);
  assert.match(sidebarSource, /Unbillable Categories/);
  assert.match(sidebarSource, /path: '\/user-access'/);
  assert.match(sidebarSource, /path: '\/settings\/unbillable-time-categories'/);
  assert.match(appSource, /path="user-access"/);
  assert.match(appSource, /path="settings\/unbillable-time-categories"/);
  assert.match(userAccessPageSource, /title="Users & Access"/);
  assert.match(userAccessPageSource, /Manage who can sign in to OliveOps and control their account access\./);
  assert.doesNotMatch(sidebarConfigSource, /id: 'operations-unbillable-time-categories'/);
});
