import type { TrainingAssignment, TrainingCompletion, TrainingDefinition, TrainingVersion } from '../../types/training';

export async function trainingRequest<T>(action: string, options: { method?: 'GET' | 'POST' | 'PATCH'; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const query = new URLSearchParams({ action, ...options.query });
  const response = await fetch(`/api/training?${query}`, {
    method: options.method ?? 'GET', credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'Training request could not be completed.');
  return payload;
}

export type TrainingListPayload = { ok: true; definitions: TrainingDefinition[]; assignments: TrainingAssignment[] };
export type TrainingDetailPayload = { ok: true; definition: TrainingDefinition; versions: TrainingVersion[]; assignments: TrainingAssignment[]; completions: TrainingCompletion[] };

export const recurrenceLabel = (training: Pick<TrainingDefinition, 'recurrenceType' | 'recurrenceMonths'>) => training.recurrenceType === 'one_time'
  ? 'One time' : training.recurrenceType === 'annual' ? 'Annually' : `Every ${training.recurrenceMonths} months`;

export const trainingStatusLabel = (status: string) => status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
export const trainingStatusClass = (status: string) => status === 'overdue' ? 'bg-red-50 text-red-700' : status === 'due_soon' ? 'bg-amber-50 text-amber-700' : status === 'current' ? 'bg-green-50 text-green-700' : status === 'revoked' ? 'bg-gray-100 text-gray-500' : 'bg-brand-50 text-brand-700';