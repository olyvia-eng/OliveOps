import type { FormCategory, FormDeliveryRule, FormFieldType } from '../src/types';

export type FormTemplateField = Readonly<{
  type: FormFieldType;
  label: string;
  helpText?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  options: readonly string[];
  acceptedResponse?: Readonly<{ value: string | boolean | number; message?: string }>;
}>;

export type FormTemplate = Readonly<{
  id: string;
  name: string;
  category: FormCategory;
  description: string;
  deliveryRule?: FormDeliveryRule;
  fields: readonly FormTemplateField[];
}>;

export const FORM_TEMPLATES: readonly FormTemplate[];
export function getFormTemplate(templateId: string): FormTemplate | null;
export function getFormTemplateDeliveryRule(templateName: string): FormDeliveryRule;