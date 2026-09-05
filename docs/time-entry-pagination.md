# Time Entry pagination

## Access pattern

Time Entry primary keys remain unchanged:

- `PK = BUSINESS#{businessId}`
- `SK = TIME#{entryId}`

Pagination queries the authenticated tenant partition with `PK = BUSINESS#{businessId}` and `begins_with(SK, TIME#)`. The repository follows DynamoDB's `LastEvaluatedKey` until all matching partition pages are read, then applies corrections and filters and orders entries active-first, newest Clock In, newest Created At, and ascending ID. It never uses `Scan` and does not depend on optional index attributes, so historical Time Entries participate without a backfill.

The API cursor contains a signed logical order key rather than a DynamoDB index key. Job, Employee, Work Area, activity, status, date, and zero-duration predicates are evaluated before the requested page is selected. Job membership supports both `jobIds` and legacy `jobId`.

## API

`GET /api/time-entries`

- `surface=reports`: Owner/Admin; default 25; allowed 25, 50, 100.
- `surface=job&jobId=...`: users with access to that Job; default 10; allowed 10, 25, 50.
- Filters: `startDate`, `endDate`, `employeeSearch`, `jobId`, `workAreaId`, `workType`, `unbillableCategoryId`, `status`, `includeZero`.
- Response: `{ ok, items, hasMore, nextCursor }`.
- `nextCursor` is HMAC-signed with `JWT_SECRET` and bound to API version, surface, authenticated business, Job, resolved employee IDs, and all filters. Raw DynamoDB keys are not exposed as usable URL state.
- `includeZero` defaults to true.

Clients retain a local cursor stack for Previous navigation. Changing any filter or page size resets that stack. Rows remain visible during loading and recoverable errors, and request sequencing plus abort signals prevent stale responses and duplicate in-flight requests from winning.

`GET /api/time-entries?surface=reports&action=export` returns a server-generated Bookkeeper CSV over every matching page. It ignores UI cursors, is Owner/Admin-only, and rejects exports above 10,000 matching entries or 5 MB rather than returning partial data.

## Rollout

No index creation, data backfill, migration, or production-data change is required. Run the verification suite before deploying the API/web changes.