import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync('src/pages/home/PersonalHomeDashboard.tsx', 'utf8');
const gridSource = readFileSync('src/pages/home/CustomizableWidgetGrid.tsx', 'utf8');
const tasksSource = readFileSync('src/pages/home/OutstandingTasks.tsx', 'utf8');
const tasksStyles = readFileSync('src/pages/home/OutstandingTasks.css', 'utf8');
const preferencesHookSource = readFileSync('src/pages/home/useHomeDashboardPreferences.ts', 'utf8');
const sidebarWidgetsSource = readFileSync('src/pages/home/PersonalDashboardSidebar.tsx', 'utf8');
const appLayoutSource = readFileSync('src/components/layout/AppLayout.tsx', 'utf8');
const employeePortalSource = readFileSync('src/pages/employees/EmployeePortalPage.tsx', 'utf8');
const clockedInWidgetSource = readFileSync('src/pages/home/ClockedInNowWidget.tsx', 'utf8');
const bootstrapSource = readFileSync('api/bootstrap.js', 'utf8');

test('Home widgets use an edit-only header drag surface with interactive controls excluded', () => {
  assert.match(dashboardSource, /<CustomizableWidgetGrid/);
  assert.match(gridSource, /from 'react-grid-layout'/);
  assert.match(gridSource, /home-widget-drag-handle/);
  assert.match(gridSource, /handle: '\.home-widget-drag-handle'/);
  assert.match(gridSource, /cancel: 'button,a,input,select,textarea,\[role="button"\],\[role="tab"\]'/);
  assert.match(gridSource, /enabled: editing/);
  assert.doesNotMatch(gridSource, /ArrowLeft|ArrowRight|Move .* earlier|Move .* later/);
  assert.match(gridSource, /title="Remove widget"/);
  assert.match(gridSource, /aria-label={`Remove \$\{widget\.title\}`}/);
  assert.match(gridSource, /Add a widget/);
  assert.match(gridSource, /Reset layout/);
});

test('widget order and geometry are loaded and saved through user-scoped preferences', () => {
  assert.match(preferencesHookSource, /fetch\('\/api\/home-dashboard-preferences'/);
  assert.match(preferencesHookSource, /method: 'PATCH'/);
  assert.match(preferencesHookSource, /body: JSON\.stringify\(\{ widgetIds: nextWidgetIds, widgetLayout: nextWidgetLayout/);
  assert.match(preferencesHookSource, /normalizeHomeDashboardLayout\(payload\.preferences\?\.widgetLayout, nextWidgetIds\)/);
  assert.match(gridSource, /onChange\(homeWidgetIdsFromLayout\(nextLayout\), nextLayout\)/);
  assert.match(dashboardSource, /widgetLayout=\{dashboardPreferences\.widgetLayout\}/);
  assert.match(dashboardSource, /onChange=\{dashboardPreferences\.saveDashboard\}/);
});

test('personal sidebar cards are independently movable widgets', () => {
  assert.match(sidebarWidgetsSource, /export function MiniCalendarWidget/);
  assert.match(sidebarWidgetsSource, /export function UpcomingScheduleWidget/);
  assert.match(sidebarWidgetsSource, /export function RecentActivityWidget/);
  assert.match(sidebarWidgetsSource, /export function QuickActionsWidget/);
});

test('Home uses collision-managed responsive geometry and a simple mobile stack', () => {
  assert.match(gridSource, /layouts=\{\{ lg: toGridLayout\(widgetLayout, 12\), md: toGridLayout\(widgetLayout, 8\) \}\}/);
  assert.match(gridSource, /cols=\{\{ lg: 12, md: 8 \}\}/);
  assert.match(gridSource, /resizeConfig=\{\{ enabled: editing, handles: \['se'\] \}\}/);
  assert.match(gridSource, /onDragStop=\{\(layout\) => persistGridLayout\(layout\)\}/);
  assert.match(gridSource, /onResizeStop=\{\(layout\) => persistGridLayout\(layout\)\}/);
  assert.match(gridSource, /max-width: 767px/);
  assert.match(gridSource, /mobile \? <div className="grid grid-cols-1 gap-4">/);
  assert.match(gridSource, /minW: Math\.ceil\(spec\.minWidth \* scale\)/);
  assert.match(gridSource, /minH: spec\.minHeight/);
  assert.doesNotMatch(dashboardSource, /size: '(small|medium|large)'/);
});

test('Task category dropdown creates and immediately selects persisted custom categories', () => {
  assert.match(tasksSource, /<option value="">No category<\/option>/);
  assert.match(tasksSource, /<option value="__new_category__">\+ New category<\/option>/);
  assert.match(tasksSource, /label="Category name"/);
  assert.match(tasksSource, /const result = onCreateCustomTab\(categoryName\)/);
  assert.match(tasksSource, /setTaskTabId\(result\.tab\.id\)/);
  assert.match(tasksSource, /customTaskTabs\.map\(\(tab\) => <option key=\{tab\.id\} value=\{tab\.id\}>\{tab\.name\}<\/option>\)/);
  assert.match(preferencesHookSource, /setCustomTaskTabs\(nextTabs\)/);
  assert.match(preferencesHookSource, /savePreferences\(widgetIds, widgetLayout, taskFilterLabels, nextTabs, nextOrder/);
});

test('Task categories retain the existing rename and delete management paths', () => {
  assert.match(tasksSource, /Manage categories\.\.\./);
  assert.match(tasksSource, /aria-label="Manage task categories"/);
  assert.match(tasksSource, /openTabDialog\('rename', tab\)/);
  assert.match(tasksSource, /openTabDialog\('delete', tab\)/);
  assert.match(tasksSource, /onRenameCustomTab\(selectedTab\.id, tabName\)/);
  assert.match(tasksSource, /onDeleteCustomTab\(selectedTab\.id\)/);
});

test('Task and subtask editors respond to widget width without collapsing the title', () => {
  assert.match(tasksSource, /className="tasks-widget/);
  assert.match(tasksSource, /data-editor-kind=\{parentTask \? 'subtask' : editingTask \? 'edit' : 'task'\}/);
  assert.match(tasksSource, /className="tasks-editor-title min-h-10 bg-white focus:ring-2/);
  assert.match(tasksStyles, /\.tasks-widget\s*\{[^}]*container-type: inline-size/s);
  assert.match(tasksStyles, /\.tasks-editor\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(tasksStyles, /\.tasks-editor-title\s*\{[^}]*min-width: 12rem/s);
  assert.match(tasksStyles, /\.tasks-editor-controls\s*\{[^}]*flex-wrap: wrap/s);
  assert.match(tasksStyles, /@container \(min-width: 56rem\)/);
  assert.doesNotMatch(tasksSource, /sm:grid-cols-\[minmax\(0,1fr\)/);
});

test('Task editor keeps submit primary and cancel secondary while editors remain mounted during resize', () => {
  assert.match(tasksSource, /variant=\{adding \? 'ghost' : 'primary'\}/);
  assert.match(tasksSource, /parentTask \? 'Add Subtask' : 'Add Task'/);
  assert.match(tasksSource, /\{adding \? \(/);
  assert.match(gridSource, /onResizeStop=\{\(layout\) => persistGridLayout\(layout\)\}/);
  assert.doesNotMatch(gridSource, /onResizeStart=.*setAdding/);
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
