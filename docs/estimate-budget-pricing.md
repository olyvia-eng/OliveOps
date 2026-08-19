# Estimate pricing from operating Budgets

Estimate Work Areas consume approved pricing from the Estimate's selected overall Budget. They do not calculate company selling rates.

## Canonical path

For `divisions_v1` Budgets, catalog discovery starts from tenant-owned `BUDGET_DIVISION_PLAN` records across the entire Budget. Division allocations describe cost responsibility; they do not filter an Estimate that has no Division context.

The server deduplicates shared items by canonical identity:

- Labour: `employeeId`
- Equipment: `equipmentId`
- Materials: `materialCatalogItemId`
- Subcontractors: `vendorId` when available, otherwise the shared Budget planning item ID

Budget pricing approval is resolved only inside the selected Budget. A `BudgetRate` matches by `budgetItemId` or the category's canonical source ID. Legacy equipment approvals continue to match by `equipmentId`. Display names are not an identity boundary for new Budget catalogs.

`GET /api/estimate-pricing-catalog?estimateId=<id>` derives the business and `pricingBudgetId` from the authenticated Estimate and returns one normalized catalog:

```json
{
  "budgetId": "budget-2027",
  "labour": [],
  "equipment": [],
  "materials": [],
  "subcontractors": []
}
```

Each item includes `budgetItemId`, `sourceEntityId`, `sourceRateId`, unit, cost rate, recommended rate, approved rate, and `pricingStatus`. The endpoint is for authorized Estimate workflows and may include internal cost information.

## Estimate snapshots

Adding an approved catalog item stores the selected Budget, shared Budget item, source entity, pricing record, pricing update timestamp, cost, and approved sell price on the Estimate line item. The Estimate API re-resolves newly added source items and replaces browser-provided financial values with the current approved server values.

Existing line-item snapshots are not re-resolved during later edits. Changing a Budget approval therefore does not silently alter an existing draft, sent, accepted, declined, or converted Estimate. A future explicit "refresh pricing" workflow would need its own review and lifecycle rules.

Custom items remain independent Estimate snapshots. They do not claim a Budget source identity.