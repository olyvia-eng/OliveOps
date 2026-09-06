import type { ContentMode } from '../../types/training';
import type { SopVersion } from '../../types/sop';

export type JobSop = SopVersion & { association: { addedAt?: string; addedBy?: string } };
export type AvailableJobSop = {
  sopId: string;
  title: string;
  category: string;
  shortDescription: string;
  currentVersion: number;
  contentMode?: ContentMode;
  associated: boolean;
};

async function jobSopRequest<T>(jobId: string, options: {
  method?: 'GET' | 'POST' | 'DELETE';
  action?: 'available' | 'detail';
  sopId?: string;
  body?: unknown;
} = {}): Promise<T> {
  const query = new URLSearchParams({ jobId });
  if (options.action) query.set('action', options.action);
  if (options.sopId) query.set('sopId', options.sopId);
  const response = await fetch(`/api/job-sops?${query}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'Job SOP request could not be completed.');
  return payload;
}

export const listJobSops = (jobId: string) => jobSopRequest<{ ok: true; sops: JobSop[] }>(jobId);
export const listAvailableJobSops = (jobId: string) => jobSopRequest<{ ok: true; sops: AvailableJobSop[] }>(jobId, { action: 'available' });
export const getJobSop = (jobId: string, sopId: string) => jobSopRequest<{ ok: true; sop: JobSop }>(jobId, { action: 'detail', sopId });
export const addJobSops = (jobId: string, sopIds: string[]) => jobSopRequest<{ ok: true }>(jobId, { method: 'POST', body: { sopIds } });
export const removeJobSop = (jobId: string, sopId: string) => jobSopRequest<{ ok: true }>(jobId, { method: 'DELETE', sopId });