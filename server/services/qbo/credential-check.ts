import { logger } from '../../lib/logger';

/**
 * Tells an operator whether the Client ID and Client Secret they entered are a
 * matching pair for the same Intuit app, without connecting anything.
 *
 * Method: post an authorization-code exchange with a made-up code. Intuit
 * authenticates the client BEFORE it looks at the code, so
 *   - a matching pair answers `invalid_grant` (the code is not real), and
 *   - a wrong ID or secret answers `invalid_client`.
 * Nothing is created or consumed either way.
 *
 * What this does NOT show: whether the pair is a Development or a Production
 * key set. The token endpoint is shared by both environments and accepts both.
 *
 * Only an explicit refusal of the client is reported as `rejected`. A network
 * failure, a timeout, a 5xx, a 429 or an answer that is not the JSON Intuit
 * normally sends says nothing about the credentials, and calling it "wrong
 * credentials" would send the operator off to re-copy keys that were fine.
 *
 * The result carries the verdict and nothing else: no credential, no header and
 * no part of Intuit's response body is returned, logged or thrown.
 */
export type QboCredentialCheckResult = 'paired' | 'rejected' | 'unreachable';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TIMEOUT_MS = 10_000;
// Never a real authorization code; the exchange is meant to fail at the code.
const PLACEHOLDER_CODE = 'credential-check-not-a-real-code';

export async function checkIntuitCredentials(
    deps: { fetch: typeof fetch },
    creds: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<{ result: QboCredentialCheckResult }> {
    const result = await classify(deps, creds);
    // The enum only: the credentials are never in scope of this line's data.
    logger.info('QBO credential check finished', { result });
    return { result };
}

async function classify(
    deps: { fetch: typeof fetch },
    creds: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<QboCredentialCheckResult> {
    let status: number;
    let body: unknown;
    try {
        const resp = await deps.fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: 'Basic ' + btoa(`${creds.clientId}:${creds.clientSecret}`),
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: PLACEHOLDER_CODE,
                redirect_uri: creds.redirectUri,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = resp.status;
        body = await resp.json().catch(() => null);
    } catch {
        // Offline, DNS, timeout. The error text is dropped on purpose.
        return 'unreachable';
    }

    const error = typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error?: unknown }).error
        : undefined;

    // Not JSON: an error page from something between us and Intuit, not an answer.
    if (typeof body !== 'object' || body === null) return 'unreachable';
    // Only Intuit's own answer counts: a 401 from a gateway or firewall in front of
    // it is JSON too, and must not send the operator off to retype a correct key.
    if (status === 401 && error === 'invalid_client') return 'rejected';
    if (status === 400 && error === 'invalid_client') return 'rejected';
    if (status === 400 && error === 'invalid_grant') return 'paired';
    return 'unreachable';
}
