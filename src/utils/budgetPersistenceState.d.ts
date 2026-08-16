interface TimestampedRecord {
  id: string;
  updatedAt: string;
}

export function mergeBudgetSnapshotsModel<T extends TimestampedRecord>(
  current: T[],
  incoming: T[],
  idsAtRequestStart: ReadonlySet<string>,
): T[];

export function shouldApplyBudgetResponseModel(responseSequence: number, latestSequence: number): boolean;