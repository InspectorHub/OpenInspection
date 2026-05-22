// Capture sensitive query params (?reset_token=...) BEFORE scrubbing them from
// the URL bar. The token never re-appears in history/Referer this way.
const _resetTokenFromUrl = (() => {
    if (!window.location.search) return null;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('reset_token');
    if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
    }
    return t;
})();

function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}

// Find the x-data root that holds the form `step` state. We mutate it directly
// to switch the visible form (password / 2fa / forgot / reset) without relying
// on Alpine internals beyond _x_dataStack[0], which is the documented v3 hook.
function setStep(value) {
    const root = document.querySelector('[data-initial-step]');
    if (root && root._x_dataStack) {
        root._x_dataStack[0].step = value;
    }
}

// On first load, if the URL carried a reset_token, switch the form into the
// "set new password" view. The user hit a /login?reset_token=... link from
// their email — we honour it whether or not the server seeded a different
// initial step. Alpine is loaded with `defer`, so we wait for its
// initialization event before mutating the reactive scope; on the off chance
// Alpine has already booted (cached, late script), we fall back to a polling
// retry that gives up after a few hundred ms.
if (_resetTokenFromUrl) {
    if (window.Alpine && document.querySelector('[data-initial-step]')?._x_dataStack) {
        setStep('reset');
    } else {
        document.addEventListener('alpine:initialized', () => setStep('reset'), { once: true });
        // Belt-and-suspenders polling in case the event already fired.
        let tries = 0;
        const poll = () => {
            if (document.querySelector('[data-initial-step]')?._x_dataStack) {
                setStep('reset');
            } else if (++tries < 20) {
                setTimeout(poll, 50);
            }
        };
        setTimeout(poll, 50);
    }
}

// Spec 4A — challenge token from /api/auth/login when 2FA is enabled.
let pendingChallengeToken = null;

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
            // Spec 4A — If the user has 2FA enabled, the server returns a challenge instead
            // of a session cookie. Switch UI to step='2fa' and prompt for the TOTP code.
            if (data.data?.requires2fa && data.data?.challengeToken) {
                pendingChallengeToken = data.data.challengeToken;
                // The Alpine wrapper around the form watches this state via a custom event.
                const root = document.querySelector('[x-data]');
                if (root && root.__x) {
                    root.__x.$data.step = '2fa';
                } else if (root && root._x_dataStack) {
                    // Alpine v3 stores reactive data on _x_dataStack
                    root._x_dataStack[0].step = '2fa';
                }
                btn.disabled = false;
                btn.textContent = 'Sign In';
                setTimeout(() => { document.getElementById('twofaCode')?.focus(); }, 50);
                return;
            }
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

// Spec 4A — 2FA verification step.
const twofaForm = document.getElementById('twofaForm');
if (twofaForm) {
    twofaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('twofaSubmitBtn');
        const errorMsg = document.getElementById('errorMsg');
        const codeInput = document.getElementById('twofaCode');
        if (!btn || !codeInput) return;

        const code = codeInput.value.trim();
        if (!code) return;
        if (!pendingChallengeToken) {
            errorMsg.textContent = 'Session expired. Please sign in again.';
            errorMsg.classList.remove('hidden');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Verifying...';
        errorMsg.classList.add('hidden');

        try {
            const csrf = getCookie('__Host-csrf_token');
            const res = await fetch('/api/auth/login/2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                credentials: 'same-origin',
                body: JSON.stringify({ challengeToken: pendingChallengeToken, code }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                window.location.href = data.data?.redirect || '/dashboard';
            } else {
                errorMsg.textContent = data.error?.message || data.error || 'Invalid verification code.';
                errorMsg.classList.remove('hidden');
                btn.disabled = false;
                btn.textContent = 'Verify';
            }
        } catch {
            errorMsg.textContent = 'Network error. Please try again.';
            errorMsg.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Verify';
        }
    });
}

// ─── Forgot password ────────────────────────────────────────────────────────
// POST /api/auth/forgot-password — server always returns 200 to avoid email
// enumeration, so the success banner is shown regardless of whether the email
// is registered. Rate-limited server-side.
const forgotForm = document.getElementById('forgotForm');
if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('forgotSubmitBtn');
        const errorMsg = document.getElementById('errorMsg');
        const success = document.getElementById('forgotSuccess');
        const emailInput = document.getElementById('forgotEmail');
        if (!emailInput || !btn) return;

        const email = emailInput.value.trim();
        if (!email) return;

        btn.disabled = true;
        const btnLabel = btn.querySelector('span');
        const originalLabel = btnLabel ? btnLabel.textContent : null;
        if (btnLabel) btnLabel.textContent = 'Sending…';
        errorMsg.classList.add('hidden');

        try {
            const csrf = getCookie('__Host-csrf_token');
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                credentials: 'same-origin',
                body: JSON.stringify({ email }),
            });

            if (res.ok) {
                if (success) success.classList.remove('hidden');
                emailInput.disabled = true;
                if (btnLabel) btnLabel.textContent = 'Sent';
            } else {
                let msg = 'Could not send reset email. Try again later.';
                try { const data = await res.json(); msg = data.error?.message || data.error || msg; } catch {}
                errorMsg.textContent = msg;
                errorMsg.classList.remove('hidden');
                btn.disabled = false;
                if (btnLabel && originalLabel) btnLabel.textContent = originalLabel;
            }
        } catch {
            errorMsg.textContent = 'Network error. Please try again.';
            errorMsg.classList.remove('hidden');
            btn.disabled = false;
            if (btnLabel && originalLabel) btnLabel.textContent = originalLabel;
        }
    });
}

// ─── Reset password ─────────────────────────────────────────────────────────
// POST /api/auth/reset-password — accepts the token we captured at module load
// and the new password. On success, switch back to the sign-in form so the
// user can log in with the new password (auto-redirect would be friendlier but
// would silently 200 on a fresh tab where the user didn't expect to land).
const resetForm = document.getElementById('resetForm');
if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('resetSubmitBtn');
        const errorMsg = document.getElementById('errorMsg');
        const pwInput = document.getElementById('resetPassword');
        const pwConfirm = document.getElementById('resetPasswordConfirm');
        if (!pwInput || !pwConfirm || !btn) return;

        const password = pwInput.value;
        const confirm = pwConfirm.value;
        const btnLabel = btn.querySelector('span');
        const originalLabel = btnLabel ? btnLabel.textContent : null;

        errorMsg.classList.add('hidden');

        if (!_resetTokenFromUrl) {
            errorMsg.textContent = 'Missing reset token. Request a new reset link.';
            errorMsg.classList.remove('hidden');
            return;
        }
        if (password.length < 8) {
            errorMsg.textContent = 'Password must be at least 8 characters.';
            errorMsg.classList.remove('hidden');
            return;
        }
        if (password !== confirm) {
            errorMsg.textContent = 'Passwords do not match.';
            errorMsg.classList.remove('hidden');
            return;
        }

        btn.disabled = true;
        if (btnLabel) btnLabel.textContent = 'Saving…';

        try {
            const csrf = getCookie('__Host-csrf_token');
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                credentials: 'same-origin',
                body: JSON.stringify({ token: _resetTokenFromUrl, newPassword: password }),
            });

            if (res.ok) {
                // Flip back to the sign-in form and prefill nothing — the user
                // should enter their email + new password. A small banner
                // confirms the reset succeeded.
                setStep('password');
                pwInput.value = '';
                pwConfirm.value = '';
                errorMsg.textContent = 'Password updated. Sign in with your new password below.';
                errorMsg.classList.remove('hidden');
                errorMsg.style.background = '#ecfdf5';
                errorMsg.style.color = '#065f46';
            } else {
                let msg = 'Could not reset password. The link may have expired — request a new one.';
                try { const data = await res.json(); msg = data.error?.message || data.error || msg; } catch {}
                errorMsg.textContent = msg;
                errorMsg.classList.remove('hidden');
                btn.disabled = false;
                if (btnLabel && originalLabel) btnLabel.textContent = originalLabel;
            }
        } catch {
            errorMsg.textContent = 'Network error. Please try again.';
            errorMsg.classList.remove('hidden');
            btn.disabled = false;
            if (btnLabel && originalLabel) btnLabel.textContent = originalLabel;
        }
    });
}
