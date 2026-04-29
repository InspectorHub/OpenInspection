const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);

// ─── Load config on page load ─────────────────────────────────────────────────
async function loadConfig() {
    try {
        const res = await authFetch('/api/admin/config');
        if (res.status === 401) { window.location.href = '/login'; return; }
        if (!res.ok) return;
        const { data } = await res.json();
        const ic = data.integrationConfig || {};
        const s = data.secrets || {};

        if (ic.appBaseUrl) setVal('appBaseUrl', ic.appBaseUrl);
        if (ic.turnstileSiteKey) setVal('turnstileSiteKey', ic.turnstileSiteKey);
        if (ic.googleClientId) setVal('googleClientId', ic.googleClientId);

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

    authFetch('/api/admin/branding/logo', {
        method: 'POST',
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
    Object.keys(body).forEach(k => { if (!body[k]) delete body[k]; });

    const btn = document.getElementById('saveBrandingBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        const res = await authFetch('/api/admin/branding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        showToast(res.ok ? 'Branding saved.' : 'Failed to save branding.', !res.ok);
    } catch {
        showToast('Network error.', true);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Branding'; }
    }
}

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

    if (Object.keys(body).length === 0) {
        showToast('No changes to save.', false);
        return;
    }

    try {
        const res = await authFetch('/api/admin/config/secrets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
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

async function saveIntegration() {
    const body = {};
    const plainFields = ['appBaseUrl', 'turnstileSiteKey', 'googleClientId'];
    for (const field of plainFields) {
        const val = document.getElementById(field)?.value?.trim();
        if (val) body[field] = val;
    }

    const googleSecret = document.getElementById('googleClientSecret')?.value?.trim();
    if (googleSecret) {
        await authFetch('/api/admin/config/secrets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        const res = await authFetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        await loadConfig();
        showToast(res.ok ? 'Integration config saved.' : 'Failed to save.', !res.ok);
    } catch {
        showToast('Network error.', true);
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword')?.value;
    const newPassword = document.getElementById('newPassword')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;

    if (!currentPassword || !newPassword || !confirmPassword) { showToast('All fields are required.', true); return; }
    if (newPassword !== confirmPassword) { showToast('New passwords do not match.', true); return; }
    if (newPassword.length < 8) { showToast('New password must be at least 8 characters.', true); return; }

    const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
    });

    if (res.ok) {
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        showToast('Password updated. Please sign in again.', false);
        // Changing password revokes the current token. Force a re-auth.
        setTimeout(() => { window.location.href = '/login'; }, 1500);
    } else {
        const err = await res.json().catch(() => ({}));
        showToast('Error: ' + (err.error?.message || 'Failed'), true);
    }
}

// ─── Profile ─────────────────────────────────────────────────────────────────
async function loadProfile() {
    try {
        var res = await authFetch('/api/auth/me');
        if (!res.ok) return;
        var json = await res.json();
        var u = json.data?.user;
        if (u) {
            if (u.name) setVal('profileName', u.name);
            if (u.phone) setVal('profilePhone', u.phone);
            if (u.licenseNumber) setVal('profileLicense', u.licenseNumber);
        }
    } catch { /* ignore */ }
}

async function saveProfile() {
    var body = {
        name: document.getElementById('profileName')?.value?.trim() || '',
        phone: document.getElementById('profilePhone')?.value?.trim() || '',
        licenseNumber: document.getElementById('profileLicense')?.value?.trim() || '',
    };
    var btn = document.getElementById('saveProfileBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        var res = await authFetch('/api/auth/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        showToast(res.ok ? 'Profile saved.' : 'Failed to save profile.', !res.ok);
    } catch {
        showToast('Network error.', true);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Profile'; }
    }
}

// ─── ICS Subscription URL ─────────────────────────────────────────────────────
async function loadIcsUrl() {
    const input = document.getElementById('icsUrl');
    if (!input) return;
    try {
        const res = await authFetch('/api/admin/ics-token');
        if (!res.ok) return;
        const data = await res.json();
        input.value = data.data?.url || '';
    } catch { /* silent — feature is non-critical */ }
}

function copyIcsUrl() {
    const input = document.getElementById('icsUrl');
    if (!input?.value) return;
    navigator.clipboard.writeText(input.value).then(() => {
        const btn = document.getElementById('copyIcsBtn');
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = orig; }, 2000);
        }
    });
}

loadConfig();
loadProfile();
loadIcsUrl();
