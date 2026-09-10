# Employee Forms API

Blocking Forms using `before_clock_in` or `after_clock_out` are server-enforced through persisted workflow occurrences. See [Mandatory Forms After Clock-Out](mandatory-after-clock-out-forms.md) for the clock-out initiation, submission correlation, recovery, and completion contracts. Scheduled Forms are due-list items and never interrupt clocking. Unsupported legacy Job-event configurations are retained for review but do not create new occurrences.

Phase 1 exposes the existing OliveOps Forms definitions and submissions to employee clients. The Forms builder remains the source of `FormRecord` and `FormField` data. Mobile clients must use `/api/employee`; they must not read or write Forms through `/api/data`.

## Employee bootstrap timezone

`GET /api/bootstrap` returns `timezone`, an IANA timezone derived from the persisted business profile. Mobile must use this value as the business authority for business-day boundaries; it must not submit a device timezone as the business timezone.

The server treats `after_completing_job` and the other historical Job-event values as legacy, distinct values. They are not emitted or reinterpreted as switching activity, leaving a Work Area, clocking out, or completing a Job. Existing submissions and immutable pending clock snapshots remain readable and completable, but these legacy values do not create new occurrences.

## Authentication

Every request requires an OliveOps session cookie or a bearer access token:

```http
Authorization: Bearer <access-token>
```

The server derives the business, user, and active employee profile from the session. Clients cannot select a tenant, employee, submitter, status, submission ID, or timestamp. Owner, admin, foreman, and crew accounts may use the employee endpoints only when linked to an active employee profile.

## Get the Forms workspace

```http
GET /api/employee?action=forms
GET /api/employee?action=forms&jobId=<id>&equipmentId=<id>&divisionId=<id>
```

The optional context filters narrow the returned instances. They do not grant access to a job or equipment asset.

```json
{
  "ok": true,
  "timezone": "America/Toronto",
  "generatedAt": "2026-03-20T14:30:00.000Z",
  "toDo": [],
  "available": [],
  "completed": []
}
```

`toDo` contains server-authoritative incomplete scheduled occurrences plus unresolved required Forms from the authenticated employee's persisted clock-in and clock-out workflows. Clock-out workflows are reconciled against durable submissions before they are returned. Mandatory items use the immutable workflow snapshot and include `workflowOccurrenceId`, `workflowRequirementId`, and `requiredFor` (`clock_in` or `clock_out`) for correlated submission. `available` contains only Forms whose delivery rule permits manual access. `completed` contains up to 50 of the employee's non-draft submissions, newest first. Ambiguous legacy configurations are retained for review but do not create new Job-event or schedule occurrences.

Current Form discovery and Job/Customer selector choices include only operational Jobs. Jobs with status `completed`, `cancelled`, or `on_hold` are non-actionable; all other and legacy missing statuses remain actionable. Changing a Job back to an actionable status makes its assigned Forms available on the next request.

A renderable Form instance has this shape:

```json
{
  "id": "form-id",
  "name": "Daily Field Report",
  "description": "Record progress and delays.",
  "category": "operations",
  "trigger": "daily",
  "required": true,
  "completionRequirement": "required",
  "enforcement": "advisory",
  "periodKey": "2026-03-20",
  "occurrenceId": "scheduled:form-id:employee-id:job-id:2026-03-20",
  "dueDate": "2026-03-20",
  "occurrenceState": "due",
  "context": {
    "jobId": "job-id",
    "jobName": "Main Street",
    "equipmentId": "equipment-id",
    "equipmentName": "Excavator 12",
    "divisionId": "division-id",
    "divisionName": "Earthworks"
  },
  "fields": [],
  "submissionState": {
    "completed": false
  }
}
```

Missing context values and incomplete submission-state metadata are omitted from JSON.

Scheduled occurrence dates use the configured business timezone. Weekly rules use their selected weekdays, monthly rules clamp deterministically to the final day of shorter months, and custom intervals are anchored to the Form creation date. An occurrence is `due` on its due date, `overdue` afterward, and its historical submission is `completed`.

