import type { EstimateWorkArea } from '../types';

export function createDefaultEstimateWorkAreaModel(generateId: () => string): EstimateWorkArea;
export function ensureDefaultEstimateWorkAreaModel<T extends { workAreas?: unknown[]; lineItems?: unknown[] }>(record: T, generateId: () => string): T & { workAreas: EstimateWorkArea[] };
export function legacyEstimateWorkAreaIdModel(estimateId: string | undefined, identity: string, generateId: () => string): string;
