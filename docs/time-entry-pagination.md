# Time Entry pagination

## Access pattern

Time Entry primary keys remain unchanged:

- `PK = BUSINESS#{businessId}`
- `SK = TIME#{entryId}`

Pagination uses a sparse global secondary index on those same items:

- Index name: `TimeEntryChronologicalIndex` (override with `DDB_TIME_ENTRY_INDEX_NAME`)
- Partition key: `timeEntryIndexPk` (String)
- Sort key: `timeEntryIndexSk` (String)
- Projection: `ALL`

The index partition is `BUSINESS#{businessId}#TIME_ENTRIES`. Its sort key encodes active/completed status, canonical Clock In, Created At, and an inverted ID. Descending DynamoDB queries therefore retain the established active-first, newest-clock-in, newest-created, ascending-ID order. No existing key is modified.

All authoritative create, clock-out, activity-switch, current-shift reconciliation, direct-edit, and generic repository writes maintain these attributes. Deletes remove the indexed item automatically.

Job, Employee, Work Area, activity, status, date, and zero-duration predicates are evaluated on the server while it advances the GSI keyset until a full matching page is assembled. This is correct keyset pagination and never uses `Scan` or an offset. A dedicated Job-membership index should be added if Job-scoped candidate-read cost becomes material at high tenant volumes; Job membership is currently evaluated against both `jobIds` and legacy `jobId` before rows enter a page.

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

1. Back up the DynamoDB table.
2. For each business, preview the additive backfill:
   `npm run migrate:time-entry-pagination -- --business-id <id> --dry-run`
3. Run the same command without `--dry-run`. It uses partition `Query` operations, never `Scan`, and does not alter primary keys or Time Entry values.
4. Create the GSI above and wait until its status is `ACTIVE`. The table's existing billing mode/capacity policy should be retained.
5. Set `DDB_TIME_ENTRY_INDEX_NAME` only when the deployed index uses a non-default name.
6. Run the verification suite and deploy the API/web changes only after every tenant is backfilled and the index is active.

No migration or deployment is performed automatically by this repository change.