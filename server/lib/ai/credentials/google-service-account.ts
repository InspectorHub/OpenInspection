/**
 * A deployment AI credential that refreshes itself.
 *
 * WHY THIS EXISTS. Some AI backends publish an OpenAI-compatible endpoint but
 * do not issue a long-lived API key for it: they authenticate with an OAuth
 * access token whose life is about an hour. A deployment configured against
 * such a backend cannot hold a `string` credential — it would start returning
 * 401 partway through, and the adapter reads 401 as "your key or your
 * account", which for a deployment-owned credential blames the wrong person.
 *
 * WHAT IT DOES. Signs a short assertion with the deployment's own private key,
 * exchanges it at the identity provider's token endpoint for an access token,
 * and hands that token out until shortly before it expires.
 *
 * NEITHER HALF IS NEW HERE. The keyring already imports a PKCS8 key and signs
 * with Web Crypto; the calendar integration already posts a form-encoded grant
 * to the same token endpoint. This composes those two shapes for a third
 * purpose rather than inventing a mechanism, and it reuses their byte plumbing
 * rather than transcribing it.
 *
 * WHAT IT DELIBERATELY IS NOT. It is NOT a per-workspace credential. A
 * workspace's own key is a different path with a different lifetime, a
 * different owner and a different store, and it is untouched. This one is
 * deployment configuration, resolved from the environment, the same way the
 * long-lived platform key it stands beside always was.
 *
 * ⚠️ NOTHING HERE MAY BE LOGGED OR THROWN. Not the private key, not the signed
 * assertion, not the access token, and not the identity provider's response
 * body — a rejection can quote back the material it rejected. Every failure
 * path below carries a status and nothing else, and a spec asserts it.
 */
import { pemToBuf, base64UrlEncodeBytes, base64UrlEncodeString } from '../../jwt-keyring';
import { GOOGLE_TOKEN_URL } from '../../google-calendar';
import type { AiAccessTokenSource } from '../credential';

/** The only scope the target endpoint accepts. Not configurable: a narrower
 *  one is refused by the API and a broader one grants this deployment more
 *  than it needs. */
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** The id recorded as the backend that served a call, independent of how the
 *  configured model id is spelled. See the credential interface for why the
 *  credential declares this rather than the adapter deriving it. */
export const VERTEX_PROVIDER_ID = 'vertex-ai';

/** Seconds before true expiry at which a cached token stops being served.
 *  A call that STARTS inside this margin could still be in flight when the
 *  token dies, so the margin is about request duration, not clock skew. */
const REFRESH_MARGIN_SECONDS = 300;

/** Assertion lifetime. The maximum the exchange accepts; it is spent within a
 *  second of being minted, so a shorter one buys nothing. */
const ASSERTION_LIFETIME_SECONDS = 3600;

/** The fields this needs out of the credential document a deployment supplies.
 *  Everything else such a document carries is ignored rather than validated —
 *  a field this code does not use is not a field it should have opinions on. */
export interface GoogleServiceAccount {
    client_email: string;
    private_key: string;
    /** The identity provider's token endpoint. Present in every such document;
     *  defaulted so a hand-assembled one still works. */
    token_uri: string;
}

export type ParsedServiceAccount =
    | { ok: true; account: GoogleServiceAccount }
    | { ok: false; missing: readonly string[] };

/**
 * Read a supplied credential document.
 *
 * NEVER THROWS, and never returns anything drawn from the input on the failure
 * path. `missing` carries FIELD NAMES only, because it is written to a log an
 * operator reads: naming the field is what lets them fix it, and quoting the
 * value is what would put key material in the log.
 */
export function parseServiceAccountJson(raw: string): ParsedServiceAccount {
    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch {
        // The document itself is not echoed — it is, in the ordinary case, a
        // private key with a syntax error somewhere in it.
        return { ok: false, missing: ['(the value is not valid JSON)'] };
    }
    if (typeof doc !== 'object' || doc === null) {
        return { ok: false, missing: ['(the value is not a JSON object)'] };
    }

    const rec = doc as Record<string, unknown>;
    const str = (k: string): string | null =>
        typeof rec[k] === 'string' && (rec[k] as string).trim() !== '' ? (rec[k] as string) : null;

    const clientEmail = str('client_email');
    const privateKey = str('private_key');

    const missing: string[] = [];
    if (!clientEmail) missing.push('client_email');
    if (!privateKey) missing.push('private_key');
    if (missing.length > 0) return { ok: false, missing };

    return {
        ok: true,
        account: {
            client_email: clientEmail as string,
            private_key: privateKey as string,
            token_uri: str('token_uri') ?? GOOGLE_TOKEN_URL,
        },
    };
}

interface CachedToken {
    token: string;
    /** Epoch seconds at which this stops being served (already reduced by the
     *  refresh margin), NOT the moment it actually expires. */
    servableUntil: number;
}

/**
 * Cache and single-flight map, at MODULE scope — meaning per isolate.
 *
 * WHY NOT A DURABLE STORE. A short-lived token's whole value is that it is not
 * held anywhere; writing one into shared storage creates a credential at rest
 * for no correctness gain, and an eventually-consistent store can hand back a
 * value another isolate has already moved past. The cost of keeping it here is
 * stated plainly instead: a COLD ISOLATE pays one extra round trip on its
 * first AI call, and N isolates mint N tokens. The identity provider issues
 * concurrent tokens for one identity, so that is wasteful, not wrong.
 *
 * WHY THE IN-FLIGHT MAP. Two requests arriving together in a cold isolate
 * would otherwise both start an exchange. The second awaits the first's
 * promise instead. Across isolates there is no coordination and none is
 * wanted — see above.
 *
 * Keyed on identity + scope, so two differently-scoped sources never serve
 * each other's tokens.
 */
const tokenCache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

/** Bumped by the test reset so an exchange that was already running cannot write into the emptied cache. */
let generation = 0;

/**
 * Forget every cached token and every exchange in flight. Nothing in the product calls this: it exists
 * for the unit suite, whose `api-shared` project reuses one module registry across spec files and calls
 * it after each file (`tests/unit/setup-shared.ts`) so a token cached by one file is never served to the next.
 */
export function resetServiceAccountTokenCache(): void {
    generation += 1;
    tokenCache.clear();
    inFlight.clear();
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Build a self-refreshing credential from a parsed service account.
 *
 * The returned object is cheap and stateless; the state that matters is the
 * module-level cache above, so building one per request costs nothing and does
 * not re-mint.
 */
export function createServiceAccountTokenSource(
    account: GoogleServiceAccount,
    options: { providerId?: string; scope?: string } = {},
): AiAccessTokenSource {
    const scope = options.scope ?? CLOUD_PLATFORM_SCOPE;
    const cacheKey = `${account.client_email}\0${scope}`;

    return {
        providerId: options.providerId ?? VERTEX_PROVIDER_ID,

        async getAccessToken(): Promise<string> {
            const cached = tokenCache.get(cacheKey);
            if (cached && cached.servableUntil > nowSeconds()) return cached.token;

            const pending = inFlight.get(cacheKey);
            if (pending) return pending;

            const startedIn = generation;
            const attempt: Promise<string> = exchange(account, scope)
                .then(({ token, expiresIn }) => {
                    // An exchange that began before a reset must not refill the cache the reset emptied.
                    if (startedIn === generation) {
                        tokenCache.set(cacheKey, {
                            token,
                            servableUntil: nowSeconds() + expiresIn - REFRESH_MARGIN_SECONDS,
                        });
                    }
                    return token;
                })
                .finally(() => {
                    // Cleared on failure as well as success, so one refused
                    // exchange does not become an hour of refusals served from
                    // a poisoned entry. Nothing is written to the cache on the
                    // failing path, so the next caller simply tries again.
                    // Only this attempt's own entry: after a reset a newer attempt may hold the slot.
                    if (inFlight.get(cacheKey) === attempt) inFlight.delete(cacheKey);
                });

            inFlight.set(cacheKey, attempt);
            return attempt;
        },
    };
}

/** Sign an assertion and trade it for an access token. */
async function exchange(
    account: GoogleServiceAccount,
    scope: string,
): Promise<{ token: string; expiresIn: number }> {
    const assertion = await signAssertion(account, scope);

    const res = await fetch(account.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }).toString(),
    });

    if (!res.ok) {
        // The STATUS and nothing else. A rejection body from a token endpoint
        // routinely quotes the assertion, and the assertion is signed with the
        // deployment's private key; the caller turns this into an operator-
        // facing sentence and never shows it to a customer.
        throw new Error(`AI credential exchange refused with status ${res.status}`);
    }

    const data = await res.json().catch(() => null) as
        { access_token?: unknown; expires_in?: unknown } | null;
    const token = typeof data?.access_token === 'string' ? data.access_token : null;
    if (!token) throw new Error('AI credential exchange returned no access token');

    // A response without a usable lifetime is treated as the shortest thing
    // worth caching rather than as an error: the token works, and assuming a
    // long life is the only unsafe choice available here.
    const expiresIn = typeof data?.expires_in === 'number' && data.expires_in > 0
        ? data.expires_in
        : REFRESH_MARGIN_SECONDS + 60;

    return { token, expiresIn };
}

/**
 * Sign the assertion the exchange consumes.
 *
 * NOT routed through the session-token helper, and that is not an oversight:
 * that helper pins ES256 and stamps a key-version header, both of which are
 * correct for this product's own tokens and both of which this exchange
 * rejects. What is shared with it is the byte plumbing — PEM decoding and
 * base64url — imported rather than copied.
 */
async function signAssertion(account: GoogleServiceAccount, scope: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToBuf(account.private_key),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        // Non-extractable: nothing downstream may read this back out.
        false,
        ['sign'],
    );

    const iat = nowSeconds();
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: account.client_email,
        scope,
        aud: account.token_uri,
        iat,
        exp: iat + ASSERTION_LIFETIME_SECONDS,
    };

    const signingInput = `${base64UrlEncodeString(JSON.stringify(header))}.`
        + `${base64UrlEncodeString(JSON.stringify(claims))}`;
    const sig = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        new TextEncoder().encode(signingInput),
    );

    return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(sig))}`;
}
