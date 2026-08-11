import { randomUUID } from 'node:crypto';
import { requireEnv } from './env.js';
import {
  getGoogleConnection,
  listGoogleConnectionsForBusiness,
  listGoogleJobMappings,
  putGoogleJobMapping,
  putGoogleSyncOperation,
  updateGoogleSyncOperation,
} from './googleCalendarRepo.js';
import {
  buildDeterministicGoogleEventId,
  deleteGoogleEvent,
  getValidGoogleAccessToken,
  mapJobToGoogleEvent,
  upsertGoogleEvent,
} from './googleCalendarService.js';
import {
  getCustomerForBusiness,
  getEmployeeForBusiness,
  listJobsForBusiness,
} from './authRepo.js';

export function isGoogleSyncEligibleJob(job) {
  return Boolean(
    job
    && job.scheduleConfirmed === true
    && job.status !== 'cancelled'
    && typeof job.startDate === 'string'
    && job.startDate
  );
}

function safeErrorCode(error) {
  if (typeof error?.code === 'string') return error.code.slice(0, 80);
  if (Number.isInteger(error?.status)) return `HTTP_${error.status}`;
  return 'SYNC_FAILED';
}

function applicationOrigin() {
  return new URL(requireEnv('GOOGLE_REDIRECT_URI')).origin;
}

const defaultDependencies = {
  getGoogleConnection,
  listGoogleConnectionsForBusiness,
  listGoogleJobMappings,
  putGoogleJobMapping,
  putGoogleSyncOperation,
  updateGoogleSyncOperation,
  getValidGoogleAccessToken,
  upsertGoogleEvent,
  deleteGoogleEvent,
  getCustomerForBusiness,
  getEmployeeForBusiness,
  listJobsForBusiness,
  applicationOrigin,
  randomUUID,
};

async function resolveJobContext(businessId, job, deps) {
  const [customer, employees] = await Promise.all([
    job.customerId ? deps.getCustomerForBusiness(businessId, job.customerId) : null,
    Promise.all((job.assignedEmployeeIds ?? []).map((employeeId) => deps.getEmployeeForBusiness(businessId, employeeId))),
  ]);
  return { customer, employees: employees.filter(Boolean) };
}

async function runOperation({ businessId, userId, job, action, connection, context, mapping, deps }) {
  const calendarId = mapping?.googleCalendarId ?? connection.selectedCalendarId ?? 'primary';
  const googleEventId = mapping?.googleEventId ?? buildDeterministicGoogleEventId({
    businessId,
    userId,
    calendarId,
    jobId: job.id,
  });
  const operationId = deps.randomUUID();
  await deps.putGoogleSyncOperation({
    businessId,
    operation: {
      id: operationId,
      userId,
      jobId: job.id,
      googleCalendarId: calendarId,
      googleEventId,
      action,
    },
  });

  try {
    const accessToken = await deps.getValidGoogleAccessToken({ businessId, userId, connection });
    if (action === 'delete') {
      await deps.deleteGoogleEvent({ accessToken, calendarId, googleEventId });
    } else {
      const event = mapJobToGoogleEvent({
        businessId,
        userId,
        calendarId,
        job,
        customer: context.customer,
        employees: context.employees,
        appOrigin: deps.applicationOrigin(),
      });
      await deps.upsertGoogleEvent({ accessToken, calendarId, googleEventId, event });
      await deps.putGoogleJobMapping({ businessId, userId, jobId: job.id, calendarId, googleEventId });
    }
    await deps.updateGoogleSyncOperation({ businessId, operationId, status: 'completed' });
    return { ok: true };
  } catch (error) {
    await deps.updateGoogleSyncOperation({
      businessId,
      operationId,
      status: 'failed',
      errorCode: safeErrorCode(error),
    }).catch(() => {});
    return { ok: false };
  }
}

export async function syncJobToGoogleCalendars({ businessId, job, action = 'upsert', targetUserId, dependencies = {} }) {
  const deps = { ...defaultDependencies, ...dependencies };
  try {
    const [connections, mappings] = await Promise.all([
      deps.listGoogleConnectionsForBusiness(businessId),
      deps.listGoogleJobMappings({ businessId, jobId: job.id }),
    ]);
    const enabledConnections = connections.filter((connection) => (
      connection.preferences?.syncOliveOpsJobs === true
      && (!targetUserId || connection.userId === targetUserId)
    ));
    const shouldDelete = action === 'delete' || !isGoogleSyncEligibleJob(job);
    const context = shouldDelete ? { customer: null, employees: [] } : await resolveJobContext(businessId, job, deps);

    if (shouldDelete) {
      const enabledByUser = new Map(enabledConnections.map((connection) => [connection.userId, connection]));
      const targets = mappings
        .map((mapping) => ({ mapping, connection: enabledByUser.get(mapping.userId) }))
        .filter((target) => target.connection);
      return Promise.all(targets.map(({ mapping, connection }) => runOperation({
        businessId,
        userId: mapping.userId,
        job,
        action: 'delete',
        connection,
        context,
        mapping,
        deps,
      })));
    }

    return Promise.all(enabledConnections.map((connection) => {
      const calendarId = connection.selectedCalendarId ?? 'primary';
      const mapping = mappings.find((item) => item.userId === connection.userId && item.googleCalendarId === calendarId);
      return runOperation({
        businessId,
        userId: connection.userId,
        job,
        action: 'upsert',
        connection,
        context,
        mapping,
        deps,
      });
    }));
  } catch {
    return [];
  }
}

export async function reconcileGoogleJobsForUser({ businessId, userId, action = 'upsert', dependencies = {} }) {
  const deps = { ...defaultDependencies, ...dependencies };
  try {
    const jobs = await deps.listJobsForBusiness(businessId);
    return Promise.all(jobs.map((job) => syncJobToGoogleCalendars({
      businessId,
      job,
      action,
      targetUserId: userId,
      dependencies: deps,
    })));
  } catch {
    return [];
  }
}