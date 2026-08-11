import { randomUUID } from 'node:crypto';
import { getApplicationOrigin, isExternalCalendarSyncEligibleJob } from './externalCalendarModel.js';
import {
  deleteMicrosoftJobMapping,
  listMicrosoftConnectionsForBusiness,
  listMicrosoftJobMappings,
  putMicrosoftJobMapping,
  putMicrosoftSyncOperation,
  updateMicrosoftSyncOperation,
} from './microsoftCalendarRepo.js';
import {
  buildMicrosoftTransactionId,
  deleteMicrosoftEvent,
  getValidMicrosoftAccessToken,
  mapJobToMicrosoftEvent,
  upsertMicrosoftEvent,
} from './microsoftCalendarService.js';
import { getCustomerForBusiness, getEmployeeForBusiness, listJobsForBusiness } from './authRepo.js';

const safeErrorCode = (error) => {
  if (typeof error?.code === 'string') return error.code.slice(0, 80);
  if (Number.isInteger(error?.status)) return `HTTP_${error.status}`;
  return 'SYNC_FAILED';
};

const defaultDependencies = {
  deleteMicrosoftEvent,
  deleteMicrosoftJobMapping,
  getApplicationOrigin,
  getCustomerForBusiness,
  getEmployeeForBusiness,
  getValidMicrosoftAccessToken,
  listJobsForBusiness,
  listMicrosoftConnectionsForBusiness,
  listMicrosoftJobMappings,
  putMicrosoftJobMapping,
  putMicrosoftSyncOperation,
  randomUUID,
  updateMicrosoftSyncOperation,
  upsertMicrosoftEvent,
};

async function resolveJobContext(businessId, job, deps) {
  const [customer, employees] = await Promise.all([
    job.customerId ? deps.getCustomerForBusiness(businessId, job.customerId) : null,
    Promise.all((job.assignedEmployeeIds ?? []).map((employeeId) => deps.getEmployeeForBusiness(businessId, employeeId))),
  ]);
  return { customer, employees: employees.filter(Boolean) };
}

async function runOperation({ businessId, userId, job, action, connection, context, mapping, deps }) {
  const calendarId = mapping?.microsoftCalendarId ?? connection.selectedCalendarId;
  const transactionId = mapping?.transactionId ?? buildMicrosoftTransactionId({ businessId, userId, calendarId, jobId: job.id });
  const operationId = deps.randomUUID();
  await deps.putMicrosoftSyncOperation({
    businessId,
    operation: {
      id: operationId,
      userId,
      jobId: job.id,
      microsoftCalendarId: calendarId,
      microsoftEventId: mapping?.microsoftEventId ?? null,
      transactionId,
      action,
    },
  });

  try {
    const accessToken = await deps.getValidMicrosoftAccessToken({ businessId, userId, connection });
    if (action === 'delete') {
      await deps.deleteMicrosoftEvent({ accessToken, calendarId, microsoftEventId: mapping?.microsoftEventId });
      if (mapping) await deps.deleteMicrosoftJobMapping({ businessId, userId, jobId: job.id, calendarId });
    } else {
      const event = mapJobToMicrosoftEvent({
        businessId,
        userId,
        calendarId,
        job,
        customer: context.customer,
        employees: context.employees,
        appOrigin: deps.getApplicationOrigin(),
      });
      const saved = await deps.upsertMicrosoftEvent({
        accessToken,
        calendarId,
        microsoftEventId: mapping?.microsoftEventId,
        event,
      });
      if (typeof saved?.id !== 'string' || !saved.id) throw new Error('Microsoft Graph did not return an event ID');
      await deps.putMicrosoftJobMapping({
        businessId,
        userId,
        jobId: job.id,
        calendarId,
        microsoftEventId: saved.id,
        transactionId,
      });
    }
    await deps.updateMicrosoftSyncOperation({ businessId, operationId, status: 'completed' });
    return { ok: true };
  } catch (error) {
    await deps.updateMicrosoftSyncOperation({ businessId, operationId, status: 'failed', errorCode: safeErrorCode(error) }).catch(() => {});
    return { ok: false };
  }
}

export async function syncJobToMicrosoftCalendars({ businessId, job, action = 'upsert', targetUserId, dependencies = {} }) {
  const deps = { ...defaultDependencies, ...dependencies };
  try {
    const [connections, mappings] = await Promise.all([
      deps.listMicrosoftConnectionsForBusiness(businessId),
      deps.listMicrosoftJobMappings({ businessId, jobId: job.id }),
    ]);
    const targetedConnections = connections.filter((connection) => !targetUserId || connection.userId === targetUserId);
    const shouldDelete = action === 'delete' || !isExternalCalendarSyncEligibleJob(job);
    if (shouldDelete) {
      const connectionByUser = new Map(targetedConnections.map((connection) => [connection.userId, connection]));
      const targets = mappings.map((mapping) => ({ mapping, connection: connectionByUser.get(mapping.userId) })).filter((target) => target.connection);
      return Promise.all(targets.map(({ mapping, connection }) => runOperation({
        businessId,
        userId: mapping.userId,
        job,
        action: 'delete',
        connection,
        context: { customer: null, employees: [] },
        mapping,
        deps,
      })));
    }

    const enabledConnections = targetedConnections.filter((connection) => connection.preferences?.syncOliveOpsJobs === true && connection.selectedCalendarId);
    const context = await resolveJobContext(businessId, job, deps);
    return Promise.all(enabledConnections.map((connection) => {
      const mapping = mappings.find((item) => item.userId === connection.userId && item.microsoftCalendarId === connection.selectedCalendarId);
      return runOperation({ businessId, userId: connection.userId, job, action: 'upsert', connection, context, mapping, deps });
    }));
  } catch {
    return [];
  }
}

export async function reconcileMicrosoftJobsForUser({ businessId, userId, action = 'upsert', dependencies = {} }) {
  const deps = { ...defaultDependencies, ...dependencies };
  try {
    const jobs = await deps.listJobsForBusiness(businessId);
    return Promise.all(jobs.map((job) => syncJobToMicrosoftCalendars({ businessId, job, action, targetUserId: userId, dependencies: deps })));
  } catch {
    return [];
  }
}