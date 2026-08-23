import type { EstimateWorkArea } from '../types';

export function createDefaultEstimateWorkAreaModel(generateId: () => string): EstimateWorkArea;
export function ensureDefaultEstimateWorkAreaModel<T extends { workAreas?: unknown[]; lineItems?: unknown[] }>(record: T, generateId: () => string): T & { workAreas: EstimateWorkArea[] };
export function legacyEstimateWorkAreaIdModel(estimateId: string | undefined, identity: string, generateId: () => string): string;
export function enforceEstimateWorkAreaDivisionModel<T>(existingEstimate: Partial<T> | null | undefined, nextEstimate: T):
	| { ok: true; estimate: T & { divisionId: string } }
	| { ok: false; error: string };
