import { BareLayout } from '../layouts/main-layout';
import { AtmosphericBg } from '../components/atmospheric-bg';
import { BrandingConfig } from '../../types/auth';

export const NotFoundPage = (props: { 
    title?: string | undefined, 
    message?: string | undefined, 
    showSetupCTA?: boolean | undefined,
    branding?: BrandingConfig | undefined 
}): JSX.Element => {
    const { title = 'Workspace Not Found', message, showSetupCTA, branding } = props;
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <BareLayout title={`${siteName} | ${title}`} branding={branding}>
            <div class="relative min-h-screen flex items-center justify-center py-20 px-6 lg:px-8 font-sans overflow-hidden">
                <AtmosphericBg />

                <div class="max-w-xl w-full text-center animate-fade-in">
                    <div class="glass-panel p-12 md:p-20 rounded-[4rem] shadow-2xl shadow-slate-200/50 border border-white/40">
                        <div class="mb-12">
                            <div class="w-24 h-24 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-10 shadow-inner group">
                                <svg class="w-10 h-10 text-slate-400 group-hover:text-indigo-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>
                            
                            <h1 class="text-5xl font-black text-slate-900 tracking-tightest mb-6 leading-none text-gradient">{title}</h1>
                            <p class="text-slate-500 text-lg font-semibold tracking-tight leading-relaxed max-w-sm mx-auto">
                                {message || 'The application signature for this domain could not be resolved within our current cluster.'}
                            </p>
                        </div>

                        {showSetupCTA ? (
                            <div class="space-y-6">
                                <div class="p-6 bg-emerald-50/50 rounded-3xl border border-emerald-100/50">
                                    <p class="text-emerald-700 text-sm font-bold tracking-tight">
                                        System Uninitialized: No workspaces detected.
                                    </p>
                                </div>
                                <a
                                    href="/setup"
                                    class="premium-button inline-flex items-center justify-center px-10 py-6 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase tracking-[0.3em] shadow-[0_20px_50px_rgba(0,0,0,0.2)] hover:bg-black transition-all active:scale-95 w-full"
                                >
                                    Initialize Platform Architecture
                                </a>
                            </div>
                        ) : (
                            <div class="flex flex-col gap-4">
                                <a
                                    href="/login"
                                    class="premium-button inline-flex items-center justify-center px-10 py-6 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase tracking-[0.3em] shadow-[0_20px_50px_rgba(0,0,0,0.2)] hover:bg-black transition-all active:scale-95 w-full"
                                >
                                    Return to Authentication
                                </a>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-4">
                                    Error Code: RESOLVER_MISSING_TENANT
                                </p>
                            </div>
                        )}
                    </div>

                    <div class="mt-12">
                        <span class="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] leading-none">OpenInspection v1.0.0</span>
                    </div>
                </div>
            </div>
        </BareLayout>
    );
};
