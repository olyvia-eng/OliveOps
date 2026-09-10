# Mandatory forms after clock-out

OliveOps enforces forms configured with the `after_clock_out` trigger and `completionRequirement: "required"` on the server. Other workflow triggers remain advisory. Reminder-only forms never block clock-out.

## Clock-out initiation

Use the existing endpoint and payload:

```http
POST /api/clocking?action=clock-out
Authorization: Bearer <token>
Content-Type: application/json

{
  "entryId": "entry-id",
  "requestId": "client-request-id",
  "idempotencyKey": "stable-retry-key",
  "clientOccurredAt": "2026-08-25T20:30:00.000Z",
  "breakMinutes": 0,
  "notes": ""
}
```

The server validates `clientOccurredAt` using the existing offline clocking window and skew rules. The resulting event instant becomes the authoritative intended clock-out time.

When no applicable blocking forms exist, the endpoint retains its existing `200` response and immediately returns the completed `timeEntry`. Reminder forms are returned in `reminderForms`, are dismissible, and do not create workflow records.

When blocking forms apply, the server closes the time entry and clears the active shift in the same transaction that creates the recoverable workflow. It then returns `202`; a pending Form never keeps or reopens the shift:

```json
{
  "ok": true,
  "blocked": true,
  "status": "clock_out_pending_required_forms",
  "workflowOccurrenceId": "clock-out-...",
  "timeEntryId": "entry-id",
  "intendedClockOutAt": "2026-08-25T20:30:00.000Z",
  "requiredFormCount": 2,
  "completedRequiredFormCount": 0,
  "remainingRequiredFormCount": 2,
  "requiredForms": [],
  "completedForms": [],
  "remainingForms": [],
  "reminderForms": []
}
```

Each form package contains `requirementId`, `formId`, `title`, `description`, `category`, `trigger`, `order`, `context`, `completionRequirement`, and a complete immutable `form` snapshot. The snapshot includes field options, selector choices, accepted-response rules, and the Form approval policy as they existed when clock-out began.

Retrying initiation for the active time entry returns the existing workflow and preserves its original intended clock-out timestamp. Reusing the same idempotency key with a changed payload returns `clock_idempotency_conflict`.

## Submit a required form

Use the existing canonical submission endpoint. Required `after_clock_out` forms add two correlation fields:

```http
POST /api/employee?action=submit

{
  "formId": "form-id",
  "trigger": "after_clock_out",
  "workflowOccurrenceId": "clock-out-...",
  "workflowRequirementId": "requirement-...",
  "clientSubmissionId": "stable-form-retry-id",
  "responses": []
}
```

The server derives the employee from the session and the form context from the persisted workflow. Supplied context identifiers must match that workflow. The submission header stores both correlation IDs.

The existing transaction atomically writes the idempotency claim, submission header, responses, and workflow completion update. When that submission completes the final requirement, the server immediately finalizes the existing pending clock-out and includes the authoritative Time Entry in `clocking.timeEntry`. A successful idempotent replay returns the original submission and recovers the same finalization; it does not increment completion again, create duplicate answers, or create another Time Entry.

Accepted-response rules are evaluated from the immutable occurrence snapshot. Editing or archiving the source Form after initiation does not change an in-progress requirement. Legacy occurrence records without a form snapshot remain completable using the current Form fields. A valid submission configured for approval is stored as `pending_review` and completes the requirement immediately; office approval never blocks clock-out finalization.

A submission can satisfy exactly one requirement in exactly one occurrence. Previous clock-out submissions, another form's requirement ID, another employee, and another business cannot satisfy it.

### Temporary compatibility for older mobile builds

The canonical contract remains `workflowOccurrenceId` plus `workflowRequirementId`, and current clients must send both values. As a temporary production compatibility measure, the server can fill in one or both missing values for older clients submitting a required `after_clock_out` Form.

Compatibility lookup uses only the authenticated employee's canonical pending clock-out pointer after durable-submission reconciliation. It considers unresolved requirements and requires exactly one match by canonical `formId`, `after_clock_out` trigger, immutable Form snapshot ID, any supplied workflow ID, and every supplied persisted context ID (`jobId`, `equipmentId`, `divisionId`, `serviceId`, and `serviceVisitId`). Names and titles are never used. Request-body business and employee IDs are ignored.

If no pending workflow exists, no requirement matches, supplied correlation conflicts, or multiple requirements match, the server creates nothing and returns `409`. The compatibility codes are `legacy_workflow_correlation_not_found` and `legacy_workflow_correlation_ambiguous`. Requests containing both workflow IDs bypass inference and retain the strict canonical behavior.

After a compatible request is correlated, the server feeds the canonical IDs into the normal mandatory submission path. Immutable field and context validation, attachment binding, atomic completion, and finalization are unchanged. A retry with the same `clientSubmissionId` can recover the already-persisted canonical IDs from that authenticated employee's idempotency claim after finalization; mismatched retry content still returns `submission_idempotency_conflict`.

## Finalization recovery

```http
POST /api/clocking?action=clock-out-finalize

{
  "workflowOccurrenceId": "clock-out-..."
}
```

Clients do not need to start a second workflow after the final required form. This endpoint is the authoritative retry and recovery path when a form response was interrupted or a concurrent clock-state change prevented immediate finalization.

If requirements remain, the server returns `409` with `code: "required_forms_outstanding"` and the current workflow counts/lists. The initial clock-out transaction has already written clocking idempotency and audit records, closed the original time entry at `intendedClockOutAt`, and cleared the active-shift lock. Once all requirements are complete, finalization atomically marks the workflow occurrence finalized and deletes the employee pending pointer. Legacy workflow records created under the earlier deferred-clock-out behavior remain completable through their saved immutable data.

A repeated finalization returns `200` with `status: "clock_out_already_finalized"` and the original time entry. It does not create another time entry or audit transition.

## Pending workflow recovery

```http
GET /api/clocking?action=pending-clock-out
```

For owner/admin use on behalf of an employee, `employeeId` may be supplied as a query parameter and existing clocking authorization is applied.

A pending workflow returns `200`, `blocked: true`, and the same workflow state fields as initiation. No pending workflow returns:

```json
{
  "ok": true,
  "blocked": false,
  "status": "no_pending_clock_out",
  "workflow": null
}
```

Bootstrap also exposes:

- `capabilities.requiredAfterClockOutForms: true`
- `pendingClockOutWorkflow`: the current employee's workflow state or `null`

## DynamoDB records

Records use the existing business partition and are created only when Required forms block a clock-out:

```text
PK = BUSINESS#{businessId}
SK = CLOCK_OUT_WORKFLOW#{workflowOccurrenceId}
```

The occurrence record stores employee/time-entry ownership, the authoritative intended timestamp, original clock-out/idempotency data, required and reminder form snapshots, completed requirement IDs/count, status, and final time-entry response.

```text
PK = BUSINESS#{businessId}
SK = CLOCK_OUT_PENDING#EMPLOYEE#{employeeId}
```

The pointer provides direct employee recovery without a table scan. It is deleted atomically at finalization. The finalized occurrence record is retained for idempotent replay and auditability.

No migration or backfill is required. Existing submissions remain valid historical records but cannot satisfy a new mandatory occurrence.

## Machine-readable statuses and errors

Success/status values:

- `clock_out_pending_required_forms`
- `clock_out_completed`
- `clock_out_already_finalized`
- `no_pending_clock_out`

Error codes:

- `clock_idempotency_conflict`
- `pending_clock_out_exists`
- `employee_form_context_unavailable`
- `workflow_occurrence_required`
- `workflow_requirement_required`
- `clock_out_workflow_not_found`
- `clock_out_workflow_forbidden`
- `workflow_requirement_not_found`
- `workflow_context_mismatch`
- `workflow_requirement_already_completed`
- `clock_out_workflow_already_finalized`
- `required_forms_outstanding`
- existing `offline_shift_state_conflict` and timestamp validation codes

Cross-business occurrence IDs return `clock_out_workflow_not_found` and do not reveal foreign resources.

## Mobile implementation notes

- Generate and retain the existing clock-out `requestId` and `idempotencyKey` across retries.
- Treat HTTP `202` plus `status: "clock_out_pending_required_forms"` as a pending shift, not a completed clock-out.
- Cache active form definitions and fields from bootstrap for offline rendering.
- Persist the returned `workflowOccurrenceId`, each `requirementId`, and `intendedClockOutAt` locally.
- Submit each Required form through `/api/employee?action=submit` with both workflow correlation fields and its own stable `clientSubmissionId`.
- Use pending recovery after restart/sign-in and after ambiguous network failures.
- Call finalization only when `remainingRequiredFormCount` is zero; still handle `required_forms_outstanding` as authoritative.
- Do not substitute form completion time for the intended clock-out timestamp.
- Offline capture may queue submissions and finalization, but the shift remains server-side `clocked_in` until online enforcement succeeds.
