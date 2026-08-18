import type { FormField, FormRecord } from '../../types';

export type FormBuilderDraft = {
  form: FormRecord;
  fields: FormField[];
};

export function createFormBuilderDraft(form: FormRecord, fields: FormField[]): FormBuilderDraft;
export function isFormBuilderDirty(baseline: FormBuilderDraft | null, draft: FormBuilderDraft | null): boolean;
export function moveFormField(fields: FormField[], fieldId: string, targetFieldId: string): FormField[];