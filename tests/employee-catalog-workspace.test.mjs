import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const employeeSource = readFileSync('src/pages/data-center/EmployeeCatalogSection.tsx', 'utf8');
const employeeTypeSource = readFileSync('src/types/index.ts', 'utf8');
const repositorySource = readFileSync('api/_lib/authRepo.js', 'utf8');

test('Catalog presents the unified resource library without replacing existing sections', () => {
  for (const tab of ["key: 'employees'", "key: 'equipment'", "key: 'materials'", "key: 'subcontractors'"]) assert.match(catalogSource, new RegExp(tab));
  assert.match(catalogSource, /<EmployeeCatalogSection \/>/);
  assert.match(catalogSource, /<MaterialsCatalogSection \/>/);
  assert.match(catalogSource, /<EquipmentDetailPanel/);
  assert.match(catalogSource, /Subcontractor Catalog is coming next/);
});

test('Employee Catalog consumes canonical employees and supports decision-focused filters', () => {
  assert.match(employeeSource, /state\.employees/);
  assert.doesNotMatch(employeeSource, /addEmployee|createEmployee|employeeCatalogItems/);
  assert.match(employeeSource, /placeholder="Search employees\.\.\."/);
  assert.match(employeeSource, /aria-label="Filter employees by status"/);
  assert.match(employeeSource, /aria-label="Filter employees by division"/);
  for (const heading of ['Employee', 'Role', 'Base Wage', 'Burden', 'Labour Cost', 'Divisions', 'Status']) assert.match(employeeSource, new RegExp(`>${heading}<`));
});

test('Employee Division availability supports multiple Crew-derived Divisions without owning Budget allocation', () => {
  assert.match(employeeSource, /crew\.leadEmployeeId/);
  assert.match(employeeSource, /\.\.\.crew\.memberIds/);
  assert.match(employeeSource, /employeeDivisionIds\.add\(crew\.defaultDivisionId/);
  assert.doesNotMatch(employeeSource, /divisionAllocations|allocationPercent/);
});

test('Employee detail edits canonical cost inputs and links to the canonical Employee Profile', () => {
  assert.match(employeeSource, /calculateEmployeeLabourCost/);
  assert.match(employeeSource, /method: 'PATCH'/);
  assert.match(employeeSource, /Compensation type/);
  assert.match(employeeSource, /Payroll burden \(%\)/);
  assert.match(employeeSource, /Annual benefits \/ extra/);
  assert.match(employeeSource, /Annual bonus/);
  assert.match(employeeSource, />Cancel</);
  assert.match(employeeSource, /'Saving\.\.\.' : 'Save'/);
  assert.match(employeeSource, /Employer cost \/ paid hour/);
  assert.match(employeeSource, /Labour cost \/ paid hour/);
  assert.match(employeeSource, /View Employee Profile/);
  assert.match(employeeSource, /to=\{`\/employees\/\$\{employee\.id\}`\}/);
  for (const excluded of ['Time Off', 'Training', 'Documents', 'Emergency Contact', 'Sell Rate', 'Approved Rate']) assert.doesNotMatch(employeeSource, new RegExp(excluded, 'i'));
});

test('canonical Employee records persist reusable cost inputs as optional legacy-compatible fields', () => {
  for (const field of ['payrollBurdenPct', 'benefitsExtraCost', 'bonus']) {
    assert.match(employeeTypeSource, new RegExp(`${field}\\?: number`));
    assert.match(repositorySource, new RegExp(`${field}: employee\\.${field}`));
    assert.match(repositorySource, new RegExp(`${field}: item\\.${field}`));
  }
});
