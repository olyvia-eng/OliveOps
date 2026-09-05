import type { FormDeliveryRule, FormRecord, FormTrigger } from '../types';

export type FormDeliveryInspection = {
  status: 'normalized' | 'legacy_mappable' | 'needs_review' | 'invalid';
  needsReview: boolean;
  error: string | null;
  deliveryRule: FormDeliveryRule | null;
  legacyTriggers: FormTrigger[];
};

export function validateFormDeliveryRule(rule: FormDeliveryRule | unknown): string | null;
export function deliveryRuleToLegacyTriggers(rule: FormDeliveryRule): FormTrigger[];
export function deliveryRuleCompletionRequirement(rule: FormDeliveryRule): 'required' | 'reminder';
export function inspectFormDeliveryConfiguration(form: Partial<FormRecord>): FormDeliveryInspection;
export function normalizeFormDeliveryRecord(form: FormRecord): { ok: true; form: FormRecord } | { ok: false; error: string };