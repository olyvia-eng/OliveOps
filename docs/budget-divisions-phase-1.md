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

Labour, Equipment, Materials, Subcontractors, and Division Overhead use Division planning records. The former `other-costs` tab name remains a URL compatibility alias for Overhead; persisted expense terminology remains `overhead`, so no records are renamed or migrated. Company Overhead remains on existing Budget-level overhead items and is consolidated only at the overall Budget level because no Division allocation policy has been approved.

Profit & Loss is a read-only projection from revenue targets and these planning records. `calculateDivisionFinancials` and `calculateBudgetFinancials` provide the shared calculation boundary for Division Overview, Division summaries, P&L, and Analysis. Incomplete direct-cost planning produces unavailable profit and margin values rather than implied profit. Division operating profit is explicitly reported before Company Overhead until an allocation mechanism is implemented.

## Division Planning

Labour, Equipment, Materials, and Subcontractors now use additive Division-owned planning records. Legacy Budget Items, Budget Rates, Labour Plans, and grouped Equipment Allocations are not rewritten.

```text
PK = BUSINESS#{businessId}
SK = BUDGET_DIVISION_PLAN#{budgetId}#DIVISION#{divisionId}#CATEGORY#{category}#ITEM#{itemId}
```

Each destination/category also stores an identity marker based on its reusable catalog reference, or a normalized manual name when no catalog exists. The marker prevents repeated or concurrent imports from creating duplicate plans.

Imports are explicit snapshots, not live links. Every imported row receives a new ID and destination Budget/Division ownership. Source records remain unchanged.

- Labour copies employee references and reusable compensation, hour, overtime, burden, benefit, and bonus assumptions. It never reads time entries, payroll actuals, completed Jobs, or historical variance.
- Equipment reuses the Equipment Catalog asset and copies Budget-specific classification, payment, fuel, insurance, maintenance, utilization, and allocation suggestions. It never copies group IDs, allocation IDs, source Budget IDs, historical machine usage, or Job data.
- Materials reuse the Material Catalog reference when it still exists and copy description, unit, unit cost, quantity, and amount assumptions. Missing catalog references become independent snapshots; purchases, invoices, expenses, and Job consumption are excluded.
- Subcontractors copy independent name, description, rate, quantity, and planned amount assumptions. OliveOps does not yet have a Vendor Catalog, so imports do not create or duplicate vendor/contact records. Invoices, payments, expenses, and Job actuals are excluded.

Division-aware Budgets expose real source Divisions. Older Budgets expose a synthetic read-only `Legacy Budget-wide plan` source because their detailed records have no Division IDs. This compatibility adapter performs no migration or backfill.

Only owner/admin Budget editors can create, edit, delete, reorder, or import plans. APIs resolve source and destination Budgets and Divisions from the authenticated business and revalidate catalog references and duplicates at write time.