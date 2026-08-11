import test from 'node:test';
import assert from 'node:assert/strict';
import { listExternalCalendarEvents } from '../api/_lib/externalCalendarEvents.js';

test('calendar aggregation returns healthy provider events when the other provider fails', async () => {
  const result = await listExternalCalendarEvents({
    businessId: 'business-1',
    userId: 'admin-1',
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
    dependencies: {
      getGoogleConnection: async () => ({ selectedCalendarId: 'primary', preferences: { showGoogleEvents: true } }),
      getMicrosoftConnection: async () => ({ selectedCalendarId: 'outlook', preferences: { showOutlookEvents: true } }),
      getValidGoogleAccessToken: async () => 'google-token',
      getValidMicrosoftAccessToken: async () => { throw Object.assign(new Error('revoked'), { code: 'InvalidAuthenticationToken' }); },
      listGoogleEvents: async () => [{
        googleEventId: 'google-1', googleCalendarId: 'primary', title: 'Meeting', start: '2026-08-11T14:00:00Z', end: '2026-08-11T15:00:00Z', allDay: false, location: '', status: 'confirmed', htmlLink: '', oliveOpsJobId: null,
      }],
      replaceGoogleEventProjectionsForRange: async () => {},
      replaceMicrosoftEventProjectionsForRange: async () => {},
    },
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].provider, 'google');
  assert.deepEqual(result.providerErrors, [{ provider: 'microsoft', code: 'InvalidAuthenticationToken' }]);
});