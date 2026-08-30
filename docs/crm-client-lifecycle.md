# CRM Client Lifecycle

Customer records use two canonical statuses: `lead` and `client`. New records and status updates accept only these values.

Legacy values are normalized when records are read:

- `prospect` becomes `lead`.
- `active` becomes `client`.
- `inactive` remains a compatibility state displayed as **Status needs review**. It is not a normal filter or form option, and editing the record requires choosing Lead or Client.

No migration rewrites stored customer records. Customer selection in Estimates, Jobs, Forms, calendar integrations, and QuickBooks remains based on tenant-owned customer identity rather than CRM status.

## Original Lead Source

Optional acquisition attribution is stored independently of lifecycle status:

```text
leadSource?: referral | google_search | website | facebook | instagram | existing_customer | sign_truck | trade_show_event | other
leadSourceOther?: string
```

`leadSourceOther` is trimmed and limited to 120 characters when `leadSource` is `other`. Choosing any other source clears custom-source text. Changing a customer from Lead to Client does not alter either attribution field. Stable source keys can be grouped directly by future reporting without parsing notes or display labels.