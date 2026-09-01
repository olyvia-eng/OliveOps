export function classifyClockingResponse({ action, status, payload }) {
  const actionLabel = action === 'clock-out' ? 'Clock-out' : 'Clock-in';

  if (status === 202 && payload?.ok === true && payload?.blocked === true && payload?.workflowOccurrenceId) {
    return { kind: 'pending', workflow: payload };
  }

  if (status >= 200 && status < 300 && payload?.ok === true && payload?.timeEntry) {
    return { kind: 'completed', timeEntry: payload.timeEntry };
  }

  const message = typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : `${actionLabel} failed (HTTP ${status}).`;
  return { kind: 'failed', message };
}