/**
 * Per-outer-request memo shared by the in-process API calls a page render
 * fans out (see workers/app.ts). One `GET /inspections/:id` issues 15
 * `app.fetch()` calls, and Hono runs the whole `app.use('*')` chain on every
 * one of them — so the same JWT was verified 16 times and the same tenant
 * config read 15 times. This is where that work is shared.
 *
 * SECURITY: the scope reaches middleware only through an env that server code
 * builds itself: `workers/app.ts` for the in-process self-binding, and the
 * offline import for its replays (credential lookups only, see
 * `createCredentialScope`). External HTTP
 * requests go through `toApi`, which passes the plain `c.env`, so `memoOnce`
 * falls through to the factory and per-request verification is unchanged.
 * Memoisation is unreachable from outside BY CONSTRUCTION, not by a flag.
 */

/** Env key carrying the scope. Not a Worker binding — injected at the seam. */
export const REQUEST_SCOPE = '__requestScope' as const;

export interface RequestScope {
    once<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Caches the PROMISE, never the resolved value: the fan-out is parallel, so a
 * value cache would let every concurrent caller miss and recompute — the
 * memo would look correct and save nothing.
 *
 * A rejected promise stays cached for the life of the request, so all callers
 * see the same failure they would have hit individually. It cannot outlive the
 * request, which is why a rejection here can never poison a later one.
 */
export function createRequestScope(): RequestScope {
    const entries = new Map<string, Promise<unknown>>();
    return {
        once<T>(key: string, fn: () => Promise<T>): Promise<T> {
            const hit = entries.get(key) as Promise<T> | undefined;
            if (hit) return hit;
            const p = fn();
            entries.set(key, p);
            return p;
        },
    };
}

/** Keys a credential scope shares: who the bearer is, and whether a credential change cut it off. */
const CREDENTIAL_KEY = /^(native|pwchanged):/;

/**
 * A scope that shares ONLY credential lookups, for a request that calls the API
 * on its own behalf several times with the one bearer it was given (an offline
 * import replaying its queued writes). Without it every replay resolves the same
 * token and re-reads the same marker; with it they are resolved once. Anything
 * else falls through to its factory, so nothing a replay writes can be served
 * stale to the next one. Like the page-render scope it is attached by server
 * code to the env it hands to the in-process call; a client cannot supply it.
 */
export function createCredentialScope(): RequestScope {
    const inner = createRequestScope();
    return {
        once<T>(key: string, fn: () => Promise<T>): Promise<T> {
            return CREDENTIAL_KEY.test(key) ? inner.once(key, fn) : fn();
        },
    };
}

/**
 * The only sanctioned call shape. Call sites must not branch on the scope's
 * presence themselves — one forgotten branch is a silent correctness bug.
 */
export function memoOnce<T>(env: unknown, key: string, fn: () => Promise<T>): Promise<T> {
    const scope = (env as Record<string, unknown> | undefined)?.[REQUEST_SCOPE] as RequestScope | undefined;
    return scope ? scope.once(key, fn) : fn();
}

/**
 * True when this request reached the API through the worker's in-process
 * self-binding (the web app's own loaders and actions), false for external HTTP.
 * Unforgeable for the same reason the scope is: only `workers/app.ts` puts the
 * key on the env, and external traffic is handed the plain env.
 */
export function isInProcessRequest(env: unknown): boolean {
    return !!(env as Record<string, unknown> | undefined)?.[REQUEST_SCOPE];
}
