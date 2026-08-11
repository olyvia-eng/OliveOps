import { getGoogleConnection, replaceGoogleEventProjectionsForRange } from './googleCalendarRepo.js';
import { getValidGoogleAccessToken, listGoogleEvents } from './googleCalendarService.js';
import { getMicrosoftConnection, replaceMicrosoftEventProjectionsForRange } from './microsoftCalendarRepo.js';
import { getValidMicrosoftAccessToken, listMicrosoftEvents } from './microsoftCalendarService.js';

const defaultDependencies = {
  getGoogleConnection,
  getMicrosoftConnection,
  getValidGoogleAccessToken,
  getValidMicrosoftAccessToken,
  listGoogleEvents,
  listMicrosoftEvents,
  replaceGoogleEventProjectionsForRange,
  replaceMicrosoftEventProjectionsForRange,
};

const mapGoogleExternalEvent = (event) => ({
  externalEventId: event.googleEventId,
  externalCalendarId: event.googleCalendarId,
  title: event.title,
  start: event.start,
  end: event.end,
  allDay: event.allDay,
  location: event.location,
  status: event.status,
  htmlLink: event.htmlLink,
  provider: 'google',
  sourceLabel: 'Google Calendar',
});

export async function listExternalCalendarEvents({ businessId, userId, from, to, dependencies = {} }) {
  const deps = { ...defaultDependencies, ...dependencies };
  const [googleConnection, microsoftConnection] = await Promise.all([
    deps.getGoogleConnection({ businessId, userId }),
    deps.getMicrosoftConnection({ businessId, userId }),
  ]);

  const providers = [];
  if (googleConnection && googleConnection.preferences?.showGoogleEvents !== false) {
    providers.push({ provider: 'google', promise: (async () => {
      const accessToken = await deps.getValidGoogleAccessToken({ businessId, userId, connection: googleConnection });
      const calendarId = googleConnection.selectedCalendarId || 'primary';
      const fetched = await deps.listGoogleEvents({ accessToken, calendarId, timeMin: from, timeMax: to });
      const providerEvents = fetched.filter((event) => event.status !== 'cancelled' && !event.oliveOpsJobId);
      await deps.replaceGoogleEventProjectionsForRange({ businessId, userId, calendarId, rangeStart: from, rangeEnd: to, events: providerEvents });
      return { provider: 'google', events: providerEvents.map(mapGoogleExternalEvent) };
    })() });
  }
  if (microsoftConnection && microsoftConnection.preferences?.showOutlookEvents !== false) {
    providers.push({ provider: 'microsoft', promise: (async () => {
      const accessToken = await deps.getValidMicrosoftAccessToken({ businessId, userId, connection: microsoftConnection });
      const calendarId = microsoftConnection.selectedCalendarId;
      const fetched = await deps.listMicrosoftEvents({ accessToken, calendarId, timeMin: from, timeMax: to });
      const events = fetched.filter((event) => event.status !== 'cancelled' && !event.oliveOpsJobId);
      await deps.replaceMicrosoftEventProjectionsForRange({ businessId, userId, calendarId, rangeStart: from, rangeEnd: to, events });
      return { provider: 'microsoft', events };
    })() });
  }

  const settled = await Promise.allSettled(providers.map(({ promise }) => promise));
  const events = settled.flatMap((result) => result.status === 'fulfilled' ? result.value.events : []);
  const providerErrors = settled.flatMap((result, index) => result.status === 'rejected' ? [{ provider: providers[index].provider, code: String(result.reason?.code ?? 'UNAVAILABLE').slice(0, 80) }] : []);
  return { events, providerErrors };
}