/**
 * Limits on the OAuth provider's two open write endpoints.
 *
 * `/oauth/register` creates a client record for anyone who asks, and `/oauth/token` checks codes and refresh tokens; the provider library
 * answers both itself, before any of this application's code runs, so a limit has to wrap the provider. A POST to either is counted per
 * caller address; everything else (the metadata documents, the authorize page, every other method) passes through untouched. An absent
 * binding, or the test escape hatch, allows, like everywhere else.
 *
 * Registration uses the default 10-per-minute limiter. The token endpoint has its own, higher binding: native clients refresh their tokens
 * from whatever address they sit behind, and an office or carrier gateway puts many of them behind one. A refusal is `429` with
 * `Retry-After` and `Cache-Control: no-store`, which is the retry signal for a client library; the JSON body names `temporarily_unavailable`
 * (the code RFC 6749 section 4.1.2.1 defines for the authorization endpoint, used here as a readable label: the token endpoint's own error
 * codes in section 5.2 have no rate-limit member).
 *
 * Fail-open is visible: a deployment without the token binding is not limited on that door, and the first token request an isolate serves
 * says so in the log.
 */
import { withinRateLimit } from '../rate-limit';
import { logger } from '../logger';

type FetchFn = (req: Request, env: unknown, ctx: ExecutionContext) => Response | Promise<Response>;

/** Which counter a request belongs to, or null when it is not one of the two limited doors. */
export function limitedOAuthDoor(method: string, pathname: string): 'oauth-register' | 'oauth-token' | null {
    if (method !== 'POST') return null;
    if (pathname === '/oauth/register') return 'oauth-register';
    if (pathname === '/oauth/token') return 'oauth-token';
    return null;
}

let warnedTokenBindingAbsent = false;

export function withOAuthEndpointLimits(inner: FetchFn, env: Parameters<typeof withinRateLimit>[0]): FetchFn {
    return async (req, e, ctx) => {
        const door = limitedOAuthDoor(req.method, new URL(req.url).pathname);
        if (door === 'oauth-token' && !env.OAUTH_TOKEN_RATE_LIMITER && env.DISABLE_RATE_LIMIT !== '1' && !warnedTokenBindingAbsent) {
            warnedTokenBindingAbsent = true;
            logger.warn('[oauth] OAUTH_TOKEN_RATE_LIMITER binding is absent; the token endpoint is not rate limited');
        }
        if (door && !await withinRateLimit(env, door, req.headers.get('CF-Connecting-IP') ?? 'unknown', door === 'oauth-token' ? 'OAUTH_TOKEN_RATE_LIMITER' : 'RATE_LIMITER')) {
            return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json', 'Retry-After': '60', 'Cache-Control': 'no-store', Pragma: 'no-cache' },
            });
        }
        return inner(req, e, ctx);
    };
}
