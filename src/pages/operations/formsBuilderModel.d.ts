import type { FormDeliveryRule, FormDeliveryType, FormField, FormRecord } from '../../types';

export type FormBuilderDraft = {
  form: FormRecord;
  fields: FormField[];
};

export function createDefaultDeliveryRule(type?: FormDeliveryType): FormDeliveryRule;
export function applyFormDeliveryRule(form: FormRecord, deliveryRule: FormDeliveryRule): FormRecord;
export function createFormBuilderDraft(form: FormRecord, fields: FormField[]): FormBuilderDraft;
export function isFormBuilderDirty(baseline: FormBuilderDraft | null, draft: FormBuilderDraft | null): boolean;
export function getFormConfigurationWarnings(form: FormRecord): string[];
export function getLegacyConfigurationLabels(form: FormRecord): string[];
export function describeFormConfiguration(form: FormRecord, labels?: { assignmentLabel?: string }): string;
export function getTemplateDeliveryRule(templateName: string): FormDeliveryRule;
export function moveFormField(fields: FormField[], fieldId: string, targetFieldId: string): FormField[];