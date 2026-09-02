import type { EstimateTemplate, EstimateTemplateWorkArea } from '../types';

export interface NormalizedEstimateTemplate extends Omit<EstimateTemplate, 'schemaVersion' | 'workAreas'> {
  schemaVersion: 2;
  proposalNotes: string;
  workAreas: EstimateTemplateWorkArea[];
  updatedAt: string;
  legacyTaxRate?: number;
}

export function normalizeEstimateTemplate(template: Partial<EstimateTemplate>): NormalizedEstimateTemplate;
export function templateWritePayload(template: Partial<EstimateTemplate>): EstimateTemplate;
export function createTemplateEstimateScope(template: Partial<EstimateTemplate>, generateId: () => string): Array<{
  id: string;
  sourceTemplateWorkAreaId: string;
  name: string;
  description: string;
  sortOrder: number;
  lineItems: Array<Record<string, unknown>>;
}>;
