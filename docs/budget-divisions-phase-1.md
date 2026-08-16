# Budget Divisions Phase 1

OliveOps now presents one parent Budget containing operating Divisions. This phase adds the new shell and ownership model without migrating existing detailed planning records.

## Persistence

Parent Budgets continue to use `PK = BUSINESS#{businessId}` and `SK = BUDGET_META#{budgetId}`. New Budgets carry `planningModel = divisions_v1`, description, and date-range metadata. The legacy `budgetType` and free-text `division` fields remain stored as `operating` and `company_wide` so old readers continue to work.

Budget Divisions use the same table:

```text
PK = BUSINESS#{businessId}
SK = BUDGET_DIVISION#{budgetId}#DIVISION#{divisionId}
```

The composite sort key supports efficient parent-scoped queries. Division API operations derive `businessId` from the authenticated session and require the parent `budgetId`; a Division cannot be read or changed through another Budget or company.

## Compatibility

No existing Budget, Budget Group, Budget Item, Budget Rate, Labour Budget Plan, Revenue Goal, or Equipment Allocation is rewritten by this phase.

- The existing detailed planner is available at `/budgets/:budgetId/legacy`.
- Existing grouped roll-ups remain read-only at their current routes.
- New group creation and membership management are hidden from the normal Budget workflow.
- Existing grouped Budgets are not synthesized into Divisions.
- Company Overhead and Analysis do not reinterpret old grouped calculations as Division calculations.

Opening the new workspace performs no migration. Budgets without `planningModel = divisions_v1` display an explicit Legacy Planning link.

## Deferred Migration

Labour, Equipment, Materials, Subcontractors, Other Costs, Company Overhead recovery, and consolidated financial formulas remain on their existing Budget IDs. A later controlled migration can add `divisionId` to each category-specific relationship after its mapping and rollback behavior are approved. Until then, only Division revenue targets are aggregated; unavailable direct-cost and profit metrics are displayed as unavailable rather than estimated.