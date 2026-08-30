import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_LEAD_SOURCES,
  CUSTOMER_STATUSES,
  customerLeadSourceLabel,
  customerStatusLabel,
  isCanonicalCustomerStatus,
  isCustomerLeadSource,
  normalizeCustomerAcquisition,
  normalizePersistedCustomerStatus,
} from '../src/config/customer.js';

test('customer status compatibility maps only unambiguous legacy values', () => {
  assert.deepEqual(CUSTOMER_STATUSES.map((option) => option.value), ['lead', 'client']);
  assert.equal(normalizePersistedCustomerStatus('lead'), 'lead');
  assert.equal(normalizePersistedCustomerStatus('prospect'), 'lead');
  assert.equal(normalizePersistedCustomerStatus('active'), 'client');
  assert.equal(normalizePersistedCustomerStatus('client'), 'client');
  assert.equal(normalizePersistedCustomerStatus('inactive'), 'inactive');
  assert.equal(customerStatusLabel('inactive'), 'Status needs review');
  assert.equal(isCanonicalCustomerStatus('inactive'), false);
});

test('Lead Source uses stable reporting keys and structured Other detail', () => {
  assert.deepEqual(CUSTOMER_LEAD_SOURCES.map((option) => option.value), [
    'referral', 'google_search', 'website', 'facebook', 'instagram', 'existing_customer', 'sign_truck', 'trade_show_event', 'other',
  ]);
  assert.equal(isCustomerLeadSource('google_search'), true);
  assert.equal(isCustomerLeadSource('newspaper'), false);
  assert.equal(customerLeadSourceLabel('google_search'), 'Google / Search');
  assert.equal(customerLeadSourceLabel('other', '  Home Show  '), 'Home Show');
});

test('acquisition normalization trims Other and clears stale custom text for structured sources', () => {
  assert.deepEqual(normalizeCustomerAcquisition({ leadSource: 'other', leadSourceOther: '  Home Show  ' }), { leadSource: 'other', leadSourceOther: 'Home Show' });
  assert.deepEqual(normalizeCustomerAcquisition({ leadSource: 'referral', leadSourceOther: 'Old hidden value' }), { leadSource: 'referral', leadSourceOther: undefined });
  assert.deepEqual(normalizeCustomerAcquisition({}), { leadSource: undefined, leadSourceOther: undefined });
});