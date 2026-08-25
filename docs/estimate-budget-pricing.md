# Estimate pricing from operating Budgets

Estimate Work Areas consume calculated pricing from the Estimate's selected overall Budget. The Budget financial model calculates company selling rates; Estimates reuse its rate and readiness result without requiring approval or a persisted Budget rate.

## Canonical path

For `divisions_v1` Budgets, catalog discovery starts from tenant-owned `BUDGET_DIVISION_PLAN` records across the entire Budget. Each Estimate has one selected Division, and the Work Area catalog includes planning items allocated to that Division.

The server deduplicates shared items by canonical identity:

- Labour: `employeeId`
- Equipment: `equipmentId`
- Materials: `materialCatalogItemId`
- Subcontractors: `vendorId` when available, otherwise the shared Budget planning item ID

The server calls the same `buildBudgetPricingRows` model used by Budget Pricing. A positive finite calculated rate is available for new Estimate pricing. Missing recovery configuration, missing recovery denominators, or another incomplete Budget input leaves the item unavailable according to that canonical model. Estimates do not implement a separate readiness rule or fallback rate.

Equipment, Materials, and Subcontractors use the calculated row for their planning item in the selected Division. Display names are not an identity boundary.

Labour distinguishes named employees from generic resources. An employee's allocated planning item determines whether that employee is eligible for the selected Division and produces that employee's charge-out rate from their canonical compensation inputs, Budget planned and billable hours, the Division overhead recovery rate, and the Budget target margin. Employees with different costs can therefore have different calculated rates. Generic resources such as Hardscape Labor continue to use the Division's calculated `average-labour:<divisionId>` row. Neither path falls back to legacy approvals when the current Budget calculation is incomplete.

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

Each current Division item includes `budgetItemId`, `sourceEntityId`, unit, cost rate, `sellRate`, `pricingAvailable`, and `pricingStatus: "calculated" | "unavailable"`. For Labour, `sourceEntityId` remains the selected employee while the cost and sell rates come from the aggregate Division Labour row. `sourceRateId` and approval-related fields may still appear for legacy catalog compatibility, but they do not control new `divisions_v1` pricing. The endpoint is for authorized Estimate workflows and may include internal cost information.

## Estimate snapshots

Adding a calculated catalog item stores the selected Budget, shared Budget item, source entity, pricing version, internal cost, and calculated sell price on the Estimate line item. The Estimate API re-resolves newly added source items and replaces browser-provided financial values with current server-calculated values. Budget-priced lines store the calculated selling rate directly and do not apply a second Estimate-level markup.

Existing line-item snapshots are not re-resolved during later edits. Their source, cost, and sell-rate fields are preserved authoritatively while quantity and notes may change. Changing Budget inputs or recalculating rates therefore does not silently alter an existing draft, sent, accepted, declined, or converted Estimate. Historical Estimates that contain legacy approval-based snapshots remain unchanged. A future explicit "refresh pricing" workflow would need its own review and lifecycle rules.

Custom items remain independent Estimate snapshots. They do not claim a Budget source identity and allow an estimator to enter quantity, unit, selling rate, and optional internal estimated cost.