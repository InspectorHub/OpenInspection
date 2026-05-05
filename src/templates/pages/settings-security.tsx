import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

/**
 * Spec 4A — TOTP 2FA settings page.
 * All state + API calls live in /js/settings-security.js (Alpine controller).
 */
export const SettingsSecurityPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Security & 2FA" {...(branding ? { branding } : {})}>
        <div x-data="settingsSecurity" x-init="init()" class="space-y-10 max-w-3xl">
            <header>
                <h1 class="text-3xl font-black text-slate-900 tracking-tight">Security &amp; 2FA</h1>
                <p class="text-sm text-slate-500 mt-1">Add a second login factor with an authenticator app like 1Password, Authy, or Google Authenticator.</p>
            </header>

            <div x-show="loading" class="text-center py-12 text-sm text-slate-500">Loading...</div>

            {/* Status card */}
            <div x-show="!loading" class="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div class="flex items-center gap-3">
                        <div {...{ 'x-bind:class': "status.totpEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'" }} class="w-10 h-10 rounded-full flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                        </div>
                        <div>
                            <p class="font-bold text-slate-900">Two-factor authentication</p>
                            <p class="text-xs text-slate-500" x-text="status.totpEnabled ? 'Enabled. Required at every sign in.' : 'Not enabled.'"></p>
                            <p x-show="status.totpEnabled && status.recoveryCodesRemaining != null" class="text-xs text-slate-400 mt-1" x-text="status.recoveryCodesRemaining + ' recovery codes remaining'"></p>
                        </div>
                    </div>
                    <div class="flex gap-2 flex-wrap">
                        <button x-show="!status.totpEnabled" x-on:click="openEnable()" class="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black">Enable 2FA</button>
                        <button x-show="status.totpEnabled" x-on:click="openRegenerate()" class="px-4 py-2 rounded-xl ring-2 ring-slate-300 text-slate-700 text-xs font-bold uppercase tracking-widest hover:bg-slate-50">Regenerate codes</button>
                        <button x-show="status.totpEnabled" x-on:click="openDisable()" class="px-4 py-2 rounded-xl ring-2 ring-rose-300 text-rose-700 text-xs font-bold uppercase tracking-widest hover:bg-rose-50">Disable 2FA</button>
                    </div>
                </div>
            </div>

            {/* Enable modal */}
            <div x-show="enableModalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) closeEnable()' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
                    <h2 class="text-lg font-bold text-slate-900">Enable two-factor authentication</h2>

                    <div x-show="enableStep === 'qr'" class="space-y-4">
                        <p class="text-sm text-slate-600">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
                        <div class="flex justify-center">
                            <img {...{ 'x-bind:src': 'enableData.qrCodeDataUri', 'x-show': 'enableData.qrCodeDataUri' }} alt="2FA QR code" class="rounded-lg border border-slate-200" />
                        </div>
                        <div class="text-center">
                            <p class="text-xs text-slate-500">Or enter this secret manually:</p>
                            <code class="text-sm font-mono bg-slate-100 px-2 py-1 rounded inline-block mt-1 select-all" x-text="enableData.secret"></code>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">6-digit code from your app</label>
                            <input type="text" x-model="enableCode" inputmode="numeric" autocomplete="one-time-code" maxlength={6} placeholder="123456" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tracking-widest text-center" />
                        </div>
                        <p x-show="enableError" class="text-xs text-rose-600" x-text="enableError"></p>
                        <div class="flex gap-3 justify-end">
                            <button x-on:click="closeEnable()" class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold">Cancel</button>
                            <button x-on:click="verifyEnable()" {...{ 'x-bind:disabled': 'busy || enableCode.length !== 6' }} class="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50">
                                <span x-text="busy ? 'Verifying...' : 'Verify &amp; Enable'"></span>
                            </button>
                        </div>
                    </div>

                    <div x-show="enableStep === 'recovery'" class="space-y-4">
                        <p class="text-sm text-slate-600 font-semibold">Save your recovery codes</p>
                        <p class="text-xs text-slate-500">Store these in a safe place. Each code can be used once if you lose access to your authenticator.</p>
                        <div class="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-2 gap-2 font-mono text-sm">
                            <template x-for="code in enableData.recoveryCodes" {...{ 'x-bind:key': 'code' }}>
                                <code class="select-all" x-text="code"></code>
                            </template>
                        </div>
                        <div class="flex gap-2">
                            <button x-on:click="downloadRecoveryCodes()" class="text-xs font-bold text-indigo-600 hover:underline">Download as .txt</button>
                            <button x-on:click="copyRecoveryCodes()" class="text-xs font-bold text-indigo-600 hover:underline">Copy all</button>
                        </div>
                        <div class="flex justify-end">
                            <button x-on:click="closeEnable()" class="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black">Done</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Disable modal */}
            <div x-show="disableModalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) disableModalOpen = false' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
                    <h2 class="text-lg font-bold text-slate-900">Disable two-factor authentication</h2>
                    <p class="text-sm text-slate-600">Enter your password and a current 2FA code (or recovery code) to confirm.</p>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">Current password</label>
                        <input type="password" x-model="disableForm.password" autocomplete="current-password" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">2FA code or recovery code</label>
                        <input type="text" x-model="disableForm.code" autocomplete="one-time-code" placeholder="123456 or XXXX-XXXX" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                    </div>
                    <p x-show="disableError" class="text-xs text-rose-600" x-text="disableError"></p>
                    <div class="flex gap-3 justify-end">
                        <button x-on:click="disableModalOpen = false" class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold">Cancel</button>
                        <button x-on:click="confirmDisable()" {...{ 'x-bind:disabled': 'busy || !disableForm.password || !disableForm.code' }} class="px-5 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-rose-700 disabled:opacity-50">
                            <span x-text="busy ? 'Disabling...' : 'Disable 2FA'"></span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Regenerate modal */}
            <div x-show="regenModalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) regenModalOpen = false' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
                    <h2 class="text-lg font-bold text-slate-900" x-text="regenStep === 'verify' ? 'Regenerate recovery codes' : 'New recovery codes'"></h2>

                    <div x-show="regenStep === 'verify'" class="space-y-4">
                        <p class="text-sm text-slate-600">Old recovery codes will be invalidated immediately.</p>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Current password</label>
                            <input type="password" x-model="regenForm.password" autocomplete="current-password" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">2FA code or recovery code</label>
                            <input type="text" x-model="regenForm.code" autocomplete="one-time-code" placeholder="123456 or XXXX-XXXX" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                        </div>
                        <p x-show="regenError" class="text-xs text-rose-600" x-text="regenError"></p>
                        <div class="flex gap-3 justify-end">
                            <button x-on:click="regenModalOpen = false" class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold">Cancel</button>
                            <button x-on:click="confirmRegen()" {...{ 'x-bind:disabled': 'busy || !regenForm.password || !regenForm.code' }} class="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50">
                                <span x-text="busy ? 'Regenerating...' : 'Regenerate'"></span>
                            </button>
                        </div>
                    </div>

                    <div x-show="regenStep === 'show'" class="space-y-4">
                        <p class="text-xs text-slate-500">Save these in a safe place — your old codes no longer work.</p>
                        <div class="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-2 gap-2 font-mono text-sm">
                            <template x-for="code in regenData.recoveryCodes" {...{ 'x-bind:key': 'code' }}>
                                <code class="select-all" x-text="code"></code>
                            </template>
                        </div>
                        <div class="flex gap-2">
                            <button x-on:click="downloadRecoveryCodes(regenData.recoveryCodes)" class="text-xs font-bold text-indigo-600 hover:underline">Download as .txt</button>
                            <button x-on:click="copyRecoveryCodes(regenData.recoveryCodes)" class="text-xs font-bold text-indigo-600 hover:underline">Copy all</button>
                        </div>
                        <div class="flex justify-end">
                            <button x-on:click="regenModalOpen = false" class="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black">Done</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/settings-security.js"></script>
    </MainLayout>
);
