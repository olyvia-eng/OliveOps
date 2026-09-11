# Project Job mobile clocking contract

`GET /api/bootstrap` is the authorized local-search source for mobile Project Job clocking. A separate search endpoint is intentionally unnecessary while this collection remains the bounded set of active Jobs the authenticated session may clock into.

The server derives access from the authenticated session. Owner, admin, and Foreman roles retain operational access. Crew members require a canonical Foreman or Crew employee assignment, a legacy `assignedEmployeeIds` assignment when canonical fields are absent, or membership in the active legacy `crewId`. Client-supplied employee or business identity never expands access.

Completed and cancelled Jobs are excluded. Other authorized active Jobs remain available as fallback choices even when they are not scheduled today.

Each returned Job includes its existing Job data plus `customerName`, `propertyAddress`, `assignedForemanId`, `assignedCrewEmployeeIds`, canonical `assignedEmployeeIds`, and `scheduledToday`. The server calculates `scheduledToday` from `startDate`, `endDate`, and `includeWeekends` using the business-local date. Mobile must not derive this value from UTC or the device timezone.

Mobile can prioritize `scheduledToday: true` and locally search the authorized fallback collection by `title`, `jobNumber`, `customerName`, or `propertyAddress`.