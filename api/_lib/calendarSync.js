import { syncJobToGoogleCalendars } from './googleCalendarSync.js';
import { syncJobToMicrosoftCalendars } from './microsoftCalendarSync.js';

const defaultProviders = [
  { id: 'google', syncJob: syncJobToGoogleCalendars },
  { id: 'microsoft', syncJob: syncJobToMicrosoftCalendars },
];

export async function syncJobToExternalCalendars({ businessId, job, action = 'upsert', providers = defaultProviders }) {
  const results = await Promise.all(providers.map(async (provider) => {
    try {
      return {
        provider: provider.id,
        ok: true,
        results: await provider.syncJob({ businessId, job, action }),
      };
    } catch {
      return { provider: provider.id, ok: false, results: [] };
    }
  }));
  return results;
}