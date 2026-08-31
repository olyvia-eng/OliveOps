# Division Labour planning model

Division Labour records reference the shared employee by `employeeId`. Planned hours, field-producing percentage, billable percentage, overtime, and Division allocations are Budget assumptions and do not update the Employee record.

Current Employee compensation type, wage or salary, payroll burden, benefits, and bonus are authoritative when calculating new Budget and Estimate pricing. Persisted compensation fields on Labour planning records remain available as import snapshots and compatibility fallbacks when an older Employee record does not define burden, benefits, or bonus. Pricing prepares these inputs once before calculating Labour cost, overhead recovery, and sell rates, so Budget Analysis and server-authorized Estimate pricing use the same values.

## Defaults for existing data

- `fieldProducingPct` is authoritative when present. Missing values inherit the legacy classification: `billable` becomes `100` and `overhead` becomes `0`. A missing classification defaults to `billable`.
- `overheadPct` is always derived as `100 - fieldProducingPct`; it is not persisted independently.
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

## Direct and overhead split

`direct labour cost = annual labour cost × field-producing %`

`overhead labour cost = annual labour cost - direct labour cost`

`field-producing hours = regular planned hours × field-producing %`

`expected billable hours = field-producing hours × expected billable %`

Regular planned hours are the Budget's eligible paid-hours assumption. Overtime hours are modeled separately as cost and are not included in billable-hours capacity.

`direct cost per billable hour = direct labour cost ÷ expected billable hours`

Zero billable hours produce no rate. This form does not add overhead recovery, profit, margin, or a sell rate.

The direct and overhead portions always reconcile exactly to annual labour cost. `expectedBillablePct` controls chargeable capacity within field-producing time; it does not change the direct/overhead cost split. The overhead portion enters overhead recovery, while Labour Class pricing uses only direct cost and expected billable hours.

## Division allocation

`divisionAllocations` uses `{ divisionId, hours }` for current records. Hours must reference active Divisions in the same Budget and total planned hours. Legacy percentage allocations remain readable.

`Division direct cost = direct labour cost × Division allocation share`

`Division overhead cost = overhead labour cost × Division allocation share`

`Division billable hours = expected billable hours × Division allocation share`. Division allocation distributes both cost portions and capacity; it does not change annual totals and remains independent of the field-producing and expected-billable percentages.