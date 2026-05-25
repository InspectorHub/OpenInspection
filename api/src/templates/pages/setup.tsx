import { BareLayout } from '../layouts/main-layout';
import { AtmosphericBg } from '../components/atmospheric-bg';
import { BrandingConfig } from '../../types/auth';

export const SetupPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    
    return (
        <BareLayout title={`System Setup | ${siteName}`} branding={branding}>
            <div class="relative min-h-screen flex flex-col justify-center py-6 px-6 lg:px-8 overflow-hidden font-sans">
                <AtmosphericBg />

                <div class="sm:mx-auto sm:w-full sm:max-w-md animate-fade-in">
                    <div class="flex justify-center mb-8">
                        <div class="w-16 h-16 bg-emerald-600 rounded-lg flex items-center justify-center shadow-2xl shadow-md ring-8 ring-white">
                             <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                        </div>
                    </div>
                    <h2 class="text-center text-2xl font-bold tracking-tight text-slate-900 leading-tight">Welcome to {siteName}</h2>
                    <p class="mt-4 text-center text-sm font-semibold text-slate-500 uppercase tracking-widest">First-Time Setup</p>
                </div>

                <div class="mt-12 sm:mx-auto sm:w-full sm:max-w-[480px] animate-fade-in" style="animation-delay: 0.1s;">
                    <div class="glass-panel px-10 py-10 rounded-xl">
                        <form id="setupForm" class="space-y-4">
                            <div>
                                <label for="companyName" class="block text-sm font-bold text-slate-900 tracking-tight ml-1 mb-3 uppercase">Business Name</label>
                                <input id="companyName" name="companyName" type="text" required placeholder="Acme Inspections"
                                    class="block w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-[3px] focus:ring-indigo-500/30 outline-none transition-all font-medium text-sm placeholder:text-slate-400" />
                            </div>

                            <div>
                                <label for="adminName" class="block text-sm font-bold text-slate-900 tracking-tight ml-1 mb-3 uppercase">Your Name</label>
                                <input id="adminName" name="adminName" type="text" autocomplete="name" required placeholder="Mike Reynolds"
                                    class="block w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-[3px] focus:ring-indigo-500/30 outline-none transition-all font-medium text-sm placeholder:text-slate-400" />
                                <p class="mt-2 ml-1 text-[11px] text-slate-500 font-medium leading-relaxed">Shown on your public booking link, signed agreements, and invoices.</p>
                            </div>

                            <div>
                                <label for="email" class="block text-sm font-bold text-slate-900 tracking-tight ml-1 mb-3 uppercase">Admin Email</label>
                                <input id="email" name="email" type="email" autocomplete="email" required placeholder="admin@company.com"
                                    class="block w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-[3px] focus:ring-indigo-500/30 outline-none transition-all font-medium text-sm placeholder:text-slate-400" />
                            </div>

                            <div>
                                <label for="password" class="block text-sm font-bold text-slate-900 tracking-tight ml-1 mb-3 uppercase">Password</label>
                                <input id="password" name="password" type="password" required placeholder="••••••••"
                                    class="block w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-[3px] focus:ring-indigo-500/30 outline-none transition-all font-medium text-sm placeholder:text-slate-400" />
                                <p class="mt-2 ml-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider">Minimum 8 characters</p>
                            </div>

                            <div>
                                <label for="verificationCode" class="block text-sm font-bold text-slate-900 tracking-tight ml-1 mb-3 uppercase">Verification Code</label>
                                <input id="verificationCode" name="verificationCode" type="text" required placeholder="000000"
                                    class="block w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-[3px] focus:ring-indigo-500/30 outline-none transition-all font-medium text-sm placeholder:text-slate-400" />
                                <p class="mt-2 ml-1 text-[11px] text-slate-500 font-medium leading-relaxed">
                                    Find the 6-digit code in your Cloudflare deployment logs,
                                    or check the <code class="px-1 py-0.5 bg-slate-100 rounded text-slate-700 font-mono">setup_verification_code</code> key in KV namespace.
                                </p>
                            </div>

                            <div>
                                <button type="submit" id="submitBtn"
                                    class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-sm hover:bg-indigo-700 active:scale-[.98] transition-all disabled:bg-slate-300 disabled:cursor-not-allowed flex justify-center">
                                    Create Account
                                </button>
                            </div>

                            <div class="flex justify-center pt-2">
                                <button type="button" id="skipBtn" onclick="confirmSkip()"
                                        class="text-sm text-slate-500 hover:text-slate-900 font-semibold transition-colors">
                                    Skip for now →
                                </button>
                            </div>
                        </form>

                        <div id="errorMsg" class="mt-6 p-4 rounded-xl bg-red-50 text-center text-sm text-red-600 font-bold border border-red-100 hidden animate-fade-in"></div>

                        <div class="mt-12 flex items-center justify-center gap-2">
                             <div class="h-px bg-slate-100 flex-1"></div>
                             <span class="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em] px-4">Self-Hosted</span>
                             <div class="h-px bg-slate-100 flex-1"></div>
                        </div>
                    </div>
                </div>
            </div>
            <script src="/js/setup.js"></script>
        </BareLayout>
    );
};
