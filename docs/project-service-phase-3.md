# Project / Service Phase 3

## Scope

Phase 3 makes Service work operational through first-class Service Visits. A Service Job owns mutable Service definitions and each scheduled occurrence is stored as an independent Visit. Project Job scheduling remains unchanged.

Included:

- Recurring, one-time, and as-needed Service scheduling
- Weekly schedules with multiple weekdays and configurable intervals
- Daily and monthly recurrence, including month-end clamping
- Manual Visit creation
- Visit rescheduling, assignment, status, and billing-readiness foundations
- This-and-future series synchronization
- Company Schedule integration
- Service Job Overview, Services, Visits, Schedule, Project Management, and Analysis views
- Tenant ownership, audit events, idempotent creation, and revision-based concurrency

Excluded:

- Project scheduling redesign
- Representing Visits as Jobs
- Mobile execution workflows
- Invoice creation
- Fabricated actual labour, equipment, material, cost, or margin values

## Domain model

Accepted Estimate Services remain immutable in `job.originalEstimateSnapshot.services`. Conversion creates separate mutable `job.services` records with:

- `sourceEstimateServiceId`
- operational status
- immutable `pricingSnapshot`
- mutable `operationalSchedule`
- schedule revision

`estimatedVisits` remains a financial estimate. It never limits recurrence generation.

A Visit records the Job and Service, scheduled local date/time, assignments, operational status, billing status, source, recurrence identity, revision, and audit timestamps. Generated Visit identity uses the original recurrence date. Moving a Visit preserves that identity and marks the Visit as a series exception.

## Recurrence rules

- Recurrence arithmetic uses calendar dates and local wall-clock strings, not repeated UTC-hour addition.
- Weekly recurrence supports multiple weekdays and every-N-week intervals.
- Daily recurrence supports every-N-day intervals.
- Monthly recurrence clamps invalid dates to the final day of that month.
- One-time Services generate one Visit.
- As-needed Services generate no automatic Visits.
- Synchronization preserves manual Visits, moved exceptions, completed/skipped/cancelled Visits, and historical Visits.
- Obsolete future scheduled occurrences are cancelled rather than deleted.

The business timezone is authoritative when determining the current business date for this-and-future changes.

## Persistence

Visits use the existing tenant partition and chronological GSI.

```text
PK = BUSINESS#{businessId}
SK = SERVICE_VISIT#{jobId}#{visitId}

timeEntryIndexPk = BUSINESS#{businessId}#SERVICE_VISITS
timeEntryIndexSk = {scheduledDate}#{scheduledStartAt|ALL_DAY}#{jobId}#{visitId}
```

Access paths:

- Visit detail: base-table key lookup
- Job or Service history: base-table `begins_with` query, with Service filtering after the bounded Job query
- Company Schedule: chronological GSI query bounded by visible start and end dates

Queries paginate until DynamoDB returns no `LastEvaluatedKey`. No table scans or browser-side all-history loads are used.

Generated writes use deterministic IDs and conditional puts. A replay treats an existing deterministic Visit as success. Visit updates use a `revision` compare-and-swap. Operational Service schedule updates conditionally replace only the matching Service array element using its schedule revision.

## Conversion

Estimate conversion remains an atomic transaction for the Job, Estimate state, and conversion audit record. DynamoDB transactions cannot contain a full season of Visits, so initial Visit generation runs after the conversion commits.

Generation is deterministic and rerunnable. If it fails, the API returns the successfully converted Job with a recoverable generation status. The Service Job workspace can fill missing Visits without duplicating existing occurrences.

## API

`/api/service-visits` supports:

- `GET ?jobId=`: list Visits for one owned Service Job
- `GET ?action=schedule&startDate=&endDate=`: bounded company Schedule query
- `POST action=generate`: fill missing deterministic occurrences
- `POST action=sync`: synchronize this-and-future occurrences
- `POST action=manual`: create an as-needed/manual Visit
- `PATCH action=service`: update operational Service status/defaults with revision protection
- `PATCH action=reschedule`: reschedule or reassign one Visit with revision protection
- `PATCH action=status`: apply a valid Visit status transition

Mutations verify that the Job is an owned Service Job and the Service belongs to it. Crew, employee, and equipment assignments are resolved within the same tenant. New inactive employee assignments are rejected. Mutations emit audit events.

## Status and billing foundations

Visit lifecycle:

```text
scheduled -> in_progress | completed | skipped | cancelled
in_progress -> completed | cancelled
```

Completed, skipped, and cancelled outcomes are historical and cannot be rewritten by recurrence synchronization.

Billing state is derived without creating invoices:

- Contract: `included`
- Per visit: `pending`, then `ready` on completion
- Time and material: `pending_usage`
- Skipped/cancelled: `not_billable`

The Analysis view reports only accepted pricing, Visit completion, and billing readiness. Actual cost and margin remain unavailable until real usage is captured.

## Schedule integration

The company Schedule uses explicit `project_job` and `service_visit` event types. Project Jobs continue through the existing Job schedule model and editor. Service Jobs are excluded from that Project event pipeline; their Visits are fetched for the visible date range and rendered alongside Project Jobs and Time Off.

Visit events:

- appear in month, day, and crew-lane week views
- respect existing Job, crew, employee, equipment, division, and status filters
- can be dragged by authorized users using revision-protected Visit rescheduling
- open the owning Service Job Visits workspace

## Recovery and operations

- Retry `generate` after a recoverable conversion-generation failure.
- A `409` on Visit or Service schedule updates means another writer changed the record; reload before retrying.
- Series synchronization can be rerun safely.
- Project Job Schedule endpoints and stored Project scheduling fields are unchanged.
