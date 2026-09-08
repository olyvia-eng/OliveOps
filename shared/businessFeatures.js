export const BUSINESS_FEATURE_KEYS = ['projects', 'recurringServices', 'snowOperations'];

export const DEFAULT_BUSINESS_FEATURES = Object.freeze({
  projects: true,
  recurringServices: true,
  snowOperations: false,
});

export const BUSINESS_FEATURE_CATALOG = Object.freeze([
  {
    key: 'projects',
    name: 'Projects',
    description: 'Plan and manage project estimates and jobs.',
  },
  {
    key: 'recurringServices',
    name: 'Recurring Services',
    description: 'Schedule and manage recurring service work and visits.',
  },
  {
    key: 'snowOperations',
    name: 'Snow Operations',
    description: 'Manage snow events, routes, crews, equipment and site service.',
  },
]);

export function normalizeBusinessFeatures(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(BUSINESS_FEATURE_KEYS.map((key) => [
    key,
    typeof source[key] === 'boolean' ? source[key] : DEFAULT_BUSINESS_FEATURES[key],
  ]));
}

export function isBusinessFeatureEnabled(features, key) {
  return normalizeBusinessFeatures(features)[key] === true;
}