`required` is the existing trigger-derived workspace flag: it is `false` only for `on_demand`. `completionRequirement` is the builder policy (`reminder` or `required`) and defaults to `reminder` for legacy records. `enforcement` is `blocking` only for Required before-clock-in and after-clock-out occurrences; all other triggers are advisory.

## Check a required trigger

```http
GET /api/employee?action=required&trigger=before_clock_in
GET /api/employee?action=required&trigger=after_clock_out
```

Normalized workflow delivery types are `before_clock_in` and `after_clock_out`. Legacy Job-event trigger strings remain accepted only where needed to read historical data; new required discovery returns no occurrences for them. Schedule compatibility triggers are `daily`, `weekly`, and `monthly`. The response contains only active, assigned Forms not already satisfied for the period and context:

```json
{
  "ok": true,
  "trigger": "before_clock_in",
  "timezone": "America/Toronto",
  "forms": []
}
```

This discovery endpoint does not itself authorize a client-side block. Blocking before-clock-in and after-clock-out Forms are enforced only through their server-owned persisted workflow occurrences. Unsupported Job-event values return no new requirements.

## Submit a Form

```http
POST /api/employee?action=submit
Content-Type: application/json
```

```json
{
  "formId": "form-id",
  "clientSubmissionId": "018f47ac-7c42-7b35-9c79-0f4e871ca202",
  "trigger": "daily",
  "occurrenceId": "scheduled:form-id:employee-id:job-id:2026-03-20",
  "jobId": "job-id",
  "equipmentId": "equipment-id",
  "divisionId": "division-id",
  "responses": [
    { "fieldId": "field-id", "value": "Completed west trench" },
    { "fieldId": "signature-field-id", "fileIds": ["signature-file-id"] }
  ]
}
```

`trigger` must be configured on the active Form. Normalized scheduled Forms also require the exact `occurrenceId` returned by the Forms workspace. A generic `on_demand` submission never satisfies a due occurrence. Context IDs are optional unless needed by the Form assignment or trigger. A job must be directly assigned to the employee or assigned to one of their active crews. Equipment must be assigned through the supplied authorized job. Division must agree with the job context.

The server validates all answers, creates the submission and responses in one DynamoDB transaction, and returns `201`. Forms configured with `requiresApproval: true` return `status: "pending_review"`; all others return `status: "submitted"`.

Required `after_clock_out` submissions canonically include both `workflowOccurrenceId` and `workflowRequirementId`. During the temporary older-mobile compatibility window, a request missing one or both values is correlated only when exactly one unresolved requirement matches in the authenticated employee's reconciled pending clock-out workflow. Explicit complete correlation remains strict, and clients must not rely on inference. See [Mandatory Forms After Clock-Out](mandatory-after-clock-out-forms.md#temporary-compatibility-for-older-mobile-builds) for matching and conflict details.

New Signature answers are drawn PNG artifacts, not text values. Before submission, prepare a private upload through `/api/storage` with `entityType: "form-signature"`, `category: "signature"`, the Form and field IDs, the stable `clientSubmissionId`, and mandatory workflow IDs when applicable. Upload the PNG with the returned write-once headers, complete the upload, and then submit its `fileId`. The server verifies the tenant, authenticated employee/user, Form, field, logical submission, workflow correlation, upload state, MIME type, size, and checksum before atomically claiming the artifact with the submission. Signature PNGs are limited to 2 MB.

Each new response stores immutable `labelSnapshot` and `typeSnapshot` values. Signature responses also store the artifact reference, server submission time as `signedAt`, and authenticated signer IDs. Review prefers these snapshots so later Form edits or field deletion do not alter historical rendering. Existing responses without snapshots retain the live-field fallback, and historical Signature string values remain readable as text.

```json
{
  "ok": true,
  "submission": {
    "id": "form-generated-id",
    "formId": "form-id",
    "employeeId": "employee-id",
    "trigger": "daily",
    "periodKey": "2026-03-20",
    "submittedAt": "2026-03-20T14:35:00.000Z",
    "status": "submitted",
    "submittedBy": "Alex Smith",
    "submittedByUserId": "user-id",
    "clientSubmissionId": "018f47ac-7c42-7b35-9c79-0f4e871ca202",
    "responsesCreated": 1
  }
}
```

`clientSubmissionId` is an opaque, stable ID for one logical submission. It must be 8–128 characters, start with an alphanumeric character, and contain only alphanumeric characters, `.`, `_`, `:`, or `-`. Mobile must generate it when the employee starts a submission and reuse it unchanged for every retry. The authenticated business and employee scope the key; request-body ownership fields are ignored.

The key claim, submission header, and answers are written in one DynamoDB transaction. An equivalent retry returns the original successful result with `200`:

```json
{
  "ok": true,
  "replayed": true,
  "submission": {
    "id": "form-generated-id",
    "formId": "form-id",
    "employeeId": "employee-id",
    "clientSubmissionId": "018f47ac-7c42-7b35-9c79-0f4e871ca202",
    "responsesCreated": 1
  }
}
```

The server fingerprints the validated `formId`, trigger, authorized job/equipment/division context, and normalized responses sorted by field ID. Reusing the same scoped key with a different logical payload returns `409` with `submission_idempotency_conflict` and creates nothing. Recurring Forms retain deterministic submission IDs as a second uniqueness guard, so a different client key cannot create a second completion for the same period and context.

Idempotency claims expire after 30 days through DynamoDB TTL; submission and response records do not expire. The claim stores only the fingerprint and safe submission response, never raw answers. Requests without a key retain the legacy behavior during mobile rollout, while an explicitly supplied empty or invalid key is rejected. Clients may send `{ "data": { ... } }` around the request body for compatibility. A keyed submission may contain at most 98 answer-bearing responses because its claim shares DynamoDB's 100-action transaction; a legacy keyless submission may contain at most 99.

## Get a completed submission

```http
GET /api/employee?action=submission&id=<submission-id>
```

Employees can retrieve only their own submissions. The response includes summary metadata, archived-safe Form metadata, and saved answers:

```json
{
  "ok": true,
  "submission": {
    "submissionId": "submission-id",
    "formId": "form-id",
    "formName": "Daily Field Report",
    "submittedAt": "2026-03-20T14:35:00.000Z",
    "status": "submitted",
    "trigger": "daily",
    "clientSubmissionId": "018f47ac-7c42-7b35-9c79-0f4e871ca202",
    "context": { "jobId": "job-id", "jobName": "Main Street" }
  },
  "form": {
    "id": "form-id",
    "name": "Daily Field Report",
    "description": "Record progress and delays.",
    "category": "operations"
  },
  "answers": [
    {
      "fieldId": "field-id",
      "label": "Work completed",
      "type": "multi_line_text",
      "value": "Completed west trench"
    }
  ]
}
```

## Field rendering and validation

Each field package includes `id`, `type`, `label`, `helpText`, `required`, `defaultValue`, `placeholder`, `options`, `acceptedResponse`, and `order`. Selector fields also include authorized `choices` as `{ "value", "label" }` objects. `acceptedResponse` has an exact `value` and an optional administrator-authored `message`; it is available for Yes/No and configured-option fields.

| Type | Mobile behavior | Submitted value |
| --- | --- | --- |
| `section_header`, `paragraph_text` | Display only | Do not submit |
| `single_line_text` | One-line input | String, maximum 500 characters |
| `multi_line_text` | Multi-line input | String, maximum 10,000 characters |
| `number`, `currency` | Numeric input | Finite number encoded as a string |
| `date` | Date picker | `YYYY-MM-DD` |
| `time` | Time picker | 24-hour `HH:MM` |
| `yes_no` | Two-choice control | `yes` or `no` |
| `checkbox`, `multiple_choice`, `dropdown` | Configured options | One exact value from `options` |
| `signature` | Drawn touch/pointer signature | One completed private PNG `fileId`; optional fields may be omitted |

## Clone a Form

Owner and admin users can clone a tenant-owned Form definition atomically:

```http
POST /api/forms?action=clone
Content-Type: application/json

{ "sourceFormId": "form-id" }
```

The clone receives a new Form ID, new IDs for every field, new timestamps, `status: "draft"`, and exactly `trigger: []`. Its title is suffixed with ` - Copy`; reusable assignment, completion, approval, field ordering, options, accepted-response rules, and Signature definitions are deep-copied. Submissions, responses, artifacts, approvals, workflow occurrences, and source audit history are never copied. The response contains the new `form` and `fields` for immediate Builder navigation.
| `employee_selector`, `job_selector`, `customer_selector` | Authorized choices | One exact `choices[].value` ID |
| `photo_upload`, `file_upload` | Render as unavailable in Phase 1 | Do not submit an answer |

Optional blank answers may be omitted. Duplicate field IDs, fields from another Form, display-field answers, and values outside server-provided options are rejected.

After normal type and option validation, the server compares any configured accepted response. A mismatch returns `400` with `code: "form_response_requirement_failed"`, the `fieldId`, and the configured message or a fallback message. No submission, response, idempotency claim, or mandatory-workflow completion is written on failure.

### Attachments

Phase 1 intentionally does not upload Form attachments. Base64, data URLs, raw bytes, and unverified file IDs are rejected. Optional photo/file fields can be skipped; an active Form with a required media field cannot be completed from mobile until the attachment flow is added.

The future flow should upload bytes directly to object storage using a short-lived authorized upload, create a tenant-owned file entity, and submit only verified file IDs. File bytes must never be stored in DynamoDB or routed through the Form submission JSON.

## Assignment rules

- `everyone`: every active linked employee.
- `role`: exact employee role match.
- `employee`: exact employee ID match.
- `job`: employee is authorized for the configured job.
- `division`: employee belongs through an active crew default division or an authorized job division. New definitions store canonical Division IDs; legacy names are still resolved.
- `equipment`: configured equipment is attached to an authorized job. Equipment assignment never grants job access by itself.

All evaluation fails closed when the assignment or required context cannot be resolved.

Job authorization and operational lifecycle are evaluated separately. Lifecycle filtering applies only to current discovery, new submissions, active-work selectors, and creation of new mandatory workflow occurrences. Historical submissions retain their saved Job context, and an already-persisted mandatory clock-in or clock-out occurrence remains completable if the Job later becomes completed, cancelled, or on hold.

## Recurring periods

Timestamps are stored in UTC. Period keys are calculated in the configured IANA business timezone. Existing businesses without a timezone use `America/Toronto`.

- Daily: local calendar date, for example `2026-03-20`.
- Weekly: Monday-start local business week, represented by its Monday date.
- Monthly: local calendar month, for example `2026-03`.
- Historical Job-event submissions retain their original trigger and context for display and audit. They do not satisfy normalized clock or scheduled occurrences.

A `submitted`, `pending_review`, or `approved` submission satisfies a required instance. A `draft` or `rejected` submission does not. Approval is a downstream office workflow and never delays clock-in or clock-out after the employee has submitted valid answers.

## Errors and retry behavior

Errors use `{ "ok": false, "error": "..." }`; field validation may also include `fieldId`.

| Status | Meaning |
| --- | --- |
| `400` | Invalid client submission ID, trigger, answer, field, option, date/time, or request shape |
| `401` | Missing, invalid, or expired session |
| `403` | Context unavailable or Form not assigned to this employee |
| `404` | Active employee profile, Form, or owned submission not found |
| `409` | Inactive Form, completed recurring instance, or `submission_idempotency_conflict` |
| `405` | Unsupported HTTP method |

After a recurrence `409`, refresh `action=forms` before offering another attempt. A `submission_idempotency_conflict` means the client reused one logical submission ID for different content and must not automatically retry it. Network failures should be retried with the same `clientSubmissionId` and equivalent payload; the server returns the original result if the first request committed.

## Web review

Owner, admin, and foreman users review submissions in the existing Forms → Submissions screen. Its status-only endpoint is:

```http
PATCH /api/forms-review?id=<submission-id>
Content-Type: application/json

{ "status": "approved" }
```

Only `pending_review → approved|rejected` is allowed. The endpoint derives the tenant from the reviewer session and cannot mutate submission ownership, context, answers, or timestamps. Generic `/api/data` reads remain available according to role, but writes to `form-submissions` and `form-responses` are rejected; submissions must use the canonical employee endpoint.