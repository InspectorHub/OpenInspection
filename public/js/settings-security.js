/**
 * Spec 4A — TOTP 2FA settings page Alpine controller.
 * Talks to the /api/auth/2fa/* endpoints introduced in this spec.
 */
function settingsSecurityFactory() {
    return {
        loading: true,
        busy: false,
        status: { totpEnabled: false, recoveryCodesRemaining: null },

        // Enable flow
        enableModalOpen: false,
        enableStep: 'qr', // qr | recovery
        enableData: { secret: '', qrCodeDataUri: '', recoveryCodes: [] },
        enableCode: '',
        enableError: '',

        // Disable flow
        disableModalOpen: false,
        disableForm: { password: '', code: '' },
        disableError: '',

        // Regenerate flow
        regenModalOpen: false,
        regenStep: 'verify', // verify | show
        regenForm: { password: '', code: '' },
        regenData: { recoveryCodes: [] },
        regenError: '',

        async init() {
            await this.refreshStatus();
            this.loading = false;
        },

        async refreshStatus() {
            try {
                const res = await authFetch('/api/auth/me');
                const json = await res.json();
                const u = json?.data?.user || {};
                this.status = {
                    totpEnabled: !!u.totpEnabled,
                    recoveryCodesRemaining: u.recoveryCodesRemaining ?? null,
                };
            } catch (e) {
                console.error('Failed to load 2FA status', e);
            }
        },

        async openEnable() {
            this.enableError = '';
            this.enableCode = '';
            this.enableStep = 'qr';
            this.enableModalOpen = true;
            this.busy = true;
            try {
                const res = await authFetch('/api/auth/2fa/setup', { method: 'POST' });
                const json = await res.json();
                if (!res.ok || !json?.data) throw new Error(json?.error?.message || 'Setup failed');
                this.enableData = {
                    secret: json.data.secret,
                    qrCodeDataUri: json.data.qrCodeDataUri,
                    recoveryCodes: json.data.recoveryCodes,
                };
            } catch (e) {
                this.enableError = e.message || 'Setup failed';
            } finally {
                this.busy = false;
            }
        },

        closeEnable() {
            this.enableModalOpen = false;
            this.enableStep = 'qr';
            this.enableCode = '';
            this.enableError = '';
            // Refresh status — in case the user verified, we want the badge to update.
            this.refreshStatus();
        },

        async verifyEnable() {
            this.enableError = '';
            this.busy = true;
            try {
                const res = await authFetch('/api/auth/2fa/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: this.enableCode.trim() }),
                });
                const json = await res.json();
                if (!res.ok || !json?.success) throw new Error(json?.error?.message || 'Invalid code');
                this.enableStep = 'recovery';
                await this.refreshStatus();
            } catch (e) {
                this.enableError = e.message || 'Verification failed';
            } finally {
                this.busy = false;
            }
        },

        openDisable() {
            this.disableForm = { password: '', code: '' };
            this.disableError = '';
            this.disableModalOpen = true;
        },

        async confirmDisable() {
            this.disableError = '';
            this.busy = true;
            try {
                const res = await authFetch('/api/auth/2fa/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        password: this.disableForm.password,
                        code: this.disableForm.code.trim(),
                    }),
                });
                const json = await res.json();
                if (!res.ok || !json?.success) throw new Error(json?.error?.message || 'Failed to disable');
                this.disableModalOpen = false;
                await this.refreshStatus();
            } catch (e) {
                this.disableError = e.message || 'Failed to disable';
            } finally {
                this.busy = false;
            }
        },

        openRegenerate() {
            this.regenForm = { password: '', code: '' };
            this.regenError = '';
            this.regenStep = 'verify';
            this.regenData = { recoveryCodes: [] };
            this.regenModalOpen = true;
        },

        async confirmRegen() {
            this.regenError = '';
            this.busy = true;
            try {
                const res = await authFetch('/api/auth/2fa/recovery-codes/regenerate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        password: this.regenForm.password,
                        code: this.regenForm.code.trim(),
                    }),
                });
                const json = await res.json();
                if (!res.ok || !json?.success) throw new Error(json?.error?.message || 'Failed');
                this.regenData = { recoveryCodes: json.data?.recoveryCodes || [] };
                this.regenStep = 'show';
                await this.refreshStatus();
            } catch (e) {
                this.regenError = e.message || 'Failed to regenerate';
            } finally {
                this.busy = false;
            }
        },

        downloadRecoveryCodes(codes) {
            const list = codes || this.enableData.recoveryCodes;
            const blob = new Blob([
                'Save these recovery codes somewhere safe.\n',
                'Each can be used once if you lose access to your authenticator app.\n\n',
                ...list.map(c => c + '\n'),
            ], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'inspectorhub-recovery-codes.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        async copyRecoveryCodes(codes) {
            const list = codes || this.enableData.recoveryCodes;
            try {
                await navigator.clipboard.writeText(list.join('\n'));
            } catch {
                // Clipboard API may be unavailable; user can still select+copy manually.
            }
        },
    };
}

function registerSecurityComponent(name, factory) {
    document.addEventListener('alpine:init', () => window.Alpine.data(name, factory));
    if (window.Alpine && typeof window.Alpine.data === 'function') {
        window.Alpine.data(name, factory);
        document.querySelectorAll('[x-data="' + name + '"]').forEach(el => {
            try { window.Alpine.destroyTree?.(el); } catch (_) {}
            try { window.Alpine.initTree(el); } catch (_) {}
        });
    }
}
registerSecurityComponent('settingsSecurity', settingsSecurityFactory);
