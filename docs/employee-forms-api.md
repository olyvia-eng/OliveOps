# Employee Forms API

Phase 1 exposes the existing OliveOps Forms definitions and submissions to employee clients. The Forms builder remains the source of `FormRecord` and `FormField` data. Mobile clients must use `/api/employee`; they must not read or write Forms through `/api/data`.

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

`toDo` contains incomplete required instances. `available` contains active on-demand instances. `completed` contains up to 50 of the employee's non-draft submissions, newest first.

A renderable Form instance has this shape:

```json
{
  "id": "form-id",
  "name": "Daily Field Report",
  "description": "Record progress and delays.",
  "category": "operations",
  "trigger": "daily",
  "required": true,
  "periodKey": "2026-03-20",
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

## Check a required trigger

```http
GET /api/employee?action=required&trigger=before_clock_in
GET /api/employee?action=required&trigger=before_starting_job&jobId=<id>
GET /api/employee?action=required&trigger=after_completing_job&jobId=<id>&equipmentId=<id>
```

Valid required triggers are `before_clock_in`, `after_clock_out`, `before_starting_job`, `after_completing_job`, `daily`, `weekly`, and `monthly`. The response contains only active, assigned Forms not already satisfied for the period and context:

```json
{
  "ok": true,
  "trigger": "before_starting_job",
  "timezone": "America/Toronto",
  "forms": []
}
```

Phase 1 checks are advisory. Clock-in, clock-out, starting work, and completing work continue even when `forms` is non-empty. The mobile app should surface the missing Forms without turning them into a workflow blocker.

## Submit a Form

```http
POST /api/employee?action=submit
Content-Type: application/json
```

```json
{
  "formId": "form-id",
  "trigger": "daily",
  "jobId": "job-id",
  "equipmentId": "equipment-id",
  "divisionId": "division-id",
  "responses": [
    { "fieldId": "field-id", "value": "Completed west trench" }
  ]
}
```

`trigger` must be configured on the active Form. Context IDs are optional unless needed by the Form assignment or trigger. A job must be directly assigned to the employee or assigned to one of their active crews. Equipment must be assigned through the supplied authorized job. Division must agree with the job context.

The server validates all answers, creates the submission and responses in one DynamoDB transaction, and returns `201`:

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
    "responsesCreated": 1
  }
}
```

Clients may send `{ "data": { ... } }` around the request body for compatibility. A submission may contain at most 99 answer-bearing responses. Required and recurring submissions use deterministic IDs to protect against retries; on-demand submissions receive a new ID.

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

Each field package includes `id`, `type`, `label`, `helpText`, `required`, `defaultValue`, `placeholder`, `options`, and `order`. Selector fields also include authorized `choices` as `{ "value", "label" }` objects.

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
| `signature` | Phase 1 text acknowledgement | String, maximum 500 characters |
| `employee_selector`, `job_selector`, `customer_selector` | Authorized choices | One exact `choices[].value` ID |
| `photo_upload`, `file_upload` | Render as unavailable in Phase 1 | Do not submit an answer |

Optional blank answers may be omitted. Duplicate field IDs, fields from another Form, display-field answers, and values outside server-provided options are rejected.

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

## Recurring periods

Timestamps are stored in UTC. Period keys are calculated in the configured IANA business timezone. Existing businesses without a timezone use `America/Toronto`.

- Daily: local calendar date, for example `2026-03-20`.
- Weekly: Monday-start local business week, represented by its Monday date.
- Monthly: local calendar month, for example `2026-03`.
- Job start/completion: completion is scoped to the authorized job context.

A `submitted` or `approved` submission satisfies a required instance. A `draft` or `rejected` submission does not.

## Errors and retry behavior

Errors use `{ "ok": false, "error": "..." }`; field validation may also include `fieldId`.

| Status | Meaning |
| --- | --- |
| `400` | Invalid trigger, answer, field, option, date/time, or request shape |
| `401` | Missing, invalid, or expired session |
| `403` | Context unavailable or Form not assigned to this employee |
| `404` | Active employee profile, Form, or owned submission not found |
| `409` | Inactive Form, completed recurring instance, or retry conflict |
| `405` | Unsupported HTTP method |

After a `409`, refresh `action=forms` before offering another attempt. Network failures can be retried with the same payload; recurring deterministic IDs prevent duplicate completion records.

## Web review

Owner, admin, and foreman users review submissions in the existing Forms → Submissions screen. Its status-only endpoint is:

```http
PATCH /api/forms-review?id=<submission-id>
Content-Type: application/json

{ "status": "approved" }
```

Only `submitted → approved|rejected` is allowed. The endpoint derives the tenant from the reviewer session and cannot mutate submission ownership, context, answers, or timestamps.