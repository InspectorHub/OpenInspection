// ─── Auth ─────────────────────────────────────────────────────────────────────
function parseJwt(t) {
    try { return JSON.parse(atob(t.split('.')[1])); } catch { return {}; }
}

let token = localStorage.getItem('inspector_token');
if (!token) {
    const urlParams = new URLSearchParams(window.location.search);
    token = urlParams.get('token');
    if (token) {
        localStorage.setItem('inspector_token', token);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        window.location.href = '/login';
    }
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('inspector_token');
        window.location.href = '/login';
    });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, isError) {
    const el = document.getElementById('statusToast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'fixed bottom-8 right-8 flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl text-sm font-bold text-white z-50 ' +
        (isError ? 'bg-red-600' : 'bg-emerald-600');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.classList.add('hidden'); }, 3500);
}

// ─── Load config on page load ─────────────────────────────────────────────────
async function loadConfig() {
    try {
        const res = await fetch('/api/admin/config', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) return;
        const { data } = await res.json();
        const ic = data.integrationConfig || {};
        const s = data.secrets || {};

        // Integration config (plaintext)
        if (ic.appBaseUrl) setVal('appBaseUrl', ic.appBaseUrl);
        if (ic.turnstileSiteKey) setVal('turnstileSiteKey', ic.turnstileSiteKey);
        if (ic.googleClientId) setVal('googleClientId', ic.googleClientId);

        // Masked secrets — show placeholder to indicate configured
        setMasked('resendApiKey', s.resendApiKey);
        setMasked('senderEmail', s.senderEmail);
        setMasked('turnstileSecretKey', s.turnstileSecretKey);
        setMasked('geminiApiKey', s.geminiApiKey);
        setMasked('googleClientSecret', s.googleClientSecret);
    } catch { /* ignore — page still works */ }
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
}

function setMasked(id, masked) {
    const el = document.getElementById(id);
    if (!el || !masked) return;
    el.placeholder = masked + ' (configured — leave blank to keep)';
}

// ─── Logo upload ──────────────────────────────────────────────────────────────
function handleLogoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    fetch('/api/admin/branding/logo', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
    }).then(r => r.json()).then(data => {
        if (data.logoUrl) {
            const preview = document.getElementById('logoPreview');
            const placeholder = document.getElementById('logoPlaceholder');
            if (preview) {
                preview.src = data.logoUrl;
            } else if (placeholder) {
                const img = document.createElement('img');
                img.id = 'logoPreview';
                img.src = data.logoUrl;
                img.className = 'w-full h-full object-contain p-4';
                placeholder.replaceWith(img);
            }
            showToast('Logo uploaded.', false);
        } else {
            showToast('Upload failed.', true);
        }
    }).catch(() => showToast('Network error.', true));
}

// ─── Save branding ────────────────────────────────────────────────────────────
async function saveBranding() {
    const body = {
        siteName: document.getElementById('siteName')?.value,
        primaryColor: document.getElementById('primaryColor')?.value,
        gaMeasurementId: document.getElementById('gaMeasurementId')?.value,
    };
    // Remove empty keys
    Object.keys(body).forEach(k => { if (!body[k]) delete body[k]; });

    const btn = document.getElementById('saveBrandingBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        const res = await fetch('/api/admin/branding', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        showToast(res.ok ? 'Branding saved.' : 'Failed to save branding.', !res.ok);
    } catch {
        showToast('Network error.', true);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Branding'; }
    }
}

// ─── Save secrets (encrypted) ─────────────────────────────────────────────────
// `section` controls which fields are included:
//   'email'      → resendApiKey, senderEmail
//   'turnstile'  → turnstileSecretKey (+ siteKey goes to integration)
//   'ai'         → geminiApiKey
//   'google'     → googleClientSecret (+ clientId goes to integration)
async function saveSecrets(section) {
    const secretFields = {
        email: ['resendApiKey', 'senderEmail'],
        turnstile: ['turnstileSecretKey'],
        ai: ['geminiApiKey'],
        google: ['googleClientSecret'],
    };

    const body = {};
    for (const field of (secretFields[section] || [])) {
        const val = document.getElementById(field)?.value;
        if (val && val.trim()) body[field] = val.trim();
    }

    // Nothing entered — nothing to save
    if (Object.keys(body).length === 0) {
        showToast('No changes to save.', false);
        return;
    }

    try {
        const res = await fetch('/api/admin/config/secrets', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            // Clear fields and reload masked placeholders
            for (const field of (secretFields[section] || [])) {
                const el = document.getElementById(field);
                if (el) el.value = '';
            }
            await loadConfig();
            showToast('Saved and encrypted.', false);
        } else {
            showToast('Failed to save.', true);
        }
    } catch {
        showToast('Network error.', true);
    }
}

// ─── Save integration config (plaintext) ─────────────────────────────────────
async function saveIntegration() {
    const body = {};
    const plainFields = ['appBaseUrl', 'turnstileSiteKey', 'googleClientId'];
    for (const field of plainFields) {
        const val = document.getElementById(field)?.value?.trim();
        if (val) body[field] = val;
    }

    // Google client secret goes to encrypted store
    const googleSecret = document.getElementById('googleClientSecret')?.value?.trim();
    if (googleSecret) {
        await fetch('/api/admin/config/secrets', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ googleClientSecret: googleSecret })
        });
        const el = document.getElementById('googleClientSecret');
        if (el) el.value = '';
    }

    if (Object.keys(body).length === 0 && !googleSecret) {
        showToast('No changes to save.', false);
        return;
    }

    try {
        const res = await fetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        await loadConfig();
        showToast(res.ok ? 'Integration config saved.' : 'Failed to save.', !res.ok);
    } catch {
        showToast('Network error.', true);
    }
}

// ─── Change password ──────────────────────────────────────────────────────────
async function changePassword() {
    const currentPassword = document.getElementById('currentPassword')?.value;
    const newPassword = document.getElementById('newPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;

    if (!currentPassword || !newPassword || !confirmPassword) { showToast('All fields are required.', true); return; }
    if (newPassword !== confirmPassword) { showToast('New passwords do not match.', true); return; }
    if (newPassword.length < 8) { showToast('New password must be at least 8 characters.', true); return; }

    const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
    });

    if (res.ok) {
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        showToast('Password updated.', false);
    } else {
        const err = await res.json().catch(() => ({}));
        showToast('Error: ' + (err.error?.message || 'Failed'), true);
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadConfig();
