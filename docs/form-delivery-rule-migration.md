# Form delivery-rule migration

This one-time utility normalizes legacy Form delivery settings for one business. It is dry-run by default and never scans the table.

## Safety behavior

- Requires an explicit business ID and queries only `BUSINESS#<businessId>` records whose sort key starts with `FORM#`.
- Writes only unambiguous legacy mappings accepted by the shared delivery-rule validator.
- Sets `deliveryRule`, `deliveryRuleVersion`, `trigger`, `completionRequirement`, and a migration `updatedAt`; all other Form attributes remain untouched.
- Leaves valid normalized Forms unchanged, even if their compatibility fields differ.
- Leaves ambiguous or unsupported legacy Forms unchanged and reports them as `needs-review`.
- Leaves invalid normalized Forms unchanged and reports them as `error`.
- Uses the read `updatedAt` value, or its absence, plus the absence of `deliveryRule` as write conditions. A concurrent edit is reported as `conflict` and is not overwritten.
- Can be restarted. A successful record is `unchanged` on later runs.

## Runbook

Set the existing DynamoDB environment variables for the intended non-production environment, then preview one tenant:

```bash
npm run migrate:form-delivery-rules -- --business-id <businessId>
```

Review `would-migrate`, `needs-review`, `error`, and per-Form details. Resolve or document every review/error item before applying.

Apply only after confirming the environment and business ID:

```bash
npm run migrate:form-delivery-rules -- --business-id <businessId> --apply
```

Re-run without `--apply`. A completed migration should report no `would-migrate` records. Investigate any `conflict` by reviewing that Form's current admin configuration, then run the dry-run again.

Do not use `--apply` against production without the normal operational approval and backup process. This implementation task does not execute an apply run.