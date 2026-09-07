# Project and Service Work: Phase 1

OliveOps distinguishes two work types:

- `project`: finite, scope-based work managed through Work Areas, estimating, planning, and Project operations.
- `service`: an ongoing, one-time, or as-needed agreement described by structured Services.

## Compatibility

`workType` is additive on Estimate and Job records. A missing or unrecognized stored value is read as `project`, so existing records require no destructive migration. API writes reject explicitly invalid values, and an existing record cannot change work type.

Both record types remain in the existing business-scoped Estimate and Job DynamoDB collections. No new table or partition scheme is introduced.

## Service Estimates

A Service Estimate stores an ordered `services` array. Each Service has a stable ID, name, optional description and Division, schedule type, billing type, service dates, optional recurrence frequency, and optional estimated visit count.

Supported schedule types are `recurring`, `one_time`, and `as_needed`. Supported billing types are `contract`, `per_visit`, and `time_and_material`. Recurring frequency supports day, week, and month intervals.

Draft Service Estimates may start with no Services. At least one valid Service is required before the Estimate can be sent or accepted. Customer, Pricing Budget, and Service Division references are validated within the current business.

## Conversion

Converting an accepted Project Estimate retains the existing operational Work Area and planning snapshot flow.

Converting an accepted Service Estimate creates a Service Job with copied Service definitions and an immutable source Estimate snapshot. It does not create operational Work Areas, recurrence instances, or Visit records.

## Navigation

The Workflow navigation separates Projects and Services beneath Estimates and Jobs:

- `/estimates/projects`
- `/estimates/services`
- `/jobs/projects`
- `/jobs/services`

Legacy `/estimates` and `/jobs` links redirect to their Project lists and preserve query parameters. Stable detail links remain `/estimates/:id` and `/jobs/:id`; the application dispatches to the correct workspace from the record's canonical work type.

## Deferred

Visit generation, recurrence expansion, dispatching, per-visit completion, Service proposal pricing, and Service profitability are intentionally outside Phase 1.