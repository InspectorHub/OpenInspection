import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { BUILD } from '../../generated/version';

export const SettingsPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#6366f1';
    const logoUrl = branding?.logoUrl;
    const gaMeasurementId = branding?.gaMeasurementId || '';

    const sectionIcon = (path: string, color: string) => (
        <div class={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center shadow-sm`}>
            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={path} />
            </svg>
        </div>
    );

    return (
        <MainLayout title={`${siteName} | Settings`} branding={branding}>
            <div class="max-w-5xl mx-auto space-y-16 animate-fade-in">
                <div class="space-y-4">
                    <div class="flex items-center gap-3">
                        <span class="inline-flex items-center rounded-lg bg-indigo-600/10 px-3 py-1 text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-indigo-600/20">Settings</span>
                    </div>
                    <h1 class="text-5xl font-black tracking-tight text-slate-900 sm:text-6xl text-gradient">Settings</h1>
                    <p class="text-lg text-slate-500 max-w-2xl font-semibold leading-relaxed">Configure your workspace, integrations, and API credentials.</p>
                </div>

                <div class="space-y-12">

                    {/* ── Profile ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-2xl shadow-slate-200/50 space-y-10">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', 'bg-teal-600/10 text-teal-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Profile</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Inspector Identity · Shown on Reports</p>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-10">
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Full Name</label>
                                <div class="relative group">
                                    <div class="absolute -inset-0.5 bg-gradient-to-r from-teal-500 to-emerald-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                    <input type="text" id="profileName" placeholder="John Smith"
                                        class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-teal-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <p class="text-[10px] text-slate-400 font-bold ml-1">Displayed on inspection reports.</p>
                            </div>
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Phone</label>
                                <input type="tel" id="profilePhone" placeholder="(555) 123-4567"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-teal-600 outline-none transition-all font-bold text-sm" />
                            </div>
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">License #</label>
                                <input type="text" id="profileLicense" placeholder="HI-12345"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-teal-600 outline-none transition-all font-bold text-sm" />
                                <p class="text-[10px] text-slate-400 font-bold ml-1">State inspector license number.</p>
                            </div>
                        </div>

                        <div class="flex justify-end pt-2">
                            <button onclick="saveProfile()" id="saveProfileBtn"
                                class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95 disabled:bg-slate-300">
                                Save Profile
                            </button>
                        </div>
                    </section>

                    {/* ── Branding ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-2xl shadow-slate-200/50 space-y-10">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z', 'bg-indigo-600/10 text-indigo-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Branding</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Workspace Visual Identity</p>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-10">
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Workspace Name</label>
                                <div class="relative group">
                                    <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                    <input type="text" id="siteName" value={siteName}
                                        class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold text-sm" />
                                </div>
                            </div>
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Primary Theme</label>
                                <div class="flex gap-4">
                                    <input type="color" id="primaryColor" value={primaryColor}
                                        class="h-16 w-24 rounded-2xl border-0 ring-2 ring-slate-100 p-1.5 cursor-pointer bg-white transition-all hover:scale-105" />
                                    <div class="flex-1 relative group">
                                        <input type="text" value={primaryColor} readonly
                                            class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 bg-slate-50 text-slate-500 font-black text-xs uppercase tracking-widest cursor-default" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="space-y-4">
                            <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Company Logo</label>
                            <div class="flex flex-col sm:flex-row items-center gap-10 p-10 bg-slate-50/50 rounded-[2.5rem] border-2 border-dashed border-slate-200 group hover:border-indigo-300 transition-colors">
                                <div class="w-32 h-32 bg-white rounded-3xl border border-slate-100 shadow-xl flex items-center justify-center overflow-hidden">
                                    {logoUrl ? (
                                        <img id="logoPreview" src={logoUrl} class="w-full h-full object-contain p-4" />
                                    ) : (
                                        <div id="logoPlaceholder" class="text-slate-200">
                                            <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                        </div>
                                    )}
                                </div>
                                <div class="space-y-4 flex-1 text-center sm:text-left">
                                    <input type="file" id="logoInput" class="hidden" accept="image/*" onchange="handleLogoSelect(event)" />
                                    <button onclick="document.getElementById('logoInput').click()"
                                        class="premium-button px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm hover:border-indigo-600 hover:text-indigo-600 transition-all active:scale-95">
                                        Upload Asset
                                    </button>
                                    <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest">PNG/SVG recommended</p>
                                </div>
                            </div>
                        </div>

                        <div class="flex justify-end pt-2">
                            <button onclick="saveBranding()" id="saveBrandingBtn"
                                class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95 disabled:bg-slate-300">
                                Save Branding
                            </button>
                        </div>
                    </section>

                    {/* ── Analytics ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-100/50 space-y-8">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', 'bg-sky-600/10 text-sky-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Telemetry</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Google Analytics 4</p>
                            </div>
                        </div>
                        <div class="space-y-3">
                            <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">GA Measurement ID</label>
                            <input type="text" id="gaMeasurementId" value={gaMeasurementId} placeholder="G-XXXXXXXXXX"
                                class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-sky-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" />
                        </div>
                        <div class="flex justify-end">
                            <button onclick="saveBranding()" class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">
                                Save
                            </button>
                        </div>
                    </section>

                    {/* ── Email ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-100/50 space-y-8">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', 'bg-emerald-600/10 text-emerald-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Email Delivery</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resend · Password resets, invitations, reports</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Sender Email</label>
                                <input type="email" id="senderEmail" placeholder="Reports &lt;reports@yourdomain.com&gt;"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-emerald-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" />
                                <p class="text-[10px] text-slate-400 font-bold ml-1">Used as "From" address. Domain must be verified in Resend.</p>
                            </div>
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Resend API Key</label>
                                <input type="password" id="resendApiKey" placeholder="re_••••••••"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-emerald-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" autocomplete="off" />
                                <p class="text-[10px] text-slate-400 font-bold ml-1">Stored encrypted. Leave blank to keep existing key.</p>
                            </div>
                        </div>
                        <div class="flex justify-end">
                            <button onclick="saveSecrets('email')" class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">
                                Save
                            </button>
                        </div>
                    </section>

                    {/* ── Bot Protection ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-100/50 space-y-8">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', 'bg-amber-600/10 text-amber-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Bot Protection</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cloudflare Turnstile · Public booking form</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Site Key <span class="text-slate-400 normal-case font-normal">(public)</span></label>
                                <input type="text" id="turnstileSiteKey" placeholder="0x4AAAA..."
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-amber-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" />
                            </div>
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Secret Key <span class="text-slate-400 normal-case font-normal">(encrypted)</span></label>
                                <input type="password" id="turnstileSecretKey" placeholder="••••••••"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-amber-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" autocomplete="off" />
                            </div>
                        </div>
                        <div class="flex justify-end">
                            <button onclick="saveSecrets('turnstile')" class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">
                                Save
                            </button>
                        </div>
                    </section>

                    {/* ── AI ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-100/50 space-y-8">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M13 10V3L4 14h7v7l9-11h-7z', 'bg-violet-600/10 text-violet-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">AI Features</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Google Gemini · Comment assist, inspection summary</p>
                            </div>
                        </div>
                        <div class="space-y-3 max-w-xl">
                            <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Gemini API Key</label>
                            <input type="password" id="geminiApiKey" placeholder="AIza••••••••"
                                class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-violet-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" autocomplete="off" />
                            <p class="text-[10px] text-slate-400 font-bold ml-1">Get a key at <span class="text-slate-600">aistudio.google.com</span>. Stored encrypted.</p>
                        </div>
                        <div class="flex justify-end">
                            <button onclick="saveSecrets('ai')" class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">
                                Save
                            </button>
                        </div>
                    </section>

                    {/* ── Integrations ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-100/50 space-y-8">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', 'bg-rose-600/10 text-rose-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Integrations</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Google Calendar OAuth · App URL</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 gap-8">
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">App Base URL</label>
                                <input type="url" id="appBaseUrl" placeholder="https://inspect.yourdomain.com"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-rose-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" />
                                <p class="text-[10px] text-slate-400 font-bold ml-1">Used for OAuth redirect URIs and email links.</p>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div class="space-y-3">
                                    <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Google Client ID <span class="text-slate-400 normal-case font-normal">(public)</span></label>
                                    <input type="text" id="googleClientId" placeholder="00000000-xxxx.apps.googleusercontent.com"
                                        class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-rose-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" />
                                </div>
                                <div class="space-y-3">
                                    <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Google Client Secret <span class="text-slate-400 normal-case font-normal">(encrypted)</span></label>
                                    <input type="password" id="googleClientSecret" placeholder="GOCSP••••••••"
                                        class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-rose-600 outline-none transition-all font-bold text-sm placeholder:text-slate-300" autocomplete="off" />
                                </div>
                            </div>
                        </div>
                        <div class="flex justify-end">
                            <button onclick="saveIntegration()" class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">
                                Save
                            </button>
                        </div>
                    </section>

                    {/* ── Apple Calendar / ICS Subscription ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-100/50 space-y-8">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', 'bg-slate-600/10 text-slate-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Apple Calendar</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">ICS Subscription · Read-only</p>
                            </div>
                        </div>
                        <p class="text-sm text-slate-500 max-w-2xl">Subscribe to your inspections in Apple Calendar, Google Calendar, or any app that supports ICS feeds.</p>
                        <div class="flex flex-col sm:flex-row gap-4">
                            <input id="icsUrl" type="text" readonly
                                class="flex-1 px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 bg-slate-50 text-slate-600 font-mono text-xs"
                                placeholder="Loading subscription URL..." />
                            <button onclick="copyIcsUrl()" id="copyIcsBtn"
                                class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">
                                Copy Link
                            </button>
                        </div>
                        <p class="text-[10px] text-slate-400 font-bold ml-1">In Apple Calendar: File → New Calendar Subscription → paste URL.</p>
                    </section>

                    {/* ── Password ── */}
                    <section class="glass-panel p-10 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-100/50 space-y-8">
                        <div class="flex items-center gap-5 pb-6 border-b border-slate-100/50">
                            {sectionIcon('M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', 'bg-slate-600/10 text-slate-600')}
                            <div>
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Change Password</h2>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Account Security</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Current Password</label>
                                <input type="password" id="currentPassword"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-slate-600 outline-none transition-all font-bold text-sm" />
                            </div>
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">New Password</label>
                                <input type="password" id="newPassword"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-slate-600 outline-none transition-all font-bold text-sm" />
                            </div>
                            <div class="space-y-3">
                                <label class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Confirm New Password</label>
                                <input type="password" id="confirmPassword"
                                    class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-slate-600 outline-none transition-all font-bold text-sm" />
                            </div>
                        </div>
                        <div class="flex justify-end">
                            <button onclick="changePassword()" class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">
                                Update Password
                            </button>
                        </div>
                    </section>

                </div>

                {/* ── Build Info ── */}
                <div class="flex items-center justify-between px-2 pt-2 pb-6 border-t border-slate-100">
                    <span class="text-[11px] text-slate-400 font-mono">
                        commit <a href={`https://github.com/InspectorHub/OpenInspection/commit/${BUILD.commit}`}
                            target="_blank" rel="noopener noreferrer"
                            class="text-slate-600 font-bold hover:text-indigo-600 transition-colors">{BUILD.shortCommit}</a>
                    </span>
                    <span class="text-[11px] text-slate-400">
                        Built {new Date(BUILD.buildTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                </div>

                <script src="/js/auth.js"></script>
                <script src="/js/settings.js"></script>
            </div>
        </MainLayout>
    );
};
