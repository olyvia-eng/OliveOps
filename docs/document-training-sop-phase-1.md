# Document Training and SOP Phase 1

Phase 1 adds PDF-backed content alongside the existing OliveOps builders. New records explicitly use `contentMode: structured | document`; records without this field remain structured for backward compatibility.

## Product behavior

- New Training and SOP flows offer **Build in OliveOps** or **Upload a PDF**.
- Document Training keeps assignment, recurrence, due dates, optional completion checks, acknowledgement, immutable versions, and completion history.
- Document SOPs remain read-only reference material and have no assignment or completion behavior.
- Primary documents accept PDF only, up to 25 MB. Word files must be exported to PDF before upload.
- Existing supplemental attachment behavior is unchanged.

## Storage and authorization

The browser uploads directly to S3 through the existing prepare/upload/complete flow. Completion verifies the authoritative object size and content type, `%PDF-` at byte zero, and `%%EOF` within the final 2048 bytes. The FILE record is the source of truth for document metadata.

Published versions snapshot document metadata. Training completions snapshot the exact completed document/version metadata. Employee download authorization resolves the assigned or completed immutable Training version; SOP access resolves an active published SOP version. Signed URLs remain short-lived and are never stored.

## Mobile viewer

The mobile app uses `react-native-pdf` with `react-native-blob-util` for native iOS and Android rendering, vertical scrolling, pinch zoom, page position, loading/error states, retry, and an external-open fallback.

These packages contain native code. Expo Go cannot run this viewer. A new development/native build is required before device verification and release. Phase 1 deliberately does not create an EAS build or native binary.

## Deferred

DOC/DOCX conversion, LibreOffice, third-party document viewers, queues, container conversion services, migration scripts, and deployment are outside this phase.