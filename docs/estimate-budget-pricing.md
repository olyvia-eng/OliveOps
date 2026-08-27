# Estimate pricing from operating Budgets

Estimate Work Areas consume calculated pricing from the Estimate's selected overall Budget. The Budget financial model calculates company selling rates; Estimates reuse its rate and readiness result without requiring approval or a persisted Budget rate.

## Canonical path

For `divisions_v1` Budgets, catalog discovery starts from tenant-owned `BUDGET_DIVISION_PLAN` records across the entire Budget. Each Estimate has one selected Division, and the Work Area catalog includes planning items allocated to that Division.

The server resolves reusable estimating resources by canonical identity:

- Labour: `labourClassId`
- Equipment: `equipmentId`
- Materials: `materialCatalogItemId`
- Subcontractors: `vendorId` when available, otherwise the shared Budget planning item ID

The server calls the same `buildBudgetPricingRows` model used by Budget Pricing. A positive finite calculated rate is available for new Estimate pricing. Missing recovery configuration, missing recovery denominators, or another incomplete Budget input leaves the item unavailable according to that canonical model. Estimates do not implement a separate readiness rule or fallback rate.

The Budget persists `targetMarginPct` as percentage points, so a configured value of `10` means 10%. The pricing model applies it once as a margin: `breakeven / (1 - targetMarginPct / 100)`. Profit per unit is the calculated rate minus breakeven.

Current Division pricing treats only `customRate` as an explicit override. When it is `null` or absent, the Estimate rate is the calculated rate. Legacy `defaultSellPrice`, approved rates, equipment charge-out rates, and historical snapshot fields remain available to their compatibility paths but are not inferred to be a current custom override.

Equipment, Materials, and Subcontractors use the calculated row for their planning item in the selected Division. Display names are not an identity boundary.

Equipment eligibility is resolved before the Estimate catalog is returned. Equipment whose tenant-owned catalog record is classified as `overhead` is excluded rather than returned as unavailable; unlinked/manual planning items use their saved planning classification. Billable equipment continues through the existing Division pricing readiness rules. This selection rule does not remove or reprice equipment already snapshotted on an Estimate.

Labour uses reusable Labour Classes for new Estimate selection. Employee compensation and Budget allocations contribute to each class's weighted direct cost, but employee identities are not returned as new estimating resources. The selected Division's Labour Class row supplies direct cost, overhead recovery, breakeven, target margin, and calculated price. Historical employee-backed Estimate snapshots remain readable and are not migrated or repriced.

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

Each current Division item includes `budgetItemId`, `sourceEntityId`, unit, cost rate, `sellRate`, `pricingAvailable`, and `pricingStatus: "calculated" | "unavailable"`. For Labour, `sourceEntityId` and `labourClassId` identify the selected Labour Class. `sourceRateId` and approval-related fields may still appear for legacy compatibility, but they do not control new `divisions_v1` pricing. The endpoint is for authorized Estimate workflows and may include internal cost information.

## Estimate snapshots

Adding a calculated catalog item stores the selected Budget, shared Budget item, source entity, pricing version, direct cost, recovered cost, target margin, calculated price, effective Budget price, and final sell price on the Estimate line item. The Estimate API re-resolves newly added source items and replaces browser-provided financial values with current server-calculated values. A Budget custom rate remains distinguishable from the underlying calculated price, and Budget-priced lines do not apply a second Estimate-level markup.

Existing line-item snapshots are not re-resolved during later edits. Their source, cost, and sell-rate fields are preserved authoritatively while quantity and notes may change. Changing Budget inputs or recalculating rates therefore does not silently alter an existing draft, sent, accepted, declined, or converted Estimate. Historical Estimates that contain legacy approval-based snapshots remain unchanged. A future explicit "refresh pricing" workflow would need its own review and lifecycle rules.

Custom items remain independent Estimate snapshots. They do not claim a Budget source identity and allow an estimator to enter quantity, unit, selling rate, and optional internal estimated cost.