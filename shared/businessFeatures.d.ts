export type BusinessFeatureKey = 'projects' | 'recurringServices' | 'snowOperations';
export type BusinessFeatures = Record<BusinessFeatureKey, boolean>;

export interface BusinessFeatureDefinition {
  key: BusinessFeatureKey;
  name: string;
  description: string;
}

export const BUSINESS_FEATURE_KEYS: BusinessFeatureKey[];
export const DEFAULT_BUSINESS_FEATURES: Readonly<BusinessFeatures>;
export const BUSINESS_FEATURE_CATALOG: ReadonlyArray<BusinessFeatureDefinition>;
export function normalizeBusinessFeatures(value: unknown): BusinessFeatures;
export function isBusinessFeatureEnabled(features: unknown, key: BusinessFeatureKey): boolean;