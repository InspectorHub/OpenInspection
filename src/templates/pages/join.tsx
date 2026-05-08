import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const JoinPage = ({ token, branding }: { token?: string, branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <BareLayout title={`Join ${siteName}`} branding={branding}>
            <div class="min-h-screen flex items-center justify-center p-6 relative bg-slate-50 overflow-hidden">
                <div class="w-full max-w-md relative z-10 animate-slide-in">
                    <div class="glass-panel p-6 rounded-xl shadow-[0_50px_100px_-20px_rgba(0,0,0,0.12)]">
                        <div class="text-center mb-6">
                            <div class="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-md shadow-md mb-6 group hover:rotate-6 transition-transform">
                                <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                            </div>
                            <h1 class="text-2xl font-bold tracking-tight text-slate-900 mb-2">Join Team</h1>
                            <p class="text-slate-400 font-medium leading-relaxed">You've been invited to collaborate on <span class="text-indigo-600 font-bold">{siteName}</span>.</p>
                        </div>
                        
                        <form id="joinForm" class="space-y-4">
                            <input type="hidden" id="token" name="token" value={token || ''} />
                            
                            <div class="space-y-2">
                                <label for="password" class="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Create Your Password</label>
                                <input id="password" name="password" type="password" autocomplete="new-password" required placeholder="••••••••"
                                    class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                            </div>

                            <button type="submit" id="submitBtn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-sm hover:bg-indigo-700 active:scale-[.98] transition-all disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-3 group">
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
