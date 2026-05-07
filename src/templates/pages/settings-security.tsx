import { SettingsLayout } from '../components/settings-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

/**
 * Spec 4A — TOTP 2FA settings page.
 * All state + API calls live in /js/settings-security.js (Alpine controller).
 */
export const SettingsSecurityPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Two-factor (2FA)"
        group="account"
        subPage="security"
        pageTitle="Two-factor authentication"
        pageSubtitle="Add a second login factor with an authenticator app like 1Password, Authy, or Google Authenticator."
    >
        <div x-data="settingsSecurity" x-init="init()" class="space-y-5 max-w-3xl">
            <div x-show="loading" class="text-center py-6 text-sm text-ink-500">Loading...</div>

            {/* Status card */}
            <div x-show="!loading" class="p-6 bg-white border border-surface-200 rounded-lg">
                <div class="flex items-start justify-between gap-4 flex-wrap">
                    <div class="flex items-center gap-3">
                        <div {...{ 'x-bind:class': "status.totpEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-ink-500'" }} class="w-10 h-10 rounded-full flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                        </div>
                        <div>
                            <p class="font-bold text-ink-900">Two-factor authentication</p>
                            <p class="text-xs text-ink-600" x-text="status.totpEnabled ? 'Enabled. Required at every sign in.' : 'Not enabled.'"></p>
                            <p x-show="status.totpEnabled && status.recoveryCodesRemaining != null" class="text-xs text-ink-500 mt-1" x-text="status.recoveryCodesRemaining + ' recovery codes remaining'"></p>
                        </div>
                    </div>
                    <div class="flex gap-2 flex-wrap">
                        <button x-show="!status.totpEnabled" x-on:click="openEnable()" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">Enable 2FA</button>
                        <button x-show="status.totpEnabled" x-on:click="openRegenerate()" class="px-4 py-2 rounded-md border border-surface-200 bg-white text-ink-700 text-sm font-semibold hover:bg-surface-100 transition-all">Regenerate codes</button>
                        <button x-show="status.totpEnabled" x-on:click="openDisable()" class="px-4 py-2 rounded-md border border-rose-200 text-rose-700 text-sm font-bold hover:bg-rose-50 transition-all">Disable 2FA</button>
                    </div>
                </div>
            </div>

            {/* Enable modal — two-step body (qr / recovery), so footer is inlined per step. */}
            <Modal name="enableModalOpen" title="Enable two-factor authentication" size="md">
                <div class="space-y-4">
                    <div x-show="enableStep === 'qr'" class="space-y-4">
                        <p class="text-sm text-ink-700">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
                        <div class="flex justify-center">
                            <img {...{ 'x-bind:src': 'enableData.qrCodeDataUri', 'x-show': 'enableData.qrCodeDataUri' }} alt="2FA QR code" class="rounded-md border border-surface-200" />
                        </div>
                        <div class="text-center">
                            <p class="text-xs text-ink-500">Or enter this secret manually:</p>
                            <code class="text-sm font-mono bg-surface-100 px-2 py-1 rounded inline-block mt-1 select-all" x-text="enableData.secret"></code>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">6-digit code from your app</label>
                            <input type="text" x-model="enableCode" inputmode="numeric" autocomplete="one-time-code" maxlength={6} placeholder="123456" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm font-mono tracking-widest text-center" />
                        </div>
                        <p x-show="enableError" class="text-xs text-rose-600" x-text="enableError"></p>
                        <div class="flex gap-3 mt-2">
                            <ModalFooter
                                onCancel="closeEnable()"
                                onConfirm="verifyEnable()"
                                confirmDisabled="busy || enableCode.length !== 6"
                                confirmTextExpr="busy ? 'Verifying...' : 'Verify &amp; Enable'"
                            />
                        </div>
                    </div>

                    <div x-show="enableStep === 'recovery'" class="space-y-4">
                        <p class="text-sm text-ink-700 font-semibold">Save your recovery codes</p>
                        <p class="text-xs text-ink-500">Store these in a safe place. Each code can be used once if you lose access to your authenticator.</p>
                        <div class="bg-surface-50 border border-surface-200 rounded-md p-4 grid grid-cols-2 gap-2 font-mono text-sm">
                            <template x-for="code in enableData.recoveryCodes" {...{ 'x-bind:key': 'code' }}>
                                <code class="select-all" x-text="code"></code>
                            </template>
                        </div>
                        <div class="flex gap-3">
                            <button type="button" x-on:click="downloadRecoveryCodes()" class="text-xs font-bold text-blueprint-700 hover:underline">Download as .txt</button>
                            <button type="button" x-on:click="copyRecoveryCodes()" class="text-xs font-bold text-blueprint-700 hover:underline">Copy all</button>
                        </div>
                        <div class="flex justify-end mt-2">
                            <button type="button" x-on:click="closeEnable()" class="h-10 px-6 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-all">Done</button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Disable modal */}
            <Modal
                name="disableModalOpen"
                title="Disable two-factor authentication"
                size="md"
                footer={
                    <ModalFooter
                        onCancel="disableModalOpen = false"
                        onConfirm="confirmDisable()"
                        confirmDisabled="busy || !disableForm.password || !disableForm.code"
                        confirmTextExpr="busy ? 'Disabling...' : 'Disable 2FA'"
                        danger={true}
                    />
                }
            >
                <div class="space-y-4">
                    <p class="text-sm text-ink-700">Enter your password and a current 2FA code (or recovery code) to confirm.</p>
                    <div>
                        <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Current password</label>
                        <input type="password" x-model="disableForm.password" autocomplete="current-password" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">2FA code or recovery code</label>
                        <input type="text" x-model="disableForm.code" autocomplete="one-time-code" placeholder="123456 or XXXX-XXXX" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm font-mono" />
                    </div>
                    <p x-show="disableError" class="text-xs text-rose-600" x-text="disableError"></p>
                </div>
            </Modal>

            {/* Regenerate modal — two-step (verify / show) so footer is inlined per step. */}
            <Modal
                name="regenModalOpen"
                titleExpr="regenStep === 'verify' ? 'Regenerate recovery codes' : 'New recovery codes'"
                size="md"
            >
                <div x-show="regenStep === 'verify'" class="space-y-4">
                    <p class="text-sm text-ink-700">Old recovery codes will be invalidated immediately.</p>
                    <div>
                        <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Current password</label>
                        <input type="password" x-model="regenForm.password" autocomplete="current-password" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">2FA code or recovery code</label>
                        <input type="text" x-model="regenForm.code" autocomplete="one-time-code" placeholder="123456 or XXXX-XXXX" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm font-mono" />
                    </div>
                    <p x-show="regenError" class="text-xs text-rose-600" x-text="regenError"></p>
                    <div class="flex gap-3 mt-2">
                        <ModalFooter
                            onCancel="regenModalOpen = false"
                            onConfirm="confirmRegen()"
                            confirmDisabled="busy || !regenForm.password || !regenForm.code"
                            confirmTextExpr="busy ? 'Regenerating...' : 'Regenerate'"
                        />
                    </div>
                </div>

                <div x-show="regenStep === 'show'" class="space-y-4">
                    <p class="text-xs text-ink-500">Save these in a safe place — your old codes no longer work.</p>
                    <div class="bg-surface-50 border border-surface-200 rounded-md p-4 grid grid-cols-2 gap-2 font-mono text-sm">
                        <template x-for="code in regenData.recoveryCodes" {...{ 'x-bind:key': 'code' }}>
                            <code class="select-all" x-text="code"></code>
                        </template>
                    </div>
                    <div class="flex gap-3">
                        <button type="button" x-on:click="downloadRecoveryCodes(regenData.recoveryCodes)" class="text-xs font-bold text-blueprint-700 hover:underline">Download as .txt</button>
                        <button type="button" x-on:click="copyRecoveryCodes(regenData.recoveryCodes)" class="text-xs font-bold text-blueprint-700 hover:underline">Copy all</button>
                    </div>
                    <div class="flex justify-end mt-2">
                        <button type="button" x-on:click="regenModalOpen = false" class="h-10 px-6 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-all">Done</button>
                    </div>
                </div>
            </Modal>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/settings-security.js"></script>
    </SettingsLayout>
);
