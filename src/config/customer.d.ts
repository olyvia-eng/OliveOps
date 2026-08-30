export type CanonicalCustomerStatus = 'lead' | 'client';
export type CustomerLeadSource = 'referral' | 'google_search' | 'website' | 'facebook' | 'instagram' | 'existing_customer' | 'sign_truck' | 'trade_show_event' | 'other';

export const CUSTOMER_STATUSES: ReadonlyArray<{ value: CanonicalCustomerStatus; label: string }>;
export const CUSTOMER_LEAD_SOURCES: ReadonlyArray<{ value: CustomerLeadSource; label: string }>;
export function normalizePersistedCustomerStatus(status: unknown): CanonicalCustomerStatus | 'inactive';
export function isCanonicalCustomerStatus(status: unknown): status is CanonicalCustomerStatus;
export function isCustomerLeadSource(source: unknown): source is CustomerLeadSource;
export function customerStatusLabel(status: CanonicalCustomerStatus | 'inactive'): string;
export function customerLeadSourceLabel(source: CustomerLeadSource | undefined, other?: string): string;
export function normalizeCustomerAcquisition<T extends { leadSource?: unknown; leadSourceOther?: unknown }>(customer: T): T & { leadSource?: CustomerLeadSource; leadSourceOther?: string };