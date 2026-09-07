import type { Job, ServiceJobService, ServiceVisit, ServiceVisitStatus } from '../../types';

async function request<T>(options: {
  method?: 'GET' | 'POST' | 'PATCH';
  action?: string;
  jobId?: string;
  visitId?: string;
  startDate?: string;
  endDate?: string;
  body?: Record<string, unknown>;
} = {}): Promise<T> {
  const query = new URLSearchParams();
  if (options.action) query.set('action', options.action);
  if (options.jobId) query.set('jobId', options.jobId);
  if (options.visitId) query.set('visitId', options.visitId);
  if (options.startDate) query.set('startDate', options.startDate);
  if (options.endDate) query.set('endDate', options.endDate);
  const response = await fetch(`/api/service-visits?${query}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'Service Visit request failed.');
  return payload;
}

export const listServiceVisits = (jobId: string) => request<{ ok: true; visits: ServiceVisit[] }>({ jobId });
export const listScheduleServiceVisits = (startDate: string, endDate: string, signal?: AbortSignal) => {
  const query = new URLSearchParams({ action: 'schedule', startDate, endDate });
  return fetch(`/api/service-visits?${query}`, { credentials: 'include', signal })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; visits?: ServiceVisit[] };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Service Visits could not be loaded.');
      return payload.visits ?? [];
    });
};
export const generateServiceVisits = (jobId: string, serviceId: string, sync = false, effectiveFrom?: string) => request<{ ok: true; createdCount: number; updatedCount?: number; cancelledCount?: number }>({ method: 'POST', action: sync ? 'sync' : 'generate', body: { jobId, serviceId, effectiveFrom } });
export const createManualServiceVisit = (jobId: string, serviceId: string, body: Record<string, unknown>) => request<{ ok: true; visit: ServiceVisit }>({ method: 'POST', action: 'manual', body: { jobId, serviceId, ...body } });
export const updateServiceVisitStatus = (visit: ServiceVisit, status: ServiceVisitStatus, reason = '') => request<{ ok: true; visit: ServiceVisit }>({ method: 'PATCH', action: 'status', jobId: visit.jobId, visitId: visit.id, body: { serviceId: visit.serviceId, visitId: visit.id, revision: visit.revision, status, reason } });
export const rescheduleServiceVisit = (visit: ServiceVisit, body: Record<string, unknown>) => request<{ ok: true; visit: ServiceVisit }>({ method: 'PATCH', action: 'reschedule', jobId: visit.jobId, visitId: visit.id, body: { serviceId: visit.serviceId, visitId: visit.id, revision: visit.revision, ...body } });
export const updateOperationalService = (jobId: string, serviceId: string, body: { status?: ServiceJobService['status']; operationalSchedule?: Partial<ServiceJobService['operationalSchedule']>; effectiveFrom?: string }) => request<{ ok: true; job: Job; service: ServiceJobService }>({ method: 'PATCH', action: 'service', jobId, body: { serviceId, ...body } });