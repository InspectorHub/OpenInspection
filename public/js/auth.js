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

function _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
