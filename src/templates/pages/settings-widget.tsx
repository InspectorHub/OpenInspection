import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const SettingsWidgetPage = ({ branding }: Props) => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Embed Booking Widget`} branding={branding}>
            <div class="space-y-10 animate-fade-in">
                <div>
                    <span class="px-4 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-[0.2em]">Widget</span>
                    <h1 class="mt-3 text-5xl font-black tracking-tight text-slate-900 sm:text-6xl text-gradient">Embed Booking Widget</h1>
                    <p class="mt-2 text-lg text-slate-500 max-w-2xl font-semibold leading-relaxed">Paste a snippet on your marketing site. Bookings flow into your inspections list.</p>
                </div>

                <section class="glass-panel p-10 md:p-12 rounded-2xl shadow-xl shadow-slate-100/50 space-y-6">
                    <h2 class="text-2xl font-black text-slate-900 tracking-tightest">1 · Allowed Origins</h2>
                    <p class="text-sm text-slate-500">List the domains where you'll embed the widget. One per line. Use <code>{'https://*.example.com'}</code> for wildcard subdomains.</p>
                    <textarea id="widgetOrigins" rows={6}
                        class="premium-input w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-mono text-sm placeholder:text-slate-300"
                        placeholder={'https://www.acmeinspections.com\nhttps://*.acmeinspections.com'}></textarea>
                    <div class="flex justify-end">
                        <button id="saveOriginsBtn" class="premium-button px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-black transition-all active:scale-95">Save Origins</button>
                    </div>
                </section>

                <section class="glass-panel p-10 md:p-12 rounded-2xl shadow-xl shadow-slate-100/50 space-y-6">
                    <h2 class="text-2xl font-black text-slate-900 tracking-tightest">2 · Style</h2>
                    <div class="flex gap-3 flex-wrap">
                        <button class="widget-style-btn px-6 py-3 rounded-2xl ring-2 ring-slate-200 font-bold text-sm" data-style="light">☀ Light</button>
                        <button class="widget-style-btn px-6 py-3 rounded-2xl ring-2 ring-slate-200 font-bold text-sm" data-style="dark">🌙 Dark</button>
                        <button class="widget-style-btn px-6 py-3 rounded-2xl ring-2 ring-slate-200 font-bold text-sm" data-style="branded">🎨 Branded</button>
                    </div>
                </section>

                <section class="glass-panel p-10 md:p-12 rounded-2xl shadow-xl shadow-slate-100/50 space-y-6">
                    <h2 class="text-2xl font-black text-slate-900 tracking-tightest">3 · Snippet</h2>
                    <p class="text-sm text-slate-500">Copy and paste this into your site where the booking form should appear.</p>
                    <pre id="widgetSnippet" class="bg-slate-900 text-emerald-300 p-5 rounded-2xl overflow-x-auto text-xs font-mono"></pre>
                    <div class="flex justify-end gap-3">
                        <button id="copySnippetBtn" class="px-5 py-3 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all">Copy Snippet</button>
                    </div>
                </section>

                <section class="glass-panel p-10 md:p-12 rounded-2xl shadow-xl shadow-slate-100/50 space-y-6">
                    <h2 class="text-2xl font-black text-slate-900 tracking-tightest">4 · Live Preview</h2>
                    <iframe id="widgetPreview" class="w-full min-h-[700px] rounded-2xl border border-slate-200" loading="lazy"></iframe>
                </section>

                <script src="/js/auth.js"></script>
                <script src="/js/toast.js"></script>
                <script src="/js/settings-widget.js"></script>
            </div>
        </MainLayout>
    );
};
