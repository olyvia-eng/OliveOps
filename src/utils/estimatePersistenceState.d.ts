import type { Estimate } from '../types';

export function mergeEstimateSnapshotsModel(
  current: Estimate[],
  incoming: Estimate[],
  requestStartedAt: number,
): Estimate[];

export function shouldApplySequencedResponseModel(
  responseSequence: number,
  latestSequence: number,
): boolean;

export function nextEstimateUpdatedAtModel(
  previousUpdatedAt: string | undefined,
  now?: number,
): string;