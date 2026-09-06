import type { SopContent, SopDefinition, SopVersion } from '../../types/sop';

type SopAction = 'list' | 'detail' | 'create' | 'update-draft' | 'publish' | 'duplicate' | 'archive' | 'reactivate' | 'delete';
type SopRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  query?: Record<string, string>;
  body?: unknown;
};

async function sopRequest<T>(action: SopAction, options: SopRequestOptions = {}): Promise<T> {
  const query = new URLSearchParams({ action, ...options.query });
  const response = await fetch(`/api/sops?${query}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'SOP request could not be completed.');
  return payload;
}

export type SopListPayload = { ok: true; definitions: SopDefinition[] };
export type SopDetailPayload = { ok: true; definition: SopDefinition; versions: SopVersion[] };

export const listSops = () => sopRequest<SopListPayload>('list');
export const getSop = (sopId: string) => sopRequest<SopDetailPayload>('detail', { query: { sopId } });
export const createSop = (sop: SopContent) => sopRequest<{ ok: true; definition: SopDefinition }>('create', {
  method: 'POST', body: { requestId: crypto.randomUUID(), sop },
});
export const updateSopDraft = (sopId: string, sop: SopContent) => sopRequest<{ ok: true; definition: SopDefinition }>('update-draft', {
  method: 'PATCH', body: { sopId, sop },
});
export const publishSop = (sopId: string, requestId: string) => sopRequest<{ ok: true; version: SopVersion }>('publish', {
  method: 'POST', body: { sopId, requestId },
});
export const duplicateSop = (sopId: string) => sopRequest<{ ok: true; definition: SopDefinition }>('duplicate', {
  method: 'POST', body: { sopId, requestId: crypto.randomUUID() },
});
export const archiveSop = (sopId: string) => sopRequest<{ ok: true; definition: SopDefinition }>('archive', {
  method: 'POST', body: { sopId },
});
export const reactivateSop = (sopId: string) => sopRequest<{ ok: true; definition: SopDefinition }>('reactivate', {
  method: 'POST', body: { sopId },
});
export const deleteSop = (sopId: string) => sopRequest<{ ok: true; deletedRecordCount: number }>('delete', {
  method: 'POST', body: { sopId },
});