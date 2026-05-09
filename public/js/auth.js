// Shared auth utilities. The HttpOnly inspector_token cookie is sent automatically
// on same-origin fetches — never store the token in JS-readable storage.

const authFetch = (url, opts = {}) =>
    fetch(url, { credentials: 'same-origin', ...opts });

async function logout() {
    try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
}

// Expose to window so scripts that use `window.authFetch` (e.g. the Sprint 2
// inspection sub-page Alpine factories) work the same as scripts that use the
// bare `authFetch` reference. Top-level `const` does NOT attach to window in
// modern browsers — `window.authFetch` would otherwise be undefined.
window.authFetch = authFetch;
window.logout = logout;

// iter-1 production bug #2 — extract a human-readable error message from the
// inconsistent error shapes returned by core. Three shapes are observed:
//   1. AppError envelope:        { success:false, error:{ message, code, details? } }
//   2. Zod validation envelope:  { success:false, error:{ issues: [...] } } (raw
//      `@hono/zod-openapi` default — no defaultHook configured)
//   3. Zod validation array:     { success:false, error: [...] }            (some
//      legacy callsites that c.json the issues array directly)
// In every Zod case we want the joined human message, never the raw object,
// so the toast doesn't expose regex patterns to the inspector.
function extractErrorMessage(payload, fallback) {
    const FALLBACK = fallback || 'Something went wrong';
    if (payload == null) return FALLBACK;

    // Plain string envelope (e.g. text/plain 500 page)
    if (typeof payload === 'string') return payload || FALLBACK;

    const err = payload.error;
    if (err == null) {
        return (typeof payload.message === 'string' && payload.message) || FALLBACK;
    }

    // AppError envelope first — preserve the human message produced by the
    // global error handler (Errors.NotFound, Errors.RateLimited, etc.).
    if (typeof err === 'object' && typeof err.message === 'string' && err.message) {
        return err.message;
    }

    // Zod issues — either as `error.issues` or `error` directly being the array.
    const issues = Array.isArray(err) ? err : (Array.isArray(err.issues) ? err.issues : null);
    if (issues && issues.length > 0) {
        const messages = issues
            .map((i) => (i && typeof i.message === 'string' ? i.message : null))
            .filter(Boolean);
        if (messages.length > 0) return messages.join(' · ');
    }

    return FALLBACK;
}
window.extractErrorMessage = extractErrorMessage;

function _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
