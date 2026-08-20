# Offline Clocking API Change

## Scope

This change adds backend support for replaying employee clocking events captured offline. It does not implement a mobile queue.

The authenticated clocking endpoint accepts an optional `clientOccurredAt` on:

- `clock-in`
- `switch-activity`, including job, drive-time, and unbillable transitions
- `clock-out`

Existing callers may omit the field and retain server-time behavior.

## Request contract

`clientOccurredAt` must be an absolute ISO-8601 timestamp containing either `Z` or a numeric UTC offset. The backend normalizes accepted values to UTC with `Date.prototype.toISOString()`.

Accepted examples:

```json
{"clientOccurredAt":"2026-08-19T14:30:00Z"}
{"clientOccurredAt":"2026-08-19T10:30:00-04:00"}
```

Rejected examples include local timestamps without an offset, date-only values, malformed timestamps, and non-string values.

Every replayed mutation must use the normal request identity and idempotency fields. A client must keep the same idempotency key and unchanged logical payload, including `clientOccurredAt`, for every retry of one event.

## Time semantics

The backend captures two different instants:

- `eventOccurredAt`: the validated `clientOccurredAt`, or server receipt time when the field is omitted. This controls the work timeline.
- `serverReceivedAt`: when the API received the request. This is audit metadata and does not move a delayed event on the timeline.

An offline event is accepted when it is no more than 24 hours before server receipt and no more than 5 minutes after server receipt. The exact bounds are accepted. Bounds are evaluated as absolute instants, independent of business timezone and daylight-saving transitions.

Clock-in and clock-out boundaries, segment duration, chronological ordering, bootstrap history, and business-date grouping all use event time. Business timezone is used only when an absolute instant is grouped or displayed as a local date.

## Validation and authorization

`clientOccurredAt` is untrusted input. A request must still pass all existing checks for:

- authenticated employee identity and tenant isolation
- time-entry ownership
- active-shift state and exact active-entry pointer
- chronological event ordering
- job visibility and employee job authorization
- active unbillable category rules
- drive-time and other existing clocking rules
- idempotency-key ownership and payload equality

Delayed timestamps never grant access to a hidden job, another employee's entry, another business, or an invalid shift state.

## Idempotency

The normalized event timestamp participates in the idempotency fingerprint. Retrying the same key with the same logical payload returns the original committed response and does not create another timeline segment. Reusing the key with a changed timestamp, action, job, work type, or other fingerprinted field returns `clock_idempotency_conflict`.

Replay lookup occurs before receipt-relative age and current shift-state validation, after required ownership and authorization checks. This allows a successful event to be retried after the 24-hour window without changing the result. After a transaction error, the API rechecks the idempotency record so a committed request whose first response was lost can still return its original response.

## Response and conflict codes

Successful responses retain the existing clocking response shape. Mobile clients should use the stable `code` field, not parse error text.

| Code | HTTP | Meaning | Mobile disposition |
| --- | ---: | --- | --- |
| `offline_event_invalid_timestamp` | 400 | Timestamp is malformed, non-absolute, or not a string | `needs_attention` |
| `offline_event_too_old` | 409 | Event is more than 24 hours before receipt | `needs_attention`; offer Time Correction |
| `offline_event_in_future` | 409 | Event is more than 5 minutes after receipt | Retry only after correcting device time; otherwise `needs_attention` |
| `offline_event_order_conflict` | 409 | Event would overlap or precede the current employee timeline boundary | `needs_attention`; offer Time Correction |
| `offline_shift_state_conflict` | 409 | Active-shift state no longer matches the queued action | Refresh state, then `needs_attention`; do not rewrite the queued event silently |
| `clock_idempotency_conflict` | 409 | Idempotency key was reused with a different logical payload | `needs_attention`; never generate a replacement key automatically |
| `offline_job_unauthorized` | 403 | Employee cannot use the requested job | `needs_attention` |

Transport failures, timeouts, and retryable server errors may be retried with the identical idempotency key and payload. Validation, authorization, ordering, and idempotency conflicts must not be retried in a loop.

## Persisted audit metadata

Time entries preserve timeline fields and separate receipt metadata:

- `clockIn` and `clockOut`: event-time boundaries
- `clockInServerReceivedAt` and `clockOutServerReceivedAt`: API receipt instants
- `clockInTimestampSource` and `clockOutTimestampSource`: `client` or `server`

Active-shift records keep the exact active-entry start instant. Idempotency and audit records also retain event time, receipt time, timestamp source, operation source, and opaque employee/entry identifiers. They do not replace normal authorization or tenant scoping.

## Bootstrap and history

Bootstrap and time-entry history return `clockIn` and `clockOut` using the original event instants. Receipt metadata is exposed separately. Delayed events around local midnight therefore appear on the business date of the work event, not the date on which connectivity returned.

## Time Correction fallback

Offline replay is limited to 24 hours and cannot repair a conflicting timeline automatically. Mobile should route too-old, ordering-conflict, and unresolved shift-state cases to the existing Time Correction workflow. The independent employee correction limit remains 14 days and is not weakened by this API change.
