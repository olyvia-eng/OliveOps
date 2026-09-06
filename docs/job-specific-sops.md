# Job-specific SOPs

## Purpose

Job-specific SOPs are references from a Job to procedures in the company SOP library. The association never copies SOP content and never pins a version. Every read resolves the SOP definition's current active published version, so publishing a new version updates every associated Job automatically.

## Storage model

Each association writes two deterministic records in the business partition:

```text
PK = BUSINESS#<businessId>
SK = JOB_SOP#<jobId>#<sopId>

PK = BUSINESS#<businessId>
SK = SOP_JOB#<sopId>#<jobId>
```

Both records contain `businessId`, `jobId`, `sopId`, `addedAt`, and `addedBy`. They are created and removed in one DynamoDB transaction. The forward record supports listing and cleaning links for one Job. The reverse record supports cleaning links when an SOP is permanently deleted. Neither operation scans the table.

Removing an association deletes only these link records. Job deletion removes all links with the Job prefix. SOP deletion removes all links with the SOP reverse prefix before deleting the SOP definition.

## API

`/api/job-sops` derives the tenant from the authenticated session.

- `GET ?jobId=<id>` lists current active published SOP versions associated with an authorized Job.
- `GET ?jobId=<id>&action=detail&sopId=<id>` returns one associated current version for the shared read-only viewer.
- `GET ?jobId=<id>&action=available` lists active published SOPs for the add dialog. Owner, admin, or foreman access is required.
- `POST ?jobId=<id>` with `{ "sopIds": ["..."] }` adds one or more associations. Owner, admin, or foreman access is required.
- `DELETE ?jobId=<id>&sopId=<id>` removes one association. Owner, admin, or foreman access is required.

All operations first load the Job from the session business and call the existing Job record authorization. Unauthorized and cross-tenant Jobs return `404`. Employees assigned directly or through the Job crew may list and view, but cannot search available SOPs or mutate links. Draft, archived, deleted, or versionless SOPs are rejected for add and omitted from reads.

PDFs and attachments continue through `/api/storage`. That endpoint applies normal SOP authorization and verifies that the requested file belongs to the current published version.

## Web UI

The Project Management tab displays **SOPs for this Job** after Job Tasks and before Notes. Managers can search published SOPs, select several, add them, and unlink them. All authorized Job viewers can open a linked SOP at `/jobs/:id/sops/:sopId`. That route reuses `SopDetailPage` in read-only Job context and does not expose editing or version history.

## OliveOps-mobile handoff

The mobile repository currently has no Job detail screen. Assigned Jobs are rendered as non-interactive `ListRow` entries in `app/home.tsx`. It already has `app/sop-detail.tsx`, `src/api/sopApi.ts`, and `src/types/sop.ts` for bearer-authenticated SOP rendering and PDF downloads.

Implement the mobile surface in these steps:

1. Add `jobSops: '/api/job-sops'` to `src/api/endpoints.ts`.
2. Add `src/api/jobSopApi.ts` with list and detail calls. Pass the access token through `apiRequest`, and URL-encode `jobId` and `sopId`.
3. Add a `JobSop` type that extends the current `SopVersion` shape with optional association metadata.
4. Add `app/job-detail.tsx`, register it in `app/_layout.tsx`, and make assigned Job rows in `app/home.tsx` navigate with `jobId`.
5. In Job detail, load `GET /api/job-sops?jobId=<id>` and render a read-only **SOPs for this Job** section. Show title, category, current version, and the same empty-state wording as web. Do not add association mutation controls to the employee app.
6. Open the existing SOP detail renderer with both `jobId` and `sopId`. Update `app/sop-detail.tsx` to use the Job-scoped detail endpoint when `jobId` is present and retain `loadMySop` for SOP Library navigation.
7. Preserve the existing `AuthorizedPdfViewer` and storage preparation flow. Structured SOP rendering should consume `richTextContent` when the mobile rich-text renderer is available; the current mobile viewer still renders the legacy `purpose`, `instructions`, and `safetyInformation` projection.
8. Add mobile API tests for bearer headers, URL encoding, server errors, and Job-scoped detail. Add screen tests for assigned-Job navigation, loading/error/empty/list states, and read-only behavior.

The mobile client must not infer authorization from its cached Job list. The API remains authoritative for Job assignment, crew membership, tenant isolation, association membership, and current SOP visibility.