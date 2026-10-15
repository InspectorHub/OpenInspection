/**
 * Paths the global JWT middleware does not authenticate at all (they run with no
 * identity, by design). Moved here from jwt-auth.ts unchanged so that the
 * authorization-surface spec can ask the same question the middleware asks.
 *
 * Everything under /api/ that is NOT matched here and is not in
 * ./api-access-policy.ts is refused without a session, in every deployment mode.
 */
import { QBO_CALLBACK_PATH } from '../qbo-oauth-paths';

// Static asset extensions - these bypass JWT verification. A strict allowlist
// rather than path.includes('.'), so a dot inside a path segment cannot make a
// protected route look public.
const STATIC_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|pdf)$/i;

/** An extension is not a classification on its own: /api/ paths are never static assets. */
function isStaticAssetPath(path: string): boolean {
    if (path.startsWith('/api/')) return false;
    return STATIC_ASSET_EXT.test(path);
}

export function isUnauthenticatedPath(path: string): boolean {
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup' || path === '/api/auth/login/2fa';
    // Agent Accounts A1 + the agent unified link (Spec 3 — report token or one-time KV code, never a session).
    // Spec 3 Task 5 — core /agent-login dual-mode front door (password +
    // magic-link request); both are unauthenticated by design (the caller
    // holds neither a session nor a report token yet).
    //
    // `/api/agent-signup/terms` is listed SEPARATELY because these are exact
    // matches, not prefixes: `path === '/api/agent-signup'` does not cover a
    // child path. The signup page must display the agent terms before anyone
    // has an account, so a document nobody can read without a session would
    // leave the tick asserting a presentation that never happened.
    const isAgentPublic = path.startsWith('/agent-invite/') || path === '/api/agents/accept' || path === '/agent-signup' || path === '/api/agent-signup' || path === '/api/agent-signup/terms' || path === '/agent/magic-login' || path === '/api/agent/magic-login/request' || path === '/api/agent/report-context' || path === '/api/agent/login' || path === '/api/agent/login-link';
    // Agent Accounts A3 — concierge magic-link entry points (client-facing,
    // no JWT). The token in the URL is the secret.
    const isConciergePublic =
        path.startsWith('/confirm/') ||
        path === '/api/concierge/confirm' ||
        path === '/api/concierge/book-info' ||
        path === '/api/concierge/book' ||
        path === '/api/concierge/confirm-info';
    // `/unsubscribe/:token` is listed for a reason worth writing down: it is the
    // PAGE the emailed link lands on, and the person clicking it may well be
    // signed in — an agent reading their mail in the browser they work in. If
    // the JWT middleware classified them here, `agentUserId` would be set and
    // `agentTermsGate` (mounted on `*`, so it covers pages too) would hold the
    // page as well as the API. Listing it keeps the whole flow outside the
    // gate's reckoning rather than exempted from it; the API half is already
    // covered by the `/api/public/` prefix. See `server/api/unsubscribe.ts`.
    // `/webhooks/` below covers every inbound provider webhook in one prefix:
    // they mount at the top level (see server/index.ts) precisely so they inherit
    // none of the /api/* middleware, and each one authenticates itself by
    // verifying the producer's signature over the raw body. A per-path list here
    // was one forgotten entry away from a webhook that 401s in production only.
    // `QBO_CALLBACK_PATH` is public for the same shape of reason but is NOT a
    // webhook — it is the OAuth callback, so it keeps its own exact-match entry.
    // Neither caller can hold a session. Intuit returns the
    // user by cross-site top-level navigation, and `__Host-inspector_token` is
    // SameSite=Strict, so no cookie is on that request — the route is authorized
    // by a single-use, 600s, owner/manager-issued `state` instead. See
    // `server/api/qbo-oauth.ts`.
    const isPublic = path.startsWith('/api/__test__/') || path.startsWith('/api/public/') || path.startsWith('/api/platform/') || path.startsWith('/api/admin/connect') || path.startsWith('/api/admin/silo') || path.startsWith('/api/ics/') || path === '/book' || path.startsWith('/book/') || path.startsWith('/inspector/') || path.startsWith('/embed/') || path.startsWith('/photos/') || path === '/' || path === '/status' || path.startsWith('/static/') || path.startsWith('/report/') || path.startsWith('/report-view/') || path.startsWith('/invoice/') || path.startsWith('/agreements/sign/') || path.startsWith('/checkout/') || path.startsWith('/sign/') || path.startsWith('/m2m/') || path.startsWith('/verify/') || path.startsWith('/v/') || path.startsWith('/.well-known/') || isStaticAssetPath(path) || path.startsWith('/webhooks/') || path === QBO_CALLBACK_PATH || path.startsWith('/unsubscribe/') || path.startsWith('/repair-request/') || path.startsWith('/repair-builder/') || path.startsWith('/api/portal/') || path.startsWith('/portal/') || path === '/api/client/compat';

    return isAuthPublic || isPublic || isAgentPublic || isConciergePublic || path === '/setup';
}
