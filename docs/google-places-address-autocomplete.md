# Google Places address autocomplete

OliveOps can suggest Canadian property addresses in the CRM customer form. A selected suggestion fills the existing Street, City, Province, Postal Code, and Country fields. Those fields remain manually editable, and OliveOps continues to store its existing structured address strings as the canonical data.

Autocomplete is optional. If the API key is absent, blocked, over quota, or unavailable, users can enter and save addresses manually.

## Google Cloud setup

1. Select or create a billing-enabled Google Cloud project.
2. Enable **Maps JavaScript API** and **Places API (New)** for the project.
3. Create an API key under **APIs & Services -> Credentials**.
4. Set the key's application restriction to **Websites (HTTP referrers)**.
5. Add the OliveOps production, preview, and local origins that should use autocomplete. For local Vite development, include `http://localhost:5174/*`.
6. Restrict the key to **Maps JavaScript API** and **Places API (New)**.

The key is loaded by browser code and is therefore visible to users. HTTP-referrer and API restrictions are required; do not treat the key as a server secret or reuse an unrestricted key.

## Environment variable

Set this variable for each Vercel environment where autocomplete should be available, then redeploy:

```text
VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
```

For local development, put the variable in `.env.local` and restart Vite. Do not commit `.env.local` or a real key.

## Behavior and billing

- Suggestions begin after three characters and are restricted to Canada.
- Requests are debounced and grouped with a Google autocomplete session token.
- Place details are requested only when a user selects a suggestion.
- OliveOps requests only address components and does not store Google Place IDs or coordinates.
- Google usage, quotas, and billing are managed in the configured Cloud project.
