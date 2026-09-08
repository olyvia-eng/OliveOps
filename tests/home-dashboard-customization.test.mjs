import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync('src/pages/home/PersonalHomeDashboard.tsx', 'utf8');
const gridSource = readFileSync('src/pages/home/CustomizableWidgetGrid.tsx', 'utf8');
const preferencesHookSource = readFileSync('src/pages/home/useHomeDashboardPreferences.ts', 'utf8');
const sidebarWidgetsSource = readFileSync('src/pages/home/PersonalDashboardSidebar.tsx', 'utf8');
const appLayoutSource = readFileSync('src/components/layout/AppLayout.tsx', 'utf8');
const employeePortalSource = readFileSync('src/pages/employees/EmployeePortalPage.tsx', 'utf8');
const clockedInWidgetSource = readFileSync('src/pages/home/ClockedInNowWidget.tsx', 'utf8');
const bootstrapSource = readFileSync('api/bootstrap.js', 'utf8');

test('Home widgets use handle-only mouse and touch drag with removal, add, and reset', () => {
  assert.match(dashboardSource, /<CustomizableWidgetGrid/);
  assert.match(gridSource, /draggable/);
  assert.match(gridSource, /onDragStart/);
  assert.match(gridSource, /onDrop/);
  assert.match(gridSource, /onPointerDown/);
  assert.match(gridSource, /onPointerMove/);
  assert.match(gridSource, /onPointerUp/);
  assert.match(gridSource, /touch-none cursor-grab/);
  assert.doesNotMatch(gridSource, /ArrowLeft|ArrowRight|Move .* earlier|Move .* later/);
  assert.match(gridSource, /title="Remove widget"/);
  assert.match(gridSource, /aria-label={`Remove \$\{widget\.title\}`}/);
  assert.match(gridSource, /Add a widget/);
  assert.match(gridSource, /Reset layout/);
});

test('widget order is loaded and saved through user-scoped preferences', () => {
  assert.match(preferencesHookSource, /fetch\('\/api\/home-dashboard-preferences'/);
  assert.match(preferencesHookSource, /method: 'PATCH'/);
  assert.match(preferencesHookSource, /body: JSON\.stringify\(\{ widgetIds: nextWidgetIds, taskFilterLabels: nextLabels, customTaskTabs: nextTabs, taskFilterOrder: nextOrder, dismissedTodayTaskIds: nextDismissedIds, deletedTaskTabId \}\)/);
  assert.match(gridSource, /onChange\(reorderHomeWidgetIds\(widgetIds, draggedId, targetId\)\)/);
});

test('personal sidebar cards are independently movable widgets', () => {
  assert.match(sidebarWidgetsSource, /export function MiniCalendarWidget/);
  assert.match(sidebarWidgetsSource, /export function UpcomingScheduleWidget/);
  assert.match(sidebarWidgetsSource, /export function RecentActivityWidget/);
  assert.match(sidebarWidgetsSource, /export function QuickActionsWidget/);
});

test('Home uses preferred widget sizes in a responsive grid that fills incomplete rows', () => {
  assert.match(gridSource, /size: 'small' \| 'medium' \| 'large'/);
  assert.match(gridSource, /md:grid-cols-6 xl:grid-cols-12/);
  assert.match(gridSource, /function balancedSpans/);
  assert.match(gridSource, /fillRow\(spans\.length\)/);
  assert.match(dashboardSource, /id: 'calendar'.*size: 'large'/);
  assert.match(dashboardSource, /id: 'tasks'.*size: 'large'/);
  assert.match(dashboardSource, /id: 'activity'.*size: 'medium'/);
  assert.match(dashboardSource, /id: 'quick-actions'.*size: 'medium'/);
});

test('Home dashboard containers use the wider application layout', () => {
  assert.match(appLayoutSource, /isHome \? 'max-w-\[1600px\]'/);
  assert.match(employeePortalSource, /portalView === 'calendar' \? 'max-w-\[1600px\]'/);
});

test('Finance widgets are optional and only defined for financial roles', () => {
  assert.match(dashboardSource, /canViewFinancials \? invoices\.filter/);
  assert.match(dashboardSource, /\.\.\.\(canViewFinancials \? \[/);
  assert.match(dashboardSource, /finance-outstanding-invoices/);
  assert.match(dashboardSource, /finance-overdue-invoices/);
  assert.match(dashboardSource, /finance-budget-profit/);
  assert.match(dashboardSource, /Outstanding Invoices/);
  assert.match(dashboardSource, /Budgeted Profit/);
});

test('Clocked In Now derives from authenticated bootstrap state without a fetch loop', () => {
  assert.match(dashboardSource, /canViewFinancials \? \[/);
  assert.match(dashboardSource, /id: 'clocked-in-now'/);
  assert.match(dashboardSource, /buildClockedInNowItems\(timeEntries, employees, jobs\)/);
  assert.doesNotMatch(clockedInWidgetSource, /fetch\(|Retry|setInterval.*fetch/);
  assert.match(clockedInWidgetSource, /No employees are currently clocked in\./);
  assert.match(clockedInWidgetSource, /items\.slice\(0, 6\)/);
  assert.match(clockedInWidgetSource, /to="\/time-reports"/);
  assert.match(bootstrapSource, /loadCoreBootstrapData\(session\.businessId\)/);
  assert.match(bootstrapSource, /timeEntries: filterRecordsForSession\(session, 'time-entries', timeEntries\)/);
});
