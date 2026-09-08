# Snow Operations

Snow Operations is a tenant-scoped workflow layered on existing Service Jobs, Customers, properties, Service Visits, Employees, Equipment, storage, and clocking. It does not create a parallel customer/property model or time clock.

## User workflows

Owners and admins open `/snow-operations` to create and activate a Snow Event, configure service types, staff Routes, add existing Service Jobs as ordered Stops, monitor completion and attention states, and inspect Proof of Service. The same property may be added more than once because each Stop is a distinct operational occurrence. Manual Stop order is canonical; drag/drop and keyboard-friendly move buttons persist that order.

Assigned Foremen and Crew open `/snow-assignment` from the Employee Portal. The server enforces this progression:

1. Start Route.
2. Mark the next Stop En Route, then Arrived.
3. Select a configured service and add a Before photo.
4. Start Service, Finish Service, and add an After photo.
5. Complete the Stop and continue to the next pending Stop.
6. Complete the Route after every Stop is completed or skipped.

Before and After evidence uses the existing private S3 prepare/upload/complete flow. Files are write-once uploads scoped to the Snow occurrence, and every file operation reauthorizes the tenant, Event, Route, Stop, occurrence, and assigned employee. Proof downloads use short-lived authorized URLs.

## API

`/api/snow-operations` is a dedicated endpoint and is intentionally absent from `/api/bootstrap`.

Read actions:

- `events`: owner/admin Event list.
- `service-types`: tenant service types; defaults are seeded only for an owner/admin tenant with none.
- `detail`: Event/Route/Stop dashboard detail. Employees receive only assigned Routes.
- `my-active-route`: current assigned active Event and resumable Route/Stop/occurrence state.
- `proof`: authorized, append-only occurrence, evidence, and breadcrumb records for one Stop.

Admin commands include Event create/update/status, Route create/update/assignments, Stop create/update/reorder/remove, and Service Type create/update/deactivate. Employee commands include `start-route`, `en-route`, `arrival`, `select-service`, `before-photo`, `start-service`, `breadcrumbs`, `finish-service`, `after-photo`, `complete-service`, `skip-stop`, `flag-stop`, and `complete-route`.

Client commands require an 8-128 character `clientSubmissionId`. The state mutation, append-only evidence, and 30-day idempotency claim are committed in one DynamoDB transaction. A successful retry returns the original response and does not duplicate evidence or audit records. Server time is authoritative; valid absolute device timestamps are retained as `deviceCapturedAt`.

## DynamoDB records

All records use `PK = BUSINESS#{businessId}` and require no GSI:

- `SNOW_EVENT#{eventId}`
- `SNOW_ROUTE#{eventId}#{routeId}`
- `SNOW_STOP#{eventId}#{routeId}#{stopId}`
- `SNOW_OCCURRENCE#{eventId}#{routeId}#{stopId}#{occurrenceId}`
- `SNOW_EVIDENCE#{eventId}#{routeId}#{stopId}#{occurrenceId}#{evidenceId}`
- `SNOW_BREADCRUMB#{eventId}#{routeId}#{stopId}#{occurrenceId}#{batchId}`
- `SNOW_SERVICE_TYPE#{serviceTypeId}`
- `SNOW_IDEMPOTENCY#{employeeId}#{key}`

Breadcrumb batches contain at most 100 sequenced points. Evidence and breadcrumb records are append-only. Mutable Event, Route, Stop, occurrence, and Service Type records use revision-checked writes.

## GPS and offline behavior

The web field workflow requests browser geolocation for operational checkpoints. Denial, timeout, unsupported devices, and unavailable positions are stored explicitly; coordinates are never invented. While an occurrence is active and the page is visible, it captures foreground breadcrumb points every 45 seconds. Failed field commands are retained in a browser-local queue and retried on reconnect using their original idempotency keys.

This repository does **not** implement all-day or native background tracking. The separate Expo/React Native client must implement background execution, a durable native queue, permission education, iOS background location modes, Android foreground-service/location permissions, device testing, and app-store disclosures. The native client should call the same command contracts, preserve absolute device timestamps, batch at no more than 100 points, and keep each `clientSubmissionId` stable across retries.

## Navigation and optimization

The field workflow opens Apple Maps on iOS and Google Maps elsewhere using the Stop address. OliveOps does not provide turn-by-turn navigation.

There is no Optimize Route control because no Directions/Routes provider is configured. Adding optimization later requires a selected provider, credentials held server-side, geocoded property coordinates/Place IDs, quotas and failure handling, and an explicit administrator confirmation before replacing the canonical manual order. No production infrastructure or GSI changes are required by the current implementation.
