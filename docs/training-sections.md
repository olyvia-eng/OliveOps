# Training Sections contract

Structured OliveOps Training is authored and consumed as ordered sections. SOP authoring remains a separate rich-text document model. PDF-backed Training remains available through `contentMode: "document"` and the existing private document flow.

## Data shape

Definitions, published versions, and new completion snapshots expose:

```ts
interface TrainingSection {
  sectionId: string;
  title: string;
  description: string;
  sortOrder: number;
  checklistItems: Array<{
    itemId: string;
    text: string;
    required: true;
    sortOrder: number;
  }>;
}

interface TrainingContent {
  trainingSections: TrainingSection[];
  checklist: TrainingChecklistItem[]; // compatibility projection only
}
```

`trainingSections` is authoritative. The top-level `checklist` is flattened in section/item order for existing clients and is not a second authoring model.

The server trims titles and item text, preserves normalized line breaks in descriptions, removes blank checklist items, requires at least one titled section for structured Training, permits informational sections with no checklist, and rejects duplicate section or item IDs.

## Version and completion behavior

Publishing copies the complete section structure into an immutable `TRAINING_VERSION`, including all IDs, text, descriptions, and order values. Assignments continue referencing `assignedVersion`.

Completion validates every flattened item ID from the assigned immutable version. A submission is rejected unless it contains each item exactly once with `checked: true`. The final acknowledgement remains independently required. New `TRAINING_COMPLETION` records snapshot both `trainingSections` and the existing flat checked `checklistItems`, so historical display and older clients remain supported.

## Legacy records

No destructive migration is performed. A definition/version without `trainingSections` is normalized on read into:

```ts
{
  sectionId: "legacy-training-section",
  title: "Training Checklist",
  description: instructions ?? employeeInstructions ?? "",
  sortOrder: 0,
  checklistItems: checklist
}
```

Historical completion records are not rewritten. Records with only `checklistItems` continue rendering through the existing flat completion-history fallback.

The short-lived Training rich-text implementation was removed because it had not been released as a persisted production contract. SOP `richTextContent` is unchanged.

## API responses

No endpoint names changed:

- `GET /api/training?action=detail` returns normalized sections on the definition and each version.
- `GET /api/training?action=my-detail&assignmentId=...` returns the assigned immutable version with `trainingSections` and compatibility `checklist`.
- `POST /api/training?action=complete` accepts `checklistResponses: [{ itemId, checked }]`, `acknowledged`, and `signatureName`; IDs span every section.
- `GET /api/training?action=my-history` returns `trainingSections` on new completions and legacy `checklistItems` on all completions.

All repository access remains scoped by the authenticated `businessId`; employee detail also verifies assignment ownership.

## OliveOps-mobile behavior

The mobile Training detail reads `version.trainingSections` in `sortOrder` order and renders every section heading and description. Checklist controls render only for items present in that section, so informational sections remain visible without adding a completion requirement.

Completion also requires the employee to type the canonical full name shown on the linked employee profile. The API validates that name against the authenticated employee and stores `employeeName`, `signatureName`, `signedAt`, and `acknowledgementVersion` on new immutable completion records. `signedAt` and `completedAt` are the same server-authoritative timestamp. These fields remain optional on reads so historical unsigned completions continue to work without migration.
   - Keep one checked-state map keyed by `itemId` across all sections.
   - Compute `allChecked` across every nested item.
   - Keep acknowledgement disabled as a completion path until all nested items are checked; the server remains authoritative.
   - Submit the same flattened `checklistResponses` request currently used by the screen.
   - Fall back to the current `version.instructions` plus flat `version.checklist` rendering if `trainingSections` is absent.
   - Keep `AuthorizedPdfViewer`, attachment access, offline behavior, idempotency, and stale-assignment handling unchanged.

3. `tests/app/training-detail.screen.test.tsx`
   - Add multiple-section fixtures and verify section/item order.
   - Verify items stay under the correct heading.
   - Verify acknowledgement-only completion for informational sections.
   - Verify completion remains disabled until every item across all sections and the acknowledgement are checked.
   - Retain a legacy flat-checklist fixture and the existing PDF tests.

The mobile `loadMyTrainingDetail` endpoint and completion request shape do not change, so this is a type/rendering update rather than a navigation or networking rewrite.
