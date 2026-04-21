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
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
