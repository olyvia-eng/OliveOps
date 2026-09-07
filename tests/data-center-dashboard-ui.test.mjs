import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync('src/pages/department-dashboards/DataCenterDashboardPage.tsx', 'utf8');
const sidebarSource = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

test('Business Reports exposes four calm top-level categories with contextual sub-navigation', () => {
  assert.match(sidebarSource, /to: '\/data-center\/dashboard', label: 'Reports'/);
  assert.match(pageSource, /\['overview', 'sales-jobs', 'operations', 'financial'\]/);
  assert.match(pageSource, /\['overview', 'sales', 'jobs', 'labour', 'equipment', 'financial', 'customers'\]/);
  assert.match(pageSource, /Sales & Jobs/);
  assert.match(pageSource, /activeCategory === 'sales-jobs'/);
  assert.match(pageSource, /\['sales', 'jobs', 'customers'\]/);
  assert.match(pageSource, /activeCategory === 'operations'/);
  assert.match(pageSource, /\['labour', 'equipment'\]/);
  assert.match(pageSource, /aria-label="Reports"/);
  assert.doesNotMatch(pageSource, /DASHBOARD_TABS\.map\(\(tab\).*role="tab"/);
});

test('date and division are compact URL-backed filters with an overlaid custom range', () => {
  assert.match(pageSource, /useSearchParams\(\)/);
  assert.match(pageSource, /This Month/);
  assert.match(pageSource, /Quarter/);
  assert.match(pageSource, /YTD/);
  assert.match(pageSource, /Last Year/);
  assert.match(pageSource, /Custom/);
  assert.match(pageSource, /All Divisions/);
  assert.match(pageSource, /filterDataCenterRecords\(\{ divisionId, range/);
  assert.match(pageSource, /updateFilter\('division'/);
  assert.match(pageSource, /updateFilter\('range'/);
  assert.match(pageSource, /aria-label="Reporting period"/);
  assert.match(pageSource, /aria-label="Custom reporting period"/);
  assert.match(pageSource, /absolute left-0 top-12/);
  assert.match(pageSource, /flex flex-wrap items-center/);
  assert.match(pageSource, /dateLabel/);
  assert.doesNotMatch(pageSource, /<Card className="rounded-lg p-4">[\s\S]{0,500}Date/);
});

test('legacy report query tabs remain valid and map into consolidated categories', () => {
  assert.match(pageSource, /tabParam && DASHBOARD_TABS\.includes\(tabParam\)/);
  assert.match(pageSource, /tab === 'sales' \|\| tab === 'jobs' \|\| tab === 'customers'/);
  assert.match(pageSource, /tab === 'labour' \|\| tab === 'equipment'/);
  assert.match(pageSource, /CATEGORY_DEFAULT_TAB/);
});

test('Overview keeps core KPIs and replaces unrelated count bars with recorded financials', () => {
  assert.match(pageSource, /Sales Pipeline/);
  assert.match(pageSource, /Active Jobs/);
  assert.match(pageSource, /Labour Logged/);
  assert.match(pageSource, /Outstanding/);
  assert.match(pageSource, /Work in motion/);
  assert.match(pageSource, /Period financials/);
  assert.match(pageSource, /Recorded expenses/);
  assert.doesNotMatch(pageSource, /Operating pulse/);
});

test('Reports uses standardized page naming', () => {
  assert.match(pageSource, /title="Reports"/);
  assert.match(pageSource, /subtitle="Business performance and reporting\."/);
  assert.doesNotMatch(pageSource, /title="Dashboards"/);
});

test('dashboard financial reporting is restricted to owner and admin roles', () => {
  assert.match(sidebarSource, /business-reports[^\n]+roles: ownerAdminRoles/);
  assert.match(appSource, /path="data-center\/dashboard"[\s\S]{0,160}canViewReports \? <DataCenterDashboardPage \/> : <Navigate to="\/home" replace \/>/);
});
