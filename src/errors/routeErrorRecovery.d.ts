export type ClientErrorSource = 'react-boundary' | 'unhandled-rejection' | 'vite-preload-error';

export interface ClientErrorDiagnostic {
  source: ClientErrorSource;
  route: string;
  errorName: string;
  errorMessage: string;
  chunkLoadFailure: boolean;
  appVersion: string;
  occurredAt: string;
}

export function isChunkLoadError(error: unknown): boolean;
export function getAppVersion(): string;
export function getSessionStorage(): Storage | null;
export function buildClientErrorDiagnostic(input: {
  error: unknown;
  route: string;
  source: ClientErrorSource;
}): ClientErrorDiagnostic;
export function claimChunkRecovery(input: {
  storage: Storage | null;
  route: string;
  appVersion?: string;
  now?: number;
}): boolean;
export function reportClientError(diagnostic: ClientErrorDiagnostic, error: unknown): void;
export function handleClientError(input: {
  error: unknown;
  route: string;
  source: ClientErrorSource;
  storage: Storage | null;
  reload: () => void;
  report?: (diagnostic: ClientErrorDiagnostic, error: unknown) => void;
  forceChunkLoadFailure?: boolean;
}): { diagnostic: ClientErrorDiagnostic; recoveryStarted: boolean };