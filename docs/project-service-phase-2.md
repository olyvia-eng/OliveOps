# Project and Service Phase 2

## Scope

Phase 2 makes Service Estimates commercially usable without changing Project estimating or creating Service Visits. Services remain definitions of customer commitments. Visit records, recurrence scheduling, mobile workflows, and invoicing are outside this phase.

## Pricing model

Service resources reuse the existing Estimate pricing catalog and immutable line-item snapshots. Labour, equipment, materials, and subcontractors retain their Budget, Division, source entity, direct cost, overhead recovery, target margin, and sell-rate provenance.

Each resource has a cost scope:

- `per_visit`: quantity, cost, and sell value are multiplied by estimated visits.
- `service_period`: quantity, cost, and sell value are counted once for the agreement period.

All Service calculations live in `src/utils/servicePricingModel.js`. UI, proposals, API validation, analysis, and conversion consume these helpers rather than implementing separate formulas.

Billing methods have distinct revenue semantics:

- Contract revenue is fixed and contracted. A custom contract price overrides the calculated Service value without further visit multiplication.
- Per-Visit revenue is projected as price per visit times estimated visits, plus an optional one-time charge.
- Time & Material revenue is projected from customer sell-rate snapshots and expected resource quantities.

Tax is calculated over estimated revenue. Contracted total with tax is also retained separately so payment schedules apply only to fixed commitments.

## Estimate workspace

Service Estimates use four views:

- Info: customer, Budget, dates, status, tax, and agreement notes.
- Services: schedule, billing, resource builder, cost scope, and price controls.
- Proposal: contracted/projected customer totals, proposal terms, send, and PDF actions.
- Analysis: Estimate-level or individual-Service revenue, loaded cost, profit, margin, and category costs.

The resource drawer loads the tenant-scoped pricing catalog once and filters items by the selected Service Division. It uses the same pricing editor and snapshot application path as Project Estimates.

## Proposals

Service Proposals reuse the existing immutable version, secure public link, electronic acceptance, and signed PDF system. The customer projection includes Service scope, frequency, billing method, customer rates, and contracted/projected totals. It excludes direct costs, overhead recovery, profit, margin, and internal source identities.

Payment schedules are calculated from contracted revenue plus its tax. Project Proposal behavior remains unchanged.

## Conversion

Accepted Service Estimates convert to Service Jobs with independent copies of the full Service definitions and pricing snapshots. The Job stores accepted contracted revenue, projected revenue, estimated cost, profit, margin, tax, and proposal version metadata where available.

Conversion does not create Project Work Areas, schedule occurrences, recurrence series, or Service Visit records.

## Server enforcement

The API authoritatively resolves Service resource pricing against the selected tenant Budget and allowed source entities. Cross-tenant Budget, Division, employee/labour, equipment, material, and subcontractor identities fail closed. Non-draft saves and Proposal sends reject invalid cost scopes, negative values, incomplete pricing, and missing billing prices.