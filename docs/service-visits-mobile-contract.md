# Service Visits Mobile Contract

This document describes the Phase 4A web/backend contract available to a future OliveOps-mobile release. Service work remains Job Work: clients MUST send `workType: "job"`; there is no `service` Time Entry work type.

## 1. Authentication

Send the existing Bearer mobile token. All records are tenant-scoped from the authenticated session. The server never accepts a client-supplied business ID.

## 2. Roles

`owner`, `admin`, `foreman`, and `crew_member` may use employee Visit detail, notes, completion, and clocking when authorized. Schedule generation, rescheduling, and Service administration remain management operations.

## 3. Employee Visibility

A crew member can access a Visit when their employee ID is in `assignedEmployeeIds`, or when they lead/belong to the Visit's active crew. Management roles retain operational visibility. The server validates this on every detail, note, completion, upload, and clocking request.

## 4. Bootstrap Window

`GET /api/bootstrap` adds:

```json
{
  "serviceVisitHorizonDays": 7,
  "todayServiceVisits": [],
  "upcomingServiceVisits": [],
  "activeTimeEntry": null
}
```

Today is calculated in the business timezone. Upcoming Visits end seven business dates after today. The backend queries the tenant partition, filters to the bounded schedule window, and paginates through all matching records; clients do not depend on a secondary index.

## 5. Visit Summary

Employee Visit summaries contain Visit, Job, Service, customer/property, address, schedule, `assignedEmployeeIds`, `assignedEquipmentIds`, status, billing type, `hasRequiredForms`, and `hasSops` fields. `crewId` remains available for compatibility. When that ID resolves to a Crew in the authenticated tenant, the summary also contains `crew: { "id": "crew-1", "name": "North Crew" }`. It does not contain wages, labour rates, margin, profit, or internal pricing.

## 6. Active Clock Bootstrap

When `activeTimeEntry.serviceVisitId` is present, bootstrap also returns its canonical `jobName`, `serviceName`, and `propertyName`. Clients should restore the running timer from this object rather than create a second timer.

## 7. Visit Detail

`GET /api/service-visits?action=detail&jobId={jobId}&visitId={visitId}` returns:

```json
{
  "ok": true,
  "visit": {},
  "job": { "id": "job-1", "title": "Property service" },
  "service": { "id": "service-1", "name": "Weekly mowing", "description": "Mow, trim, and clear hard surfaces.", "billingType": "per_visit" },
  "crew": { "id": "crew-1", "name": "North Crew" },
  "timeEntries": [],
  "forms": [],
  "formSubmissions": [],
  "photos": [],
  "sops": [
    {
      "sopId": "sop-1",
      "version": 3,
      "title": "Mower startup and shutdown",
      "category": "Equipment",
      "shortDescription": "Daily operating procedure.",
      "contentMode": "structured"
    }
  ],
  "completion": {},
  "analysis": {}
}
```

`service.description` and `crew` are optional. `crew` is omitted when no tenant Crew resolves. SOP associations resolve to the exact current version only when the canonical definition is active and published; draft, archived, deleted, foreign-tenant, and missing-version records are omitted. Use `sopId` with `GET /api/sops?action=my-detail&sopId={sopId}` to load the renderable current snapshot, and verify the returned `version` matches the summary. `analysis` and Time Entry cost snapshots are management-only. Crew detail omits them.

## 8. Canonical Identity

The tuple is `jobId`, `serviceId`, `serviceVisitId`. The backend loads all three and verifies that the Service belongs to the Service Job and the Visit belongs to both. IDs cannot be mixed across Jobs, Services, tenants, or assignments.

## 9. Clock In

Use the existing `POST /api/clocking?action=clock-in` payload and add both Service IDs:

```json
{
  "workType": "job",
  "jobIds": ["job-1"],
  "serviceId": "service-1",
  "serviceVisitId": "visit-1",
  "idempotencyKey": "clock-in-device-123"
}
```

Do not send `workAreaId` for a Service Job. Project Job clocking continues to use Work Areas unchanged.

## 10. Visit Work Start

The first successful Visit clock-in atomically changes `scheduled` to `in_progress` and records `service_visit.work_started`. Employees may clock into a Visit already in progress. Clock-in is rejected for completed, skipped, or cancelled Visits.

## 11. Clock In Response

The canonical Time Entry includes optional `serviceId` and `serviceVisitId`. These fields are present only for Service Visit Job Work.

## 12. Before-Clock-In Forms

When Required before-clock-in Forms apply, clock-in returns HTTP `202` with the existing pending workflow. `clockInIntent` and every Visit-scoped requirement preserve `jobId`, `serviceId`, and `serviceVisitId`. Finalization revalidates the exact stored tuple.

## 13. Form Submission

Use the existing `POST /api/employee?action=submit`. For a Visit Form include:

```json
{
  "formId": "form-1",
  "trigger": "before_clock_in",
  "jobId": "job-1",
  "serviceId": "service-1",
  "serviceVisitId": "visit-1",
  "workflowOccurrenceId": "clock-in-...",
  "workflowRequirementId": "requirement-...",
  "clientSubmissionId": "form-device-123",
  "responses": []
}
```

Workflow context, completion scope, deterministic IDs, payload fingerprints, and persisted submissions include both Service IDs.

## 14. Clock-In Finalization

After the last blocking Form is submitted, the existing mandatory workflow finalizer creates the Time Entry with the persisted Visit identity. A client cannot redirect finalization by changing IDs in the Form payload.

## 15. Switch Activity

Use `POST /api/clocking?action=switch-activity`. Switching to another Visit sends that Visit's canonical tuple. Switching to Drive Time or Non-Billable omits and clears `serviceId` and `serviceVisitId`.

## 16. Clock Out

Use the existing `POST /api/clocking?action=clock-out`. The server closes the active Time Entry, which already owns the Visit identity. Clock-out never completes the Visit.

## 17. After-Clock-Out Forms

Required after-clock-out workflows inherit `serviceId` and `serviceVisitId` from the closed Time Entry. The same immutable workflow context and idempotent submission rules apply.

## 18. Visit Notes

`POST /api/service-visits?action=add-note&jobId={jobId}&visitId={visitId}`:

```json
{
  "serviceId": "service-1",
  "visitId": "visit-1",
  "clientSubmissionId": "note-device-123",
  "text": "Gate code confirmed with customer."
}
```

A successful create returns HTTP `201`. Replaying the same client ID returns HTTP `200` with `replayed: true`. Notes are Visit-wide and include author and server timestamp. Audit action: `service_visit.note_added`.

Note requests may return `NOTE_REQUIRED`, `INVALID_CLIENT_SUBMISSION_ID`, `VISIT_NOT_FOUND`, `VISIT_NOT_ASSIGNED`, or `VISIT_REVISION_CONFLICT`.

## 19. Visit Photos

Use the existing storage prepare/complete flow with `entityType: "service-visit"`, `category: "photo"`, `entityId` equal to the Visit ID, plus canonical `jobId` and `serviceId`. Existing file validation, tenant keys, MIME/size checks, checksum or ETag completion, and download authorization remain authoritative.

## 20. Completion Requirements

Requirements come from `service.completionRequirements` or `service.operationalSchedule.completionRequirements`:

```json
{ "requiredFormIds": ["form-1"], "minimumPhotoCount": 1, "noteRequired": true }
```

Detail returns completed/missing Form IDs, photo count, note count, and active Time Entry count. Completion rechecks all evidence server-side.

## 21. Explicit Completion

`POST /api/service-visits?action=complete&jobId={jobId}&visitId={visitId}`:

```json
{
  "serviceId": "service-1",
  "visitId": "visit-1",
  "clientSubmissionId": "complete-device-123"
}
```

Completion is allowed from `scheduled` or `in_progress`; it sets `completedAt`, `completedByUserId`, billing readiness, and audit action `service_visit.completed`. The legacy status endpoint rejects a request to mark a Visit completed.

That legacy rejection uses `EXPLICIT_VISIT_COMPLETION_REQUIRED`.

## 22. Completion Errors

- `VISIT_HAS_ACTIVE_TIME_ENTRIES`: at least one linked Time Entry is still clocked in.
- `VISIT_REQUIRED_FORMS_OUTSTANDING`: required Visit Form submissions are missing.
- `VISIT_REQUIRED_PHOTOS_OUTSTANDING`: uploaded Visit photos are below the configured minimum.
- `VISIT_REQUIRED_NOTE_OUTSTANDING`: no Visit note exists.
- `VISIT_STATUS_INVALID`: the Visit is completed, skipped, cancelled, or otherwise not completable.
- `VISIT_NOT_ASSIGNED`: the employee is not assigned to the Visit.
- `VISIT_REVISION_CONFLICT`: another request updated the Visit first; refresh and retry.
- `VISIT_NOT_FOUND`: the Visit does not exist in the authenticated tenant or does not match the supplied Job and Service.
- `INVALID_CLIENT_SUBMISSION_ID`: the completion replay ID is absent or invalid.

Clock-in and switch-activity may additionally return these exact Visit context codes:

- `SERVICE_CONTEXT_INVALID`: Service and Visit identity is incomplete or was supplied for a non-Job activity.
- `SERVICE_JOB_MISMATCH`: Service/Visit identity does not belong to the supplied Job, or Service work was mixed with a Project Work Area.
- `JOB_NOT_FOUND`: the selected Job cannot be loaded during canonical Visit validation.
- `VISIT_NOT_FOUND`: the Visit was not found in the authenticated tenant.
- `VISIT_NOT_ASSIGNED`: the employee is not authorized for the Job or Visit.
- `VISIT_CANCELLED`: the Visit is cancelled.
- `VISIT_ALREADY_COMPLETED`: the Visit is already completed.
- `VISIT_SKIPPED`: the Visit was skipped.
- `VISIT_STATUS_INVALID`: the Visit state does not allow work to begin.

## 23. Completion Replay

The successful `clientSubmissionId` is stored on the Visit. Repeating that ID after completion returns HTTP `200`, the same completed Visit, and `replayed: true`; it does not create another audit event.

## 24. Actual Cost Semantics

Actual labour hours use closed Visit-linked Time Entry duration less breaks. Actual labour cost sums `labourCostTotalSnapshot`; current wage records are never substituted. Equipment, material, and subcontractor actuals count only real cost records carrying the same `serviceVisitId`. Scheduled resources and Estimate lines are never treated as actuals.

Estimated Visit cost comes from the accepted Service pricing snapshot. Contract revenue per Visit is analysis allocation only. A completed per-Visit Service may expose its accepted per-Visit price as billable amount; this does not create an invoice or accounting transaction.

## 25. End-to-End Sequences

Normal: bootstrap -> Visit detail -> clock-in -> work -> clock-out -> add evidence -> explicit completion.

Mandatory Form: clock-in returns `202` -> submit every requirement with the workflow and Visit IDs -> finalizer creates the Visit-linked Time Entry -> clock-out may create an after-clock-out workflow -> submit it -> explicitly complete.

Offline replay: retain each operation's stable idempotency key/client submission ID -> replay the same payload until acknowledged -> treat a conflict for the same key with different payload as a client data error -> refresh bootstrap/detail after success. Never synthesize a second timer or infer completion locally.