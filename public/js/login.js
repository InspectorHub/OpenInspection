// Scrub sensitive query params (e.g. ?reset_token=...) from browser history/URL bar
// so the token doesn't leak via Referer header or remain visible in the address bar.
(function() {
    if (window.location.search && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
    }
})();

function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    const errorMsg = document.getElementById('errorMsg');
    const emailInfo = document.getElementById('email');
    const passwordInfo = document.getElementById('password');
    if (!emailInfo || !passwordInfo) return;

    const email = emailInfo.value;
    const password = passwordInfo.value;

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    errorMsg.classList.add('hidden');

    try {
        // Double-submit CSRF: the server issued __Host-csrf_token on GET /login; we echo it
        // as X-CSRF-Token so the server can verify the request originated from its own page.
        const csrf = getCookie('__Host-csrf_token');
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrf,
            },
            credentials: 'same-origin',
            body: JSON.stringify({ email, password }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (res.status === 503) {
                errorMsg.textContent = 'System not ready. Please complete setup first.';
            } else {
                errorMsg.textContent = 'Server error. Please try again later.';
            }
            errorMsg.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Sign In';
            return;
        }

        const data = await res.json();

        if (res.ok && data.success) {
            // The server set an HttpOnly + Secure cookie on this response. Do NOT mirror it into
            // localStorage or document.cookie — that would downgrade the cookie to a JS-readable
            // one and let any XSS steal the session.
            window.location.href = data.data?.redirect || '/dashboard';
        } else {
            errorMsg.textContent = data.error?.message || data.error || 'Login failed. Please try again.';
            errorMsg.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    } catch (e) {
        errorMsg.textContent = 'Network error. Please try again.';
        errorMsg.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
});
