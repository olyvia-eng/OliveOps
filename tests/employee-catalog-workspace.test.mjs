import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalogSource = readFileSync('src/pages/data-center/EquipmentCatalogPage.tsx', 'utf8');
const employeeSource = readFileSync('src/pages/data-center/EmployeeCatalogSection.tsx', 'utf8');
const labourCatalogSource = readFileSync('src/pages/data-center/LabourCatalogSection.tsx', 'utf8');
const employeeTypeSource = readFileSync('src/types/index.ts', 'utf8');
const repositorySource = readFileSync('api/_lib/authRepo.js', 'utf8');

test('Catalog presents Labour Classes as the primary labour resource alongside existing sections', () => {
  for (const tab of ["key: 'labour'", "key: 'equipment'", "key: 'materials'", "key: 'subcontractors'"]) assert.match(catalogSource, new RegExp(tab));
  assert.match(catalogSource, /<LabourCatalogSection \/>/);
  assert.doesNotMatch(catalogSource, /<EmployeeCatalogSection \/>/);
  assert.match(catalogSource, /<MaterialsCatalogSection \/>/);
  assert.match(catalogSource, /<EquipmentDetailPanel/);
  assert.match(catalogSource, /Subcontractor Catalog is coming next/);
});

test('Labour Catalog empty setup is actionable and assignments remain explicit', () => {
  assert.match(labourCatalogSource, /title="No Labour Classes yet"/);
  assert.match(labourCatalogSource, /Add Labour Class/);
  assert.match(labourCatalogSource, /Employees needing a Labour Class/);
  assert.match(labourCatalogSource, /Assign existing Employees explicitly/);
  assert.match(labourCatalogSource, /aria-label=\{`Assign Labour Class to \$\{employee\.name\}`\}/);
  assert.match(labourCatalogSource, /if \(event\.target\.value\) updateEmployee/);
});

test('Labour Class role suggestions are display-only and never silently persisted', () => {
  assert.match(labourCatalogSource, /Role-based suggestions are never saved automatically/);
  assert.match(labourCatalogSource, /Suggested: \$\{suggestion\.name\}/);
  assert.doesNotMatch(labourCatalogSource, /updateEmployee\([^)]*suggestion\.id/);
  assert.match(labourCatalogSource, /!employee\.labourClassId \|\| !activeLabourClassIds\.has\(employee\.labourClassId\)/);
});

test('Labour Catalog offers a dismissible three-step setup with one final persistence boundary', () => {
  assert.match(labourCatalogSource, /Set up Labour Classes for estimating/);
  assert.match(labourCatalogSource, /Nothing changes until you confirm/);
  assert.match(labourCatalogSource, /Not now/);
  assert.match(labourCatalogSource, /Step \$\{setupStep\} of 3/);
  assert.match(labourCatalogSource, /Review suggested classes/);
  assert.match(labourCatalogSource, /Review and confirm/);
  assert.match(labourCatalogSource, /Confirm Setup/);
  assert.match(labourCatalogSource, /applyLabourClassSetup/);
  assert.match(labourCatalogSource, /View Labour Catalog/);
  assert.match(labourCatalogSource, /View Pricing/);
});

test('setup review supports class and Employee changes without changing permissions', () => {
  assert.match(labourCatalogSource, /Add Class/);
  assert.match(labourCatalogSource, /Remove \$\{group\.name\}/);
  assert.match(labourCatalogSource, /Labour Class for \$\{employee\.name\}/);
  assert.match(labourCatalogSource, /<option value="">Unassigned<\/option>/);
  assert.match(labourCatalogSource, /does not change an Employee's OliveOps permissions/);
  assert.match(labourCatalogSource, /Avg Labour Cost/);
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
