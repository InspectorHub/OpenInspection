import { BareLayout } from '../layouts/main-layout';
import { AtmosphericBg } from '../components/atmospheric-bg';
import { BrandingConfig } from '../../types/auth';

export const SetupPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    
    return (
        <BareLayout title={`System Setup | ${siteName}`} branding={branding}>
            <div class="relative min-h-screen flex flex-col justify-center py-12 px-6 lg:px-8 overflow-hidden font-sans">
                <AtmosphericBg />

                <div class="sm:mx-auto sm:w-full sm:max-w-md animate-fade-in">
                    <div class="flex justify-center mb-8">
                        <div class="w-16 h-16 bg-emerald-600 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-emerald-200 ring-8 ring-white">
                             <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                        </div>
                    </div>
                    <h2 class="text-center text-4xl font-black tracking-tight text-slate-900 leading-tight">Welcome to {siteName}</h2>
                    <p class="mt-4 text-center text-sm font-semibold text-slate-500 uppercase tracking-widest">First-Time Setup</p>
                </div>

                <div class="mt-12 sm:mx-auto sm:w-full sm:max-w-[480px] animate-fade-in" style="animation-delay: 0.1s;">
                    <div class="glass-panel px-10 py-16 rounded-[3rem]">
                        <form id="setupForm" class="space-y-8">
                            <div>
                                <label for="companyName" class="block text-sm font-black text-slate-900 tracking-tight ml-1 mb-3 uppercase">Business Name</label>
                                <div class="relative group">
                                    <div class="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                    <input id="companyName" name="companyName" type="text" required placeholder="Acme Inspections"
                                        class="premium-input relative block w-full rounded-2xl border-0 py-5 text-slate-900 ring-2 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-600 sm:text-sm sm:leading-6 pl-6 transition-all" />
                                </div>
                            </div>

                            <div>
                                <label for="email" class="block text-sm font-black text-slate-900 tracking-tight ml-1 mb-3 uppercase">Admin Email</label>
                                <div class="relative group">
                                    <div class="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                    <input id="email" name="email" type="email" autocomplete="email" required placeholder="admin@company.com"
                                        class="premium-input relative block w-full rounded-2xl border-0 py-5 text-slate-900 ring-2 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-600 sm:text-sm sm:leading-6 pl-6 transition-all" />
                                </div>
                            </div>

                            <div>
                                <label for="password" class="block text-sm font-black text-slate-900 tracking-tight ml-1 mb-3 uppercase">Password</label>
                                <div class="relative group">
                                    <div class="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                    <input id="password" name="password" type="password" required placeholder="••••••••"
                                        class="premium-input relative block w-full rounded-2xl border-0 py-5 text-slate-900 ring-2 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-600 sm:text-sm sm:leading-6 pl-6 transition-all" />
                                </div>
                                <p class="mt-2 ml-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider">Minimum 8 characters</p>
                            </div>

                            <div>
                                <label for="verificationCode" class="block text-sm font-black text-slate-900 tracking-tight ml-1 mb-3 uppercase">Verification Code</label>
                                <div class="relative group">
                                    <div class="absolute -inset-0.5 bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                    <input id="verificationCode" name="verificationCode" type="text" required placeholder="000000"
                                        class="premium-input relative block w-full rounded-2xl border-0 py-5 text-slate-900 ring-2 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-orange-600 sm:text-sm sm:leading-6 pl-6 transition-all" />
                                </div>
                                <p class="mt-2 ml-1 text-[11px] text-slate-500 font-medium leading-relaxed">
                                    Find the 6-digit code in your Cloudflare deployment logs,
                                    or check the <code class="px-1 py-0.5 bg-slate-100 rounded text-slate-700 font-mono">setup_verification_code</code> key in KV namespace.
                                </p>
                            </div>

                            <div>
                                <button type="submit" id="submitBtn" 
                                    class="premium-button flex w-full justify-center rounded-2xl bg-emerald-600 px-6 py-5 text-base font-bold text-white shadow-xl shadow-emerald-100 hover:bg-slate-900 hover:shadow-emerald-200 active:scale-95 disabled:bg-slate-300 transition-all">
                                    Create Account
                                </button>
                            </div>
                        </form>
                        
                        <div id="errorMsg" class="mt-6 p-4 rounded-xl bg-red-50 text-center text-sm text-red-600 font-bold border border-red-100 hidden animate-fade-in"></div>

                        <div class="mt-12 flex items-center justify-center gap-2">
                             <div class="h-px bg-slate-100 flex-1"></div>
                             <span class="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] px-4">Self-Hosted</span>
                             <div class="h-px bg-slate-100 flex-1"></div>
                        </div>
                    </div>
                </div>
            </div>
            <script src="/js/setup.js"></script>
        </BareLayout>
    );
};
