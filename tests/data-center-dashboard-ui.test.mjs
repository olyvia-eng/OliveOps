import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync('src/pages/department-dashboards/DataCenterDashboardPage.tsx', 'utf8');
const sidebarSource = readFileSync('src/navigation/sidebarConfig.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

test('Business Reports opens the existing Data Center dashboard with the requested tabs', () => {
  assert.match(sidebarSource, /to: '\/data-center\/dashboard', label: 'Reports'/);
  assert.match(pageSource, /\['overview', 'sales', 'jobs', 'labour', 'equipment', 'financial', 'customers'\]/);
  assert.match(pageSource, /role="tablist"/);
  assert.match(pageSource, /role="tab"/);
});

test('date and division are global URL-backed filters', () => {
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
});

test('dashboard financial reporting is restricted to owner and admin roles', () => {
  assert.match(sidebarSource, /business-reports[^\n]+roles: ownerAdminRoles/);
  assert.match(appSource, /path="data-center\/dashboard"[\s\S]{0,160}canViewReports \? <DataCenterDashboardPage \/> : <Navigate to="\/home" replace \/>/);
});
