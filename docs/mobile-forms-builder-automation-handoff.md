# Mobile Forms automation handoff

The web Forms builder now stores clearer automation and completion intent. The employee API exposes that configuration, but workflow enforcement remains advisory. Mobile should consume the contract below without treating it as proof that an employee action may be blocked.

## Contract changes

Each instance returned by `GET /api/employee?action=forms` includes:

```json
{
  "trigger": "after_leaving_job",
  "required": true,
  "completionRequirement": "required",
  "enforcement": "advisory"
}
```

- `required` is the legacy trigger-derived flag and is `false` only for `on_demand`.
- `completionRequirement` is `reminder` or `required`. Missing legacy values normalize to `reminder`.
- `enforcement` is currently `advisory`. Mobile must not block clocking or job transitions based on these values.

## Trigger values

| Trigger | Intended mobile event |
| --- | --- |
| `before_clock_in` | Before clock-in |
| `after_clock_out` | After clock-out |
| `before_starting_job` | Before starting a job |
| `after_leaving_job` | After leaving a job site or ending work on that job |
| `job_completed` | When the job itself is marked complete |
| `after_completing_job` | Legacy value; preserve and query it independently |
| `daily`, `weekly`, `monthly` | Timezone-aware recurring workspace items |
| `on_demand` | Employee-opened form in Available |

Do not map `after_completing_job` to either new job event. All three job-ending triggers have distinct completion scopes, so submitting one does not satisfy another.

## Mobile work still required

1. Query `action=required` with `after_leaving_job` after a successful leave-job transition and present matching Forms.
2. Query it with `job_completed` after a successful job-complete transition and present matching Forms.
3. Keep querying legacy `after_completing_job` wherever the existing client currently emits that event.
4. Display `required` completion intent more strongly than `reminder`, but respect `enforcement: advisory` and always allow the underlying workflow to continue.
5. Refresh `action=forms` after successful submission so recurring and context instances reconcile with server state.
6. Continue sending authorized `jobId`, `equipmentId`, and `divisionId` context when required by assignment or trigger.
7. Generate one stable `clientSubmissionId` per logical submission and reuse it unchanged for retries.

The server accepts the new trigger values and preserves them through save/reload. It does not currently emit job lifecycle events, intercept workflow transitions, or provide authoritative required-form blocking. Those capabilities need a separate integration owned by the job and clocking APIs.