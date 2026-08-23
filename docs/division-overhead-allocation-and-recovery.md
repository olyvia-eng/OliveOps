# Division Overhead Allocation and Recovery

OliveOps stores overhead as budget-scoped Division planning items. Each overhead item has one annual amount and an exact 100% allocation across one or more active Divisions. Division P&L and Analysis use only each Division's allocated share, so a shared item is counted once in the overall Budget.

Allocation and recovery are separate:

- Allocation answers which Divisions own an overhead cost.
- Recovery answers how each Division recovers its allocated pool through Labour, Equipment, Materials, and Subcontractor pricing.

Recovery percentages are stored on each Division and must total 100%. Labour uses planned billable hours, Equipment uses planned sellable hours by Division, and Materials/Subcontractors use their planned cost bases. A positive pool with no denominator remains unrecoverable and produces a planning warning instead of dividing by zero.

Recommended rates use direct cost plus Division overhead recovery, followed by the existing gross-margin calculation. Approved rates remain separate records and are never overwritten by recalculation. Estimates continue to snapshot approved rates only.

## Legacy normalization

Legacy top-level `BudgetItem` overhead records are not deleted. When an owner or admin opens a Division-model Budget with active Divisions, `/api/budget-overhead-migration` creates one stable shared planning counterpart per legacy record and records `legacyBudgetItemId`. The initial allocation is split evenly across active Divisions at 0.01% precision, with rounding assigned to the final Divisions so the total is exactly 100%.

The migration is idempotent. Existing legacy records remain available for storage compatibility, while active P&L, Analysis, and pricing calculations use only the shared planning counterpart. Users can then review and edit the allocation from any allocated Division's Overhead tab.

Legacy `companyOverheadRecoveryPerUnit` fields remain readable on previously approved Budget rates and Estimate snapshots so historical Estimates do not change. New recommendations and approvals do not populate that field; active pricing uses `divisionOverheadRecoveryPerUnit` and the combined `overheadRecoveryPerUnit` only.