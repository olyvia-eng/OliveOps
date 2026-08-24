# Estimate pricing from operating Budgets

Estimate Work Areas consume approved pricing from the Estimate's selected overall Budget. They do not calculate company selling rates.

## Canonical path

For `divisions_v1` Budgets, catalog discovery starts from tenant-owned `BUDGET_DIVISION_PLAN` records across the entire Budget. Each Estimate has one selected Division, and the Work Area catalog includes planning items allocated to that Division.

The server deduplicates shared items by canonical identity:

- Labour: `employeeId`
- Equipment: `equipmentId`
- Materials: `materialCatalogItemId`
- Subcontractors: `vendorId` when available, otherwise the shared Budget planning item ID

Budget pricing approval is resolved only inside the selected Budget and Division. Equipment, Materials, and Subcontractors match their Division pricing by Budget item or canonical source identity. Legacy equipment approvals continue to match by `equipmentId`. Display names are not an identity boundary for new Budget catalogs.

Labour is different: an employee's allocated planning item determines whether that employee is eligible for the selected Division, but customer pricing always comes from the Division's version-2 `average-labour:<divisionId>` rate. Every eligible employee receives the same approved labour selling rate and average direct-cost basis. Employee wages still contribute to Budget Analysis and job costing; they are not customer-facing Estimate rates. If the Division Average Labour rate is incomplete, all employee choices remain unavailable without falling back to legacy employee approvals.

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

Each item includes `budgetItemId`, `sourceEntityId`, `sourceRateId`, unit, cost rate, recommended rate, approved rate, and `pricingStatus`. For Labour, `sourceEntityId` remains the selected employee while `sourceRateId` identifies the Division Average Labour approval. The endpoint is for authorized Estimate workflows and may include internal cost information.

## Estimate snapshots

Adding an approved catalog item stores the selected Budget, shared Budget item, source entity, pricing record, pricing update timestamp, internal cost, and approved sell price on the Estimate line item. The Estimate API re-resolves newly added source items and replaces browser-provided financial values with current approved server values. Budget-priced lines store the approved selling rate directly and do not apply a second Estimate-level markup.

Existing line-item snapshots are not re-resolved during later edits. Their source, cost, and sell-rate fields are preserved authoritatively while quantity and notes may change. Changing a Budget approval therefore does not silently alter an existing draft, sent, accepted, declined, or converted Estimate. A future explicit "refresh pricing" workflow would need its own review and lifecycle rules.

Custom items remain independent Estimate snapshots. They do not claim a Budget source identity and allow an estimator to enter quantity, unit, selling rate, and optional internal estimated cost.