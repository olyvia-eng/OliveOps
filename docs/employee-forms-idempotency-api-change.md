# Employee Forms submission idempotency extension

The mobile client sends a stable `clientSubmissionId` for each logical Form submission. It reuses that value for every retry until the submission succeeds or the employee starts a separate submission.

The employee Forms API must add this backward-compatible behavior before on-demand submission retries are production-safe:

1. Accept an optional non-empty `clientSubmissionId` on `POST /api/employee?action=submit`. Limit and validate it as an opaque string. Mobile sends it at the request-body top level beside `formId`.
2. Scope uniqueness by the authenticated `businessId` and `employeeId`, never by the client value alone. Do not accept tenant or employee scope from the request body.
3. In the same DynamoDB transaction that creates the submission and responses, conditionally claim `(businessId, employeeId, clientSubmissionId)`. Two concurrent requests with the same scoped key must not create two submissions.
4. Store a canonical payload fingerprint with the claim. A replay with the same key and equivalent payload returns the original successful submission. Reusing a key with a different form, trigger, context, or responses returns `409` and creates nothing.
5. Echo `clientSubmissionId` in the `201` submission object and in completed submission summaries/details returned by `action=forms` and `action=submission`.
6. Apply this to on-demand Forms as well as recurring Forms. Existing deterministic recurring submission IDs remain valid defense in depth.

Suggested replay response: return `200` with `{ "ok": true, "replayed": true, "submission": <original> }`. The mobile client already treats any successful response as success.

During rollout, requests without `clientSubmissionId` may retain existing behavior for older clients. Once the supported mobile version is deployed, the server should require the field for new submissions.

Required server regressions:

- Concurrent same-key requests create exactly one submission and one response set.
- A success followed by a retry with the same key returns the original submission.
- The same key is independent across businesses and employees.
- The same scoped key with a changed payload returns `409` without mutation.
- Different keys create separate legitimate on-demand submissions.

## Implemented retention decision

The claim is retained for 30 days using the repository-standard numeric DynamoDB `ttl` attribute, with `expiresAt` stored for inspection. TTL applies only to the idempotency claim; the original Form submission and responses follow their normal retention policy. The claim stores a SHA-256 payload fingerprint and the safe submission response needed for replay, not raw answers.

Because the claim, submission header, and responses share one DynamoDB transaction, keyed submissions support up to 98 answer-bearing responses. Legacy requests without `clientSubmissionId` retain the existing 99-response limit during rollout.