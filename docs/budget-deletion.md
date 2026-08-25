# Budget deletion

Budget deletion is business-scoped and restricted to owners and admins through the existing `/api/data?entity=budgets&id=...` route.

## Dependency classification

Estimates are hard dependencies. Estimate work areas and line items are stored inside the Estimate, but the Estimate workspace and work-area builder still use the live Budget, Division, pricing catalog, and Budget rates. A Budget referenced by any Estimate therefore returns `409 BUDGET_IN_USE` with an Estimate count.

Jobs are independent historical records. Converted Jobs retain their work areas, operational data, and original Estimate/pricing snapshots. Job screens do not require the live Budget entity, so `pricingBudgetId` remains as historical provenance and does not block deletion. Jobs and their snapshots are never cascaded.

The following records are owned by a Budget and are removed when deletion is allowed:

- Divisions
- Division planning records and identity records for labour, equipment, materials, subcontractors, and overhead
- Budget rates and pricing configuration
- Legacy Budget items
- Legacy labour plans
- Labour-hours and revenue goals
- Equipment Budget allocations
- Budget Group membership

Estimate work areas and pricing snapshots are not separate Budget-owned DynamoDB records. They remain with the blocking Estimate. Job snapshots remain with the independent Job.

Budget status does not represent a singleton active-Budget lifecycle. OliveOps does not automatically promote or select another Budget, so an unused Budget may be deleted regardless of whether its status is draft, active, or archived.

## Deletion safety

Owned records are discovered with Business partition queries and canonical sort-key prefixes. Deletion never uses a table scan.

For an ungrouped Budget with at most 99 owned records, all children and the parent are deleted in one DynamoDB transaction. Larger or grouped Budgets use deterministic, sorted batches of at most 100 child deletes. Group membership is then repaired, dependencies are checked again, and the parent is deleted last.

If a batch fails, the API returns failure and leaves the parent Budget in place. Retrying is safe because child deletes are idempotent and the remaining records are queried again. Success is returned only after the parent has been removed.