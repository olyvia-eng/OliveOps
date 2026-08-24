# Time Off Requests API (Web/Backend Phase 1)

Time Off Requests are canonical business records. Employee identity is always resolved from the authenticated cookie or mobile bearer session and its active linked Employee record. Clients cannot select `businessId`, `employeeId`, initial status, or review metadata.

## Entity and keys

Request item:

- `PK = BUSINESS#{businessId}`
- `SK = TIME_OFF_REQUEST#{requestId}`
- `entityType = TIME_OFF_REQUEST`

Durable create idempotency item:

- `PK = BUSINESS#{businessId}`
- `SK = TIME_OFF_IDEMPOTENCY#{sha256(employeeId + "\\0" + idempotencyKey)}`
- Stores `requestId`, request payload fingerprint, and a 30-day DynamoDB TTL.

Creation writes the request, idempotency record, and audit event in one transaction. Review and cancellation transactionally require `status = pending` and write an audit event. Request items retain their full history after the idempotency marker expires.

Company and future scheduling queries use the business partition and `TIME_OFF_REQUEST#` sort-key prefix. `listApprovedTimeOffOverlappingForBusiness(businessId, startDate, endDate)` applies inclusive overlap and excludes pending, denied, and cancelled requests. This avoids a table scan and leaves room for a GSI only if business-level request volume later requires one.

Full-day dates are stored unchanged as `YYYY-MM-DD`. The range is inclusive and is never converted to a UTC-midnight timestamp.

## Employee API

All responses use `{ ok: boolean, ... }` and existing authentication behavior.

### Create my request

`POST /api/time-off-requests?action=create`

```json
{
  "requestType": "vacation",
  "startDate": "2026-08-28",
  "endDate": "2026-08-30",
  "employeeNote": "Family trip",
  "idempotencyKey": "mobile-generated-stable-key"
}
```

Success is `201`; a same-payload replay is `200` with `replayed: true`. Reusing the key with different material content returns `409` and `time_off_idempotency_conflict`. Protected client fields are ignored.

### List my requests

`GET /api/time-off-requests?action=mine`

Returns `items` newest submitted first. Internal reviewer user IDs are omitted.

### Get my request

`GET /api/time-off-requests?action=detail&id={requestId}`

Employees receive only their own request. Cross-employee and missing records use the same safe `404` response.

### Cancel my pending request

`PATCH /api/time-off-requests?action=cancel&id={requestId}`

Only the owning employee may cancel, and only from `pending`. A lost race returns `409` plus the current authoritative request.

## Owner/admin web API

- `GET /api/time-off-requests?action=list`
- `GET /api/time-off-requests?action=detail&id={requestId}`
- `PATCH /api/time-off-requests?action=approve&id={requestId}` with optional `{ "reviewNote": "..." }`
- `PATCH /api/time-off-requests?action=deny&id={requestId}` with optional `{ "reviewNote": "..." }`

Review is owner/admin only. A stale second review returns `409` and the authoritative request. Foreman and crew-member sessions cannot list or review company requests.

## Audit events

The repository writes these events without free-form notes:

- `time_off_request_created`
- `time_off_request_approved`
- `time_off_request_denied`
- `time_off_request_cancelled`

Metadata contains only request ID, employee ID, and status transition.
