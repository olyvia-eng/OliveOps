import type { EquipmentAsset, JobAnalysisPayload, MaterialCatalogItem, SubcontractorCatalogItem, Vendor, JobWorkArea } from '../../types';

export type JobAnalysisReferences = { vendors: Vendor[]; equipment: EquipmentAsset[]; materials: MaterialCatalogItem[]; subcontractors: SubcontractorCatalogItem[]; workAreas: JobWorkArea[] };

async function request<T>(jobId: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; scopeWorkAreaId?: string; action?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const query = new URLSearchParams({ jobId });
  if (options.scopeWorkAreaId) query.set('scopeWorkAreaId', options.scopeWorkAreaId);
  if (options.action) query.set('action', options.action);
  const response = await fetch(`/api/job-analysis?${query}`, { method: options.method ?? 'GET', credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined, body: options.body ? JSON.stringify({ jobId, ...options.body }) : undefined });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'Job Analysis request failed.');
  return payload;
}

export const loadJobAnalysis = (jobId: string, scopeWorkAreaId: string, signal?: AbortSignal) => {
  const query = new URLSearchParams({ jobId, scopeWorkAreaId });
  return fetch(`/api/job-analysis?${query}`, { credentials: 'include', signal }).then(async (response) => {
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; analysis?: JobAnalysisPayload; references?: JobAnalysisReferences };
    if (!response.ok || !payload.ok || !payload.analysis || !payload.references) throw new Error(payload.error || 'Job Analysis could not be loaded.');
    return { analysis: payload.analysis, references: payload.references };
  });
};
export const saveJobCostRecord = (jobId: string, body: Record<string, unknown> & { id?: string }) => request<{ ok: true }>(jobId, { method: body.id ? 'PATCH' : 'POST', body });
export const deleteJobCostRecord = (jobId: string, body: { id: string; recordType: string; revision: number }) => request<{ ok: true }>(jobId, { method: 'DELETE', body });
export const createJobVendor = (jobId: string, body: Record<string, unknown>) => request<{ ok: true; vendor: Vendor }>(jobId, { method: 'POST', action: 'vendor', body });