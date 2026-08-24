# Division Overhead Allocation and Recovery

OliveOps stores overhead as budget-scoped Division planning items. Each overhead item has one annual amount and an exact 100% allocation across one or more active Divisions. Division P&L and Analysis use only each Division's allocated share, so a shared item is counted once in the overall Budget.

Allocation and recovery are separate:

- Allocation answers which Divisions own an overhead cost.
- Recovery answers how each Division recovers its allocated pool through Labour, Equipment, Materials, and Subcontractor pricing.

Recovery percentages are stored on each Division and must total 100%. Labour recovery remains hour-based. Equipment, Materials, and Subcontractors use annual Division cost as their recovery denominator and apply the resulting recovery percentage to each item's direct cost. A positive pool with no denominator remains unrecoverable and produces a planning warning instead of dividing by zero.

Calculated rates use direct cost plus Division overhead recovery, followed by the existing gross-margin calculation. Existing approved-rate records remain readable and are never overwritten by recalculation. New Division-model Estimate lines snapshot the current calculated rate through server-side authorization; existing Estimate snapshots are not repriced.

## Legacy normalization

Legacy top-level `BudgetItem` overhead records are not deleted. When an owner or admin opens a Division-model Budget with active Divisions, `/api/budget-overhead-migration` creates one stable shared planning counterpart per legacy record and records `legacyBudgetItemId`. The initial allocation is split evenly across active Divisions at 0.01% precision, with rounding assigned to the final Divisions so the total is exactly 100%.

The migration is idempotent. Existing legacy records remain available for storage compatibility, while active P&L, Analysis, and pricing calculations use only the shared planning counterpart. Users can then review and edit the allocation from any allocated Division's Overhead tab.

Legacy `companyOverheadRecoveryPerUnit` fields remain readable on previously approved Budget rates and Estimate snapshots so historical Estimates do not change. New recommendations and approvals do not populate that field; active pricing uses `divisionOverheadRecoveryPerUnit` and the combined `overheadRecoveryPerUnit` only.

## Labour hours and Average Labour pricing

Labour overhead recovery uses planned billable labour hours allocated to each Division. For each billable labour planning item:

```text
item billable hours = plannedHours × expectedBillablePct / 100
Division share = allocated Division hours / plannedHours
Division billable hours = item billable hours × Division share
```

Legacy percentage allocations use `allocation.percentage / 100` for the Division share. Labour classified as `overhead` contributes zero billable hours. Its allocated annual cost instead enters the Division overhead pool. The active denominator does not use annual available hours or a separate sellable-hours field. Persisted `billableHours` can be used during legacy normalization to derive `expectedBillablePct`, but it is not independently added to the denominator.

The labour recovery rate is:

```text
Division overhead allocated to labour
÷ Division planned billable labour hours
= labour overhead recovery per billable hour
```

The recovery model test fixture makes the allocation effect explicit. An operator has 2,000 planned hours at 80% billable, or 1,600 billable hours. Of 2,000 allocated hours, Snow receives 1,200 and Landscape receives 800. The resulting denominators are:

```text
Snow:      1,600 × (1,200 ÷ 2,000) = 960 billable hours
Landscape: 1,600 × (  800 ÷ 2,000) = 640 billable hours
```

The fixture's overhead manager contributes no billable hours. The specific `$8.22/hr` and `$2.65/hr` values observed in a live Budget are not stored in repository fixtures; reproducing those exact values requires an authenticated payload for that Budget.

Analysis presents one `Average Labour` row per Division. Its labour cost is weighted by the same allocated billable hours:

```text
Average Labour Cost
= sum(allocated annual cost for billable labour)
	÷ sum(allocated planned billable labour hours)
```

This is not a simple average of employee rates. The recommended Labour Rate remains gross-margin based, with contractor-facing terminology:

```text
Breakeven = Average Labour Cost + Labour Overhead Recovery
Labour Rate = Breakeven ÷ (1 - Target Net Profit %)
```

Before this model runs, Labour planning records are enriched with current Employee compensation through the shared pricing-input boundary. Budget-specific hours, billable percentage, overtime, classification, and allocations remain unchanged. Persisted planning compensation is retained for imports and compatibility, but stale wage snapshots cannot lower current Budget Analysis or new Estimate pricing.

The Analysis pricing workbook presents four client-side tabs: Labour, Equipment, Materials, and Subcontractors. Labour is selected by default. Changing tabs only filters the already calculated rows; it does not write Budget rates or other persisted data.

## Recovery denominator audit

Every pricing row reads its recovery pool, denominator, and rate from the same Division scope produced by `buildOverheadRecoveryModel`. Planning records are de-duplicated by record ID before totals are calculated. Only active Divisions in the selected Budget receive recovery scopes.

| Category | Division denominator | Displayed overhead |
| --- | --- | --- |
| Labour | Sum of allocated planned billable labour hours | Labour pool / billable hours |
| Equipment | Sum of Division-attributed annual cost for billable equipment | Item direct cost * (equipment pool / annual equipment cost) |
| Materials | Sum of `unitCost * plannedQuantity` for material records belonging to that Division | Item unit cost * (material pool / annual material cost) |
| Subcontractors | Sum of `rate * plannedQuantity` for subcontractor records belonging to that Division | Item rate * (subcontractor pool / annual subcontractor cost) |

Equipment rows are produced once for every positive-month Division allocation. `equipmentAnnualCost` uses `plannedAmount` when present. Its fallback matches Division P&L: `equipmentPayment * equipmentPaymentFrequencyPerYear` plus `yearlyFuelCost`, `yearlyInsuranceCost`, and `yearlyMaintenanceCost`. `equipmentDivisionAnnualCost` attributes that annual cost using the established `allocated months / 12` share. Overhead-classified equipment is excluded from the recovery denominator because its attributed cost already enters Division overhead.

Asset-wide `sellableHoursPerYear` remains part of the equipment direct-cost-per-hour calculation, but equipment hours do not participate in overhead recovery. Shared equipment contributes only its month-attributed annual cost to each Division. Equal recovery percentages in two Divisions are valid only when each Division independently has the same `equipment pool / attributed annual equipment cost` quotient.

For Equipment, Materials, and Subcontractors, the calculation is:

```text
class recovery pool = Division allocated overhead * class allocation %
class recovery rate = class recovery pool / annual Division class cost
cost after overhead recovery = item direct cost * (1 + class recovery rate)
selling rate = cost after overhead recovery / (1 - Target Net Profit %)
```

Materials use `unitCost * plannedQuantity`. Subcontractors use `rate * plannedQuantity`. A missing legacy quantity follows the established Division P&L behavior and defaults to one; an explicit zero remains zero. A class with a zero recovery pool and zero annual cost safely uses a 0% recovery rate.

Labour allocation writes are validated to contain each Division once and total the employee's planned hours. Legacy percentages must total 100%. Equipment allocation writes contain each Division once, reference Divisions in the same Budget, and total 12 months. These validations prevent malformed new allocations from entering the recovery model.

When a recovery pool is positive but its Division denominator is zero, the category and final calculated rate are `Unavailable`. Analysis exposes the actual unrecoverable pool and missing denominator instead of presenting `$0.00` overhead or a direct-cost-only rate. The warning above Pricing directs the user to add the missing recovery base or change the Division recovery allocation. Unconfigured recovery or percentages that do not total 100% also make calculated rates unavailable until the allocation is corrected.

Previously persisted Budget approvals remain readable in the pricing model for compatibility, including the stable `average-labour:<divisionId>` identity. Analysis no longer displays or edits Approved Rate and Status. New Division-model Estimate lines use calculated pricing, while immutable historical Estimate snapshots and legacy Budget pricing behavior remain unchanged.

## Analysis financial summary

The Analysis summary is a projection of `calculateBudgetFinancials`, not a second financial calculation. Revenue is the sum of active Division revenue targets. Labour and Equipment use the model's allocation-aware direct annual costs, Materials and Subcontractors use their Division planned costs, and Overhead uses `totalOverhead` from overhead Labour, overhead Equipment, and Division-allocated overhead planning items. Legacy Company Overhead records are not an input.

`Budget.targetMarginPct` is the only persisted Target Net Profit value. Percentage mode edits that value directly. Dollar mode derives it as `target profit dollars / Budget revenue`; switching display modes does not persist another value. Pricing reads the same `Budget.targetMarginPct` and continues to use margin division rather than markup.

The summary separately calculates current Budget profit as `revenue - total planned costs`. It never substitutes current profit for Target Net Profit. The revenue distribution bar uses the same summary lines as the financial statement. Its scale is the larger of revenue and `planned costs + target profit`, so an infeasible target displays beyond the revenue-limit marker instead of being normalized back to 100%.