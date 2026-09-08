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
