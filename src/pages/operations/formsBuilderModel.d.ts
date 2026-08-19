import type { FormField, FormRecord, FormTrigger } from '../../types';

export type FormBuilderDraft = {
  form: FormRecord;
  fields: FormField[];
};

export function createFormBuilderDraft(form: FormRecord, fields: FormField[]): FormBuilderDraft;
export function isFormBuilderDirty(baseline: FormBuilderDraft | null, draft: FormBuilderDraft | null): boolean;
export function hasMultipleFormRequirements(triggers: string[]): boolean;
export function getWorkflowTriggers(triggers: FormTrigger[]): FormTrigger[];
export function getScheduleTriggers(triggers: FormTrigger[]): FormTrigger[];
export function setFormSchedule(triggers: FormTrigger[], schedule: FormTrigger | ''): FormTrigger[];
export function setFormOnDemand(triggers: FormTrigger[], enabled: boolean): FormTrigger[];
export function setFormWorkflowTrigger(triggers: FormTrigger[], index: number, nextTrigger: FormTrigger | ''): FormTrigger[];
export function getFormConfigurationWarnings(form: FormRecord): string[];
export function describeFormConfiguration(form: FormRecord, labels?: { assignmentLabel?: string }): string;
export function moveFormField(fields: FormField[], fieldId: string, targetFieldId: string): FormField[];