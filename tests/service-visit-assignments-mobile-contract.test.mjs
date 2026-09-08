import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = readFileSync('docs/service-visits-mobile-contract.md', 'utf8');

test('mobile Visit summaries document canonical employee and equipment assignment IDs', () => {
  assert.match(contract, /`assignedEmployeeIds`/);
  assert.match(contract, /`assignedEquipmentIds`/);
});
