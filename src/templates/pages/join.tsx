import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const JoinPage = ({ token, branding }: { token?: string, branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <BareLayout title={`Join ${siteName}`} branding={branding}>
            <div class="min-h-screen flex items-center justify-center p-6 relative bg-slate-50 overflow-hidden">
                {/* Atmospheric Background */}
                <div class="fixed inset-0 pointer-events-none overflow-hidden select-none">
                    <div class="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-indigo-500/10 blur-[120px] rounded-full animate-float"></div>
                    <div class="absolute -bottom-[10%] -right-[10%] w-[50%] h-[50%] bg-blue-500/10 blur-[120px] rounded-full animate-float" style="animation-delay: -2s"></div>
                </div>

                <div class="w-full max-w-md relative z-10 animate-slide-in">
                    <div class="glass-panel p-6 rounded-xl shadow-[0_50px_100px_-20px_rgba(0,0,0,0.12)]">
                        <div class="text-center mb-10">
                            <div class="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl shadow-2xl shadow-indigo-200 mb-6 group hover:rotate-6 transition-transform">
                                <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                            </div>
                            <h1 class="text-4xl font-black tracking-tightest text-slate-900 mb-2">Join Team</h1>
                            <p class="text-slate-400 font-medium leading-relaxed">You've been invited to collaborate on <span class="text-indigo-600 font-bold">{siteName}</span>.</p>
                        </div>
                        
                        <form id="joinForm" class="space-y-8">
                            <input type="hidden" id="token" name="token" value={token || ''} />
                            
                            <div class="space-y-2">
                                <label for="password" class="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Create Your Password</label>
                                <input id="password" name="password" type="password" autocomplete="new-password" required placeholder="••••••••"
                                    class="premium-input w-full px-6 py-4.5 rounded-2xl border-2 border-slate-100 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-semibold" />
                            </div>

                            <button type="submit" id="submitBtn" class="premium-button w-full py-5 bg-indigo-600 text-white rounded-2xl font-bold shadow-2xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-3 group">
                                <span>Accept Invitation</span>
                                <svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                            </button>
                        </form>
                        
                        <div id="joinError" class="mt-6 text-center text-xs font-bold text-red-500 uppercase tracking-widest hidden animate-shake"></div>
                    </div>
                    
                    <p class="mt-8 text-center text-[10px] text-slate-300 font-bold uppercase tracking-[0.2em] leading-relaxed">
                        Securely managed by {siteName} Cloud.<br/>
                        &copy; {new Date().getFullYear()} Precision Logic.
                    </p>
                </div>
            </div>
            <script src="/js/join.js"></script>
        </BareLayout>
    );
};
