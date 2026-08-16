# Division Labour planning model

Division Labour records reference the shared employee by `employeeId`. Wage, hours, classification, overtime, and allocation values on the record are Budget assumptions and do not update the employee's HR record.

## Defaults for existing data

- Missing `labourClassification` defaults to `billable`; employee role is never used to infer classification.
- Missing `expectedBillablePct` is derived from legacy billable hours when possible, otherwise `0`.
- Missing overtime hours default to `0` and the multiplier defaults to `1.5`.
- Missing Division allocation defaults to 100% for the record's existing Division.

## Annual cost

For hourly Labour:

`regular wages = base hourly wage × regular planned hours`

`overtime wages = base hourly wage × planned overtime hours × overtime multiplier`

For salaried Labour, regular wages are the annual salary and overtime wages are zero.

`payroll burden = (regular wages + overtime wages) × payroll burden %`

`annual labour cost = regular wages + overtime wages + payroll burden + benefits + bonus`

Payroll burden is applied once to regular and overtime wages. Benefits and bonus are added afterward.

## Billable capacity and direct cost

`expected billable hours = regular planned hours × expected billable %`

Regular planned hours are the Budget's eligible paid-hours assumption. Overtime hours are modeled separately as cost and are not included in billable-hours capacity.

`direct cost per billable hour = annual labour cost ÷ expected billable hours`

Zero billable hours produce no rate. This form does not add overhead recovery, profit, margin, or a sell rate.

Billable Labour contributes annual cost to direct Labour and does not enter the overhead Labour pool. Overhead Labour contributes annual cost to the overhead pool and has no billable hours or direct cost rate.

## Division allocation

`divisionAllocations` is an array of `{ divisionId, percentage }`. Percentages must reference active Divisions in the same Budget and total exactly 100%.

`Division annual cost = annual labour cost × Division allocation %`

For billable Labour, `Division billable hours = expected billable hours × Division allocation %`. Allocation distributes cost and capacity; it does not change annual totals and is independent of expected billable percentage.