# Budget Division Monthly Actuals

Budget Profit & Loss remains the annual planned financial statement. Its Compare workspace is an actual month-over-month view scoped to one Budget and one Division.

## Actual sources

| Metric | Monthly source | Coverage |
| --- | --- | --- |
| Revenue | Non-draft invoices for Jobs whose `pricingBudgetId` and `divisionId` match the selected Budget and Division, bucketed by `issueDate`; `amount` is the persisted invoice total. | Available for issued invoices. This is invoiced revenue, not cash receipts or earned-revenue recognition. |
| Labour | Dated Job `actualCosts` in the labour category. When a Job has no recorded labour cost for that month, closed job time entries are valued at the employee base hourly rate and shared equally across linked Jobs. | Partial. The time-entry fallback excludes payroll burden, benefits, and overtime premiums. |
| Equipment | Dated Job `actualCosts` in the equipment category; otherwise approved or paid Job-linked equipment expenses. | Partial. Equipment assignment or annual Budget allocation is not treated as actual usage cost. |
| Materials | Dated Job `actualCosts` in the material category; otherwise approved or paid Job-linked material expenses. | Partial. Unlinked expenses cannot be attributed to a Division. |
| Subcontractors | Dated Job `actualCosts` in the subcontractor category; otherwise approved or paid Job-linked subcontractor expenses. | Partial. Unlinked expenses cannot be attributed to a Division. |
| Overhead | Approved or paid Job-linked overhead expenses. | Partial when linked records exist. Otherwise unavailable because annual Budget overhead and unlinked company expenses cannot be assigned to a Division honestly. |

Recorded Job cost is preferred over a Job-linked expense fallback for the same Job, category, and month. This avoids counting two possible representations of one cost. Pending expenses and draft invoices are excluded.

Net Profit and Net Profit Margin are unavailable when a required actual cost source is unavailable. Annual Budget values are never divided by 12 or presented as actuals.

## Month boundaries

Periods use calendar-month boundaries clipped to the Budget's configured `startDate` and `endDate`. For a Budget running from December 31, 2026 through December 30, 2027, Compare produces a one-day December 2026 period, full intervening calendar months, and a December 1-30, 2027 period. Duplicate month names include the year in their tabs.

YTD aggregates from the first clipped Budget period through the selected month. January uses the preceding December period when that period is inside the Budget range; otherwise it has no previous period.

## Calculation boundary

`divisionMonthlyFinancialModel.js` is the shared pure calculation boundary for the selected-period table, previous-period variance, YTD, and trend chart. Each result includes source availability metadata and nullable values. That shape can be extended with parallel `budget`, `actual`, `variance`, and `variancePercent` values without moving financial logic into the UI.