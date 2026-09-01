# Owner/Admin Time Entry editing

## Architecture

Direct edits use `PATCH /api/clocking?action=edit-time-entry`. The endpoint is restricted to Owner and Admin sessions and delegates to the same server-owned `applyTimeEntryMutation` service used when an Owner/Admin approves an employee correction request targeting an existing Time Entry.

Employee correction submission remains unchanged. Legacy approved corrections remain read-time overlays. Newly approved corrections mutate the authoritative Time Entry atomically and store `mutationAppliedAt`, so they are not applied twice. A newer direct edit also supersedes any older legacy overlay.

## Editable fields

The service accepts Clock In, Clock Out for completed entries, Job, operational Work Area, activity type, Non-Billable category, notes, and an optional reason. Employee identity, status, break minutes, attachment references, internal IDs, and calculated cost fields are not client-editable.

Active entries retain their ID, employee, active status, and active-shift lock. Clock Out cannot be set through editing. An active entry with a pending mandatory clock-out workflow cannot be edited until that workflow finishes.

## Shared detail experience

Recent Time Entries and filtered Time Entry rows in Time Reports, Employee Time Entry history, and Job Time Entries all open the shared `TimeEntryDetailModal`. It shows the authoritative entry plus correction status and delegates Owner/Admin edits to the existing `EditTimeEntryModal`. Other roles receive the same read-only detail without an Edit action.

Surfaces select entries by ID from the current effective Time Entry collection. After the store reconciles the server response, the open detail, row, duration totals, Job/employee totals, and newest-first ordering update immediately without a browser refresh.

## Validation

The server validates employee and Job tenancy, activity type, completed-entry duration, supported date bounds, employee overlap, Non-Billable category, and Work Area membership in the selected Job's `operationalWorkAreas`. Historical edits may select completed operational Work Areas. Estimate Work Areas and Budget Division IDs are never accepted. Null Work Areas remain valid for legacy entries.

The browser supplies `expectedUpdatedAt`. The transaction conditions the Time Entry write on that value and returns `409 time_entry_conflict` when another write won first.

## Audit and calculations

The Time Entry write and `time_entry_edited` audit event are in one DynamoDB transaction. Correction approval adds its status transition to that same transaction and records `time_correction_approved`. Audit metadata contains the Time Entry and employee IDs, actor, timestamp, optional reason, and old/new editable values.

Duration, employee totals, Job hours, and report/payroll summaries continue to derive from authoritative timestamps. The mutation service recalculates persisted labour-cost snapshots with the existing employee labour-cost helper; no formulas are duplicated in the web form.
