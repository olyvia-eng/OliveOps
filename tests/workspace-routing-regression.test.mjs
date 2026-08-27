import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('src/App.tsx', 'utf8');
const budgetsSource = readFileSync('src/pages/budget/BudgetsOverviewPage.tsx', 'utf8');
const budgetWorkspaceSource = readFileSync('src/pages/budget/BudgetWorkspacePage.tsx', 'utf8');
const budgetDetailSource = readFileSync('src/pages/budget/BudgetPage.tsx', 'utf8');
const estimatesSource = readFileSync('src/pages/estimates/EstimatesPage.tsx', 'utf8');
const estimateWorkspaceSource = readFileSync('src/pages/estimates/EstimateWorkspacePage.tsx', 'utf8');
const workAreaBuilderSource = readFileSync('src/pages/estimates/EstimateWorkAreaBuilderPage.tsx', 'utf8');
const jobWorkspaceSource = readFileSync('src/pages/jobs/JobDetailPage.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const sidebarItemSource = readFileSync('src/components/layout/SidebarItem.tsx', 'utf8');
const appLayoutSource = readFileSync('src/components/layout/AppLayout.tsx', 'utf8');
const sidebarConfigSource = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const userAccessPageSource = readFileSync('src/pages/users/UserAccessPage.tsx', 'utf8');
const storeSource = readFileSync('src/store/index.ts', 'utf8');

test('estimate and job workspaces are wired with the current user context', () => {
  assert.match(appSource, /path="estimates\/:id"/);
  assert.match(appSource, /<EstimateWorkspacePage currentUserRole=\{sessionUser\.role\} \/>/);
  assert.match(appSource, /<JobDetailPage currentUserRole=\{sessionUser\.role\} currentUserId=\{sessionUser\.id\} \/>/);
});

test('lightweight estimate creation returns an id and opens the workspace', () => {
  assert.match(storeSource, /addEstimate: \(e: Omit<Estimate,[^\n]+\) => Promise<ID \| null>;/);
  assert.match(estimatesSource, /const estimateId = await addEstimate\(\{/);
  assert.match(estimatesSource, /workAreas: \[generalWorkArea\]/);
  assert.match(estimatesSource, /if \(!estimateId\) return;/);
  assert.match(estimatesSource, /navigate\(`\/estimates\/\$\{estimateId\}`\);/);
  assert.match(estimatesSource, /Customer, pricing budget, and Division are required to start an estimate\./);
});

test('estimate list title and action open URL-backed details with a dedicated workspace available', () => {
  assert.match(estimatesSource, /const selectEstimate = \(estimateId: string\) => setSearchParams\(openDetailWorkspace/);
  assert.match(estimatesSource, /onClick=\{\(\) => selectEstimate\(estimate\.id\)\}/);
  assert.match(estimatesSource, /title="Open Details"/);
  assert.match(appSource, /path="estimates\/:id"/);
});

test('estimate editing uses a URL-backed tab workspace with restricted analysis', () => {
  for (const tab of ['info', 'work-areas', 'proposal', 'analysis']) {
    assert.match(estimateWorkspaceSource, new RegExp(`key: '${tab}'`));
  }
  assert.doesNotMatch(estimateWorkspaceSource, /key: 'project-management'|activeTab === 'project-management'/);
  assert.match(estimateWorkspaceSource, /activeTab === 'proposal'[\s\S]*form\.status === 'accepted'[\s\S]*Convert to Job/);
  assert.match(estimateWorkspaceSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(estimateWorkspaceSource, /activeTab === 'analysis' && canViewAnalysis/);
  assert.match(estimateWorkspaceSource, /setSearchParams\(\(previous\) =>/);
  assert.match(estimateWorkspaceSource, /No work areas yet/);
  assert.match(estimateWorkspaceSource, /Estimated Cost/);
  assert.match(estimateWorkspaceSource, /Open Work Area/);
  assert.match(estimateWorkspaceSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{workArea\.id\}`\)/);
  assert.match(estimateWorkspaceSource, /saved = await persistEstimateForm\(nextForm\);\s*\} finally \{\s*saveInFlight\.current = false;\s*setSavingEstimate\(false\);\s*\}\s*if \(saved\) \{\s*navigate\(`\/estimates\/\$\{estimate\.id\}\/work-areas\/\$\{nextWorkArea\.id\}`\)/);
  assert.match(estimateWorkspaceSource, /\{budgets\.map\(\(budget\) => \(/);
  assert.match(estimateWorkspaceSource, /Your proposal isn't ready yet/);
  assert.match(estimateWorkspaceSource, /Nothing to analyze yet/);
});

test('work-area builder uses a dedicated nested route and returns to estimate work-areas tab', () => {
  assert.match(appSource, /path="estimates\/:id\/work-areas\/:workAreaId"/);
  assert.match(appSource, /<EstimateWorkAreaBuilderPage currentUserRole=\{sessionUser\.role\} \/>/);
  assert.match(workAreaBuilderSource, /navigate\(`\/estimates\/\$\{estimate\.id\}\?tab=work-areas`\)/);
  assert.match(workAreaBuilderSource, /Pricing: \$\{pricingBudget\.name\}/);
  assert.match(workAreaBuilderSource, /fetch\(`\/api\/estimate-pricing-catalog\?estimateId=\$\{encodeURIComponent\(estimate\.id\)\}`/);
  assert.match(workAreaBuilderSource, /applyEstimatePricingToLineItem\(createEmptyEstimateLineItem\(candidate\.category\), estimate\.pricingBudgetId, pricingItem\)/);
  assert.match(workAreaBuilderSource, /Custom \$\{CATEGORY_ADD_LABEL\[customItemCategory\]\}/);
  assert.match(workAreaBuilderSource, /Delete Work Area/);
});

test('work-area builder puts totals below the name and scope after line items', () => {
  const nameIndex = workAreaBuilderSource.indexOf('label="Work Area Name"');
  const totalsIndex = workAreaBuilderSource.indexOf('Work Area Totals');
  const categoriesIndex = workAreaBuilderSource.indexOf('{CATEGORY_ORDER.map(renderLineItemGroup)}');
  const scopeIndex = workAreaBuilderSource.indexOf('label="Description / Scope"');
  assert.ok(nameIndex >= 0 && nameIndex < totalsIndex);
  assert.ok(totalsIndex < categoriesIndex && categoriesIndex < scopeIndex);
  assert.doesNotMatch(workAreaBuilderSource, />Sell Total</);
});

test('Budget screens use the parent workspace without exposing legacy compatibility routes', () => {
  assert.doesNotMatch(budgetsSource, /label="Division"|New Group|Group Selected/);
  assert.match(budgetsSource, /const created = await addBudget/);
  assert.match(budgetsSource, /navigate\(`\/budgets\/\$\{created\.id\}\?tab=info`\)/);
  assert.match(budgetWorkspaceSource, /Info[\s\S]*Divisions[\s\S]*Profit & Loss[\s\S]*Analysis/);
  assert.doesNotMatch(budgetWorkspaceSource, /company-overhead|CompanyOverheadSection/);
  assert.doesNotMatch(budgetWorkspaceSource, /Open Legacy Planning|Legacy Planning/);
  assert.match(budgetDetailSource, /Budget not found/);
  assert.match(budgetDetailSource, /toOptionLabel\(activeBudget\.division\)/);
  assert.doesNotMatch(appSource, /budgets\/:budgetId\/legacy|budgets\/combined|budgets\/groups\/:groupId/);
  assert.doesNotMatch(budgetDetailSource, /<h2 className="text-lg font-semibold text-gray-900">Pricing \/ Rates<\/h2>/);
});

test('Budget list rows open Info and hide legacy roll-ups', () => {
  assert.match(budgetsSource, /onClick=\{\(\) => navigate\(`\/budgets\/\$\{budget\.id\}\?tab=info`\)\}/);
  assert.match(budgetsSource, /<button[\s\S]*type="button"[\s\S]*hover:bg-brand-50/);
  assert.match(budgetsSource, /Ellipsis[\s\S]*Delete Budget/);
  assert.doesNotMatch(budgetsSource, /Legacy budget roll-ups|budgets\/groups/);
  assert.doesNotMatch(budgetsSource, /Pencil|saveInlineBudgetNameEdit|dissolveBudgetGroup/);
});

test('job workspace preserves operational tabs and scopes related invoices to the job', () => {
  for (const tab of ['info', 'work-areas', 'proposal', 'project-management', 'analysis', 'invoices']) {
    assert.match(jobWorkspaceSource, new RegExp(`key: '${tab}'`));
  }
  assert.match(jobWorkspaceSource, /currentUserRole === 'owner' \|\| currentUserRole === 'admin'/);
  assert.match(jobWorkspaceSource, /invoices\.filter\(\(invoice\) => invoice\.jobId === id\)/);
  assert.match(jobWorkspaceSource, /activeTab === 'invoices'/);
  assert.match(jobWorkspaceSource, /activeTab === 'project-management'/);
  assert.doesNotMatch(jobWorkspaceSource, />Actual Costs<\/h2>|Add Cost Entry/);
  assert.match(jobWorkspaceSource, /employeeTimeEntryNotes[\s\S]*entry\.notes/);
  assert.match(jobWorkspaceSource, /<h2 className="font-semibold">Photos<\/h2>/);
  assert.match(jobWorkspaceSource, /clockInPhotoFileId[\s\S]*clockOutPhotoFileIds[\s\S]*photoAttachmentFileIds/);
  assert.match(jobWorkspaceSource, /form\.assignedTo === 'job' && form\.assignmentValue === id/);
  assert.match(jobWorkspaceSource, /submission\.jobId !== id/);
  assert.match(jobWorkspaceSource, />Assigned Forms<\/h2>/);
  assert.match(jobWorkspaceSource, /to="\/operations\/forms"/);
  const projectManagementSource = jobWorkspaceSource.slice(jobWorkspaceSource.indexOf("activeTab === 'project-management'"), jobWorkspaceSource.indexOf("activeTab === 'invoices'"));
  const notesIndex = projectManagementSource.indexOf('>Notes</h2>');
  const photosIndex = projectManagementSource.indexOf('>Photos</h2>');
  const formsIndex = projectManagementSource.indexOf('>Assigned Forms</h2>');
  const timeEntriesIndex = projectManagementSource.indexOf('>Time Entries</h2>');
  assert.ok(notesIndex >= 0 && notesIndex < formsIndex && formsIndex < timeEntriesIndex);
  assert.ok(photosIndex >= 0 && photosIndex < formsIndex);
  assert.match(projectManagementSource, /View Submissions \(\{submissionCount\}\)/);
  assert.match(projectManagementSource, /0 submissions[\s\S]*No submissions yet/);
  assert.match(jobWorkspaceSource, /forms-review\?jobId=\$\{encodeURIComponent\(id\)\}&formId=\$\{encodeURIComponent\(form\.id\)\}/);
  assert.match(jobWorkspaceSource, /formId=\$\{encodeURIComponent\(submissionForm\.id\)\}&id=\$\{encodeURIComponent\(submissionId\)\}/);
  assert.match(jobWorkspaceSource, /submission\.employeeName[\s\S]*submission\.submittedAt[\s\S]*submission\.status/);
  assert.match(jobWorkspaceSource, /submissionDetail\.responses\.map[\s\S]*answer\.fieldLabel[\s\S]*answer\.value/);
  assert.match(jobWorkspaceSource, /answer\.fieldType === 'photo_upload' \|\| answer\.fieldType === 'signature'/);
  assert.match(jobWorkspaceSource, /This view is read-only\. Approval and rejection remain in Forms → Submissions\./);
  assert.match(jobWorkspaceSource, />Open Review Workflow<\/Button>/);
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
  assert.doesNotMatch(sidebarSource, /\{ label: 'Catalog', path: '\/materials\/catalog'/);
});

test('sidebar uses contractor-oriented workflow, team, and business sections', () => {
  assert.doesNotMatch(sidebarConfigSource, /id: 'data-center-company-dashboard'/);
  assert.doesNotMatch(sidebarConfigSource, /id: 'finance-reports'/);
  assert.doesNotMatch(sidebarConfigSource, /label: 'Company Dashboard'/);
  assert.match(sidebarConfigSource, /title: 'Workflow'[\s\S]*title: 'Team'[\s\S]*title: 'Business'/);
  assert.match(sidebarConfigSource, /title: 'Workflow'[\s\S]*label: 'Clients'[\s\S]*label: 'Estimates'[\s\S]*label: 'Jobs'[\s\S]*label: 'Schedule'/);
  assert.match(sidebarConfigSource, /title: 'Team'[\s\S]*label: 'Employees'[\s\S]*label: 'Time Tracking'[\s\S]*label: 'Forms'/);
  assert.match(sidebarConfigSource, /title: 'Business'[\s\S]*label: 'Budgets'[\s\S]*label: 'Catalog'[\s\S]*label: 'Reports'[\s\S]*label: 'Documents'[\s\S]*label: 'Invoices'/);
  assert.equal((sidebarConfigSource.match(/collapsible: false/g) ?? []).length, 3);
  assert.equal((sidebarConfigSource.match(/defaultExpanded: true/g) ?? []).length, 3);
  assert.match(sidebarConfigSource, /to: '\/data-center\/dashboard', label: 'Reports'/);
  assert.match(sidebarConfigSource, /label: 'Reports',[^\n]+roles: ownerAdminRoles/);
  assert.match(sidebarConfigSource, /label: 'Time Tracking',[\s\S]*?roles: ownerAdminRoles/);
  for (const oldHeading of ['Data Center', 'Revenue', 'Finance', 'Operations', 'Employees']) {
    assert.doesNotMatch(sidebarConfigSource, new RegExp(`title: '${oldHeading}'`));
  }
});

test('Pinned Pages is removed from navigation and the app shell', () => {
  for (const source of [sidebarConfigSource, sidebarSource, sidebarItemSource, appLayoutSource]) {
    assert.doesNotMatch(source, /PinnedPages|usePinnedPages|pinnedPages|togglePinnedPage|reorderPinnedPages/);
  }
  assert.doesNotMatch(sidebarSource, /oliveops\.navigation\.(?:pinned-pages|favorites)/);
  assert.doesNotMatch(sidebarItemSource, /aria-label=\{pinned \?/);
});
