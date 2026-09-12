// Resolves QuickBooks/Intuit's OAuth endpoints from Intuit's own OAuth/OpenID Discovery Document
// instead of hard-coding them, so OliveOps picks up an endpoint rotation without a code change.
// See: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-openid-discovery-doc
//
// The discovery URL itself is a fixed, trusted server-side constant - it is never derived from a
// browser/client request. Sandbox and production discovery documents publish identical
// authorization_endpoint/token_endpoint/revocation_endpoint values (only userinfo_endpoint differs,
// which OliveOps does not use), so a single discovery URL covers both; the Accounting API host stays
// pinned to QUICKBOOKS_ENVIRONMENT exactly as before and is untouched by this module.
const DISCOVERY_URL = 'https://developer.api.intuit.com/.well-known/openid_configuration/';
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // ~1 hour

// Only these exact hosts may be used for the discovered endpoints. A discovery document that points
// anywhere else - even a look-alike or another Intuit-owned property we don't expect here - is
// rejected outright rather than trusted.
const ALLOWED_ENDPOINT_HOSTS = new Set([
  'appcenter.intuit.com',
  'oauth.platform.intuit.com',
  'developer.api.intuit.com',
]);

let cachedDiscovery = null; // { value, expiresAt }

function isTrustedIntuitHttpsUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ALLOWED_ENDPOINT_HOSTS.has(parsed.hostname);
}

// Field names (authorization_endpoint, token_endpoint, revocation_endpoint) match Intuit's published
// discovery document exactly - verified against the live production and sandbox discovery responses.
function validateDiscoveryDocument(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, revocation_endpoint: revocationEndpoint } = payload;
  if (!isTrustedIntuitHttpsUrl(authorizationEndpoint) || !isTrustedIntuitHttpsUrl(tokenEndpoint)) return null;
  // revocation_endpoint is optional per the discovery spec, but if Intuit supplies one it must still
  // pass the same trusted-host check - never silently ignore an untrusted value.
  if (revocationEndpoint !== undefined && revocationEndpoint !== null && !isTrustedIntuitHttpsUrl(revocationEndpoint)) return null;
  return {
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint: typeof revocationEndpoint === 'string' ? revocationEndpoint : null,
  };
}

/**
 * Fetches, validates, and caches Intuit's OAuth discovery document. Throws if the document cannot
 * be retrieved or fails validation - callers that must not block on Intuit's availability (see
 * getQuickBooksRevocationEndpointOrDefault) should catch this rather than relying on a fallback here.
 */
export async function getQuickBooksDiscoveryDocument({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const currentTime = now();
  if (cachedDiscovery && cachedDiscovery.expiresAt > currentTime) return cachedDiscovery.value;

  const response = await fetchImpl(DISCOVERY_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('QuickBooks discovery document could not be retrieved.');

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('QuickBooks discovery document response was not valid JSON.');
  }

  const validated = validateDiscoveryDocument(payload);
  if (!validated) throw new Error('QuickBooks discovery document was malformed or pointed to an untrusted host.');

  cachedDiscovery = { value: validated, expiresAt: currentTime + DISCOVERY_TTL_MS };
  return validated;
}

/**
 * Best-effort revocation endpoint lookup for disconnect: falls back to the last-known-good static
 * Intuit revocation endpoint if discovery is unavailable, so a transient discovery outage never
 * blocks a user from disconnecting and removing their locally stored credentials.
 */
export async function getQuickBooksRevocationEndpointOrDefault(defaultRevocationEndpoint, options = {}) {
  try {
    const discovery = await getQuickBooksDiscoveryDocument(options);
    return discovery.revocationEndpoint ?? defaultRevocationEndpoint;
  } catch {
    return defaultRevocationEndpoint;
  }
}

export function resetQuickBooksDiscoveryCacheForTests() {
  cachedDiscovery = null;
}

export const QUICKBOOKS_DISCOVERY_URL = DISCOVERY_URL;
