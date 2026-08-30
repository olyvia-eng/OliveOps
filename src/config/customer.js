export const CUSTOMER_STATUSES = [
  { value: 'lead', label: 'Lead' },
  { value: 'client', label: 'Client' },
];

export const CUSTOMER_LEAD_SOURCES = [
  { value: 'referral', label: 'Referral' },
  { value: 'google_search', label: 'Google / Search' },
  { value: 'website', label: 'Website' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'existing_customer', label: 'Existing Customer' },
  { value: 'sign_truck', label: 'Sign / Truck' },
  { value: 'trade_show_event', label: 'Trade Show / Event' },
  { value: 'other', label: 'Other' },
];

export const normalizePersistedCustomerStatus = (status) => {
  if (status === 'lead' || status === 'prospect') return 'lead';
  if (status === 'client' || status === 'active') return 'client';
  return 'inactive';
};

export const isCanonicalCustomerStatus = (status) => CUSTOMER_STATUSES.some((option) => option.value === status);

export const isCustomerLeadSource = (source) => CUSTOMER_LEAD_SOURCES.some((option) => option.value === source);

export const customerStatusLabel = (status) => status === 'inactive'
  ? 'Status needs review'
  : CUSTOMER_STATUSES.find((option) => option.value === status)?.label ?? 'Status needs review';

export const customerLeadSourceLabel = (source, other = '') => {
  if (!source) return '';
  if (source === 'other' && other.trim()) return other.trim();
  return CUSTOMER_LEAD_SOURCES.find((option) => option.value === source)?.label ?? '';
};

export const normalizeCustomerAcquisition = (customer) => {
  const leadSourceOther = typeof customer.leadSourceOther === 'string' ? customer.leadSourceOther.trim() : '';
  return {
    ...customer,
    leadSource: customer.leadSource || undefined,
    leadSourceOther: customer.leadSource === 'other' && leadSourceOther ? leadSourceOther : undefined,
  };
};