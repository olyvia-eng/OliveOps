# Mobile Forms delivery contract

The Forms builder stores one normalized `deliveryRule` per Form. Mobile continues to use `/api/employee`; it must not infer automation from combinations of legacy trigger values.

## Delivery rules

```json
{
  "type": "before_clock_in",
  "frequency": "once_daily",
  "completionBehavior": "blocking",
  "schedule": null,
  "allowManualAccess": true
}
```

- `before_clock_in` and `after_clock_out` use `once_daily` or `every_occurrence`, with `blocking` or `reminder` behavior.
- `scheduled` uses `due` behavior and a daily, weekly, monthly, or supported custom interval schedule.
- `always_available` uses `manual` behavior and creates no automatic occurrence.
- Manual access is a separate entry point. A generic manual submission does not satisfy a pending workflow or scheduled occurrence.

The business timezone returned by bootstrap is authoritative for daily and scheduled boundaries. Device timezone is presentation-only.

## Workspace sections

The mobile Forms area presents Needs attention, Scheduled, Available anytime, and Recent submissions. Use `occurrenceId` to deduplicate and to open a specific scheduled item. Send that identifier back as `deliveryOccurrenceId`. Opening a Form generically from Available anytime sends `trigger: "on_demand"` with no occurrence correlation.

## Clock workflows

Blocking clock-in and clock-out Forms use the persisted workflow package and its `workflowOccurrenceId` and `requirementId`. Preserve the server snapshot and stable `clientSubmissionId` across retries and restarts.

For after-clock-out workflows, the time entry is already closed before the workflow is returned. Mobile reconciles the shift as clocked out, explains that follow-up Forms remain, and recovers the pending workflow without reopening or editing the time entry. Reminder Forms may be dismissed and never authorize a client-side block.

## Legacy compatibility

The API retains compatibility trigger and workflow fields while clients roll forward. Unambiguous legacy Forms map to one normalized rule. Forms with mixed trigger/schedule rules or unsupported Job events are marked for admin review and create no new unsupported occurrences. Existing submissions and immutable pending clock workflows remain readable and completable.

Do not map clock-out, leaving a Work Area, switching activity, or any legacy trigger to Job completion. Job closeout automation is deferred.