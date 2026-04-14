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
    btn.textContent = 'Signing in\u2026';
    errorMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        // Handle non-JSON responses (e.g. 503 plain text)
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
            const authData = data.data;
            if (authData.token) {
                localStorage.setItem('inspector_token', authData.token);
                // Also set non-httpOnly cookie for luxury/fallback visibility if needed,
                // but rely on localStorage for API calls.
                document.cookie = `inspector_token=${authData.token}; path=/; max-age=86400; samesite=lax`;
            }
            window.location.href = authData.redirect || '/dashboard';
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
