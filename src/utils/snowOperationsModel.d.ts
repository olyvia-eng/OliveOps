import type { SnowGpsEvidence, SnowRouteStop } from '../types';

export const SNOW_BREADCRUMB_INTERVAL_MS: number;
export const SNOW_BREADCRUMB_BATCH_LIMIT: number;
export const DEFAULT_SNOW_SERVICE_TYPES: string[];
export const SNOW_EVENT_TRANSITIONS: Record<string, string[]>;
export const SNOW_ROUTE_TRANSITIONS: Record<string, string[]>;
export const SNOW_STOP_TRANSITIONS: Record<string, string[]>;
export const SNOW_OCCURRENCE_TRANSITIONS: Record<string, string[]>;
export function canTransitionSnowState(transitions: Record<string, string[]>, current: string, next: string): boolean;
export function normalizeGpsEvidence(input?: Partial<SnowGpsEvidence> & { unavailableReason?: string }): SnowGpsEvidence;
export function normalizeBreadcrumbBatch(points?: Array<Partial<SnowGpsEvidence> & { deviceCapturedAt?: string; sequence?: number }>): Array<SnowGpsEvidence & { deviceCapturedAt: string; sequence: number }> | null;
export function snowRouteProgress(stops?: SnowRouteStop[]): { total: number; completed: number; needsAttention: number; currentStopId: string | null };
export function nextSnowStop(stops: SnowRouteStop[], currentStopId: string): SnowRouteStop | null;
export function deriveSnowStopAttention(input: { stop: SnowRouteStop; occurrences?: Array<{ id: string; status: string; serviceTypeName: string }>; evidence?: Array<{ occurrenceId?: string; eventType: string; stage?: string; gps?: SnowGpsEvidence }> }): string[];
export function snowNavigationUrl(address: string, userAgent?: string): string;
