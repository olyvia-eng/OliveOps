import { requireEnv } from './env.js';

export function isExternalCalendarSyncEligibleJob(job) {
  return Boolean(
    job
    && job.scheduleConfirmed === true
    && job.status !== 'cancelled'
    && typeof job.startDate === 'string'
    && job.startDate
  );
}

export function getApplicationOrigin() {
  return new URL(process.env.APP_ORIGIN || requireEnv('GOOGLE_REDIRECT_URI')).origin;
}