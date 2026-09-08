import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUSINESS_FEATURES,
  normalizeBusinessFeatures,
} from '../shared/businessFeatures.js';

test('existing businesses without feature settings receive Phase 1 defaults', () => {
  assert.deepEqual(normalizeBusinessFeatures(undefined), {
    projects: true,
    recurringServices: true,
    snowOperations: false,
  });
});

test('new business defaults match the normalized canonical defaults', () => {
  assert.deepEqual(normalizeBusinessFeatures(DEFAULT_BUSINESS_FEATURES), DEFAULT_BUSINESS_FEATURES);
});

test('stored feature choices are retained while missing keys use defaults', () => {
  assert.deepEqual(normalizeBusinessFeatures({ projects: false, snowOperations: true, ignored: true }), {
    projects: false,
    recurringServices: true,
    snowOperations: true,
  });
});