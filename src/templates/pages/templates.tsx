import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const TemplatesPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Templates`} branding={branding}>
            <div class="animate-slide-in space-y-12">
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div>
                        <div class="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black uppercase tracking-widest mb-4 ring-1 ring-indigo-100">
                            <span class="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                            Workflow Engineering
                        </div>
                        <h1 class="text-5xl font-black tracking-tightest text-slate-900 mb-4">Templates</h1>
                        <p class="text-lg text-slate-500 font-semibold max-w-2xl leading-relaxed">Define professional checklist schemas that power your inspection process.</p>
                    </div>
                    <button type="button" onclick="showCreateModal()" class="premium-button flex items-center justify-center gap-2 px-8 py-4 rounded-2xl shadow-2xl shadow-indigo-100/20 bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all font-bold">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        New Template
                    </button>
                </div>

                {/* Templates List */}
                <div class="glass-panel rounded-[2.5rem] overflow-hidden shadow-2xl shadow-indigo-100/5">
                    <div class="overflow-x-auto">
                        <table class="min-w-full">
                            <thead>
                                <tr class="bg-slate-50/50">
                                    <th scope="col" class="py-6 pl-10 pr-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Template Logic</th>
                                    <th scope="col" class="px-6 py-6 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Revision</th>
                                    <th scope="col" class="px-6 py-6 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Data Points</th>
                                    <th scope="col" class="relative py-6 pl-3 pr-10"><span class="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody id="templatesList" class="divide-y divide-slate-100">
                                <tr id="loadingRow">
                                    <td colspan={4} class="py-32 text-center">
                                        <div class="flex flex-col items-center gap-4">
                                            <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin shadow-xl shadow-indigo-100"></div>
                                            <p class="text-sm font-bold text-slate-400 animate-pulse">Syncing Template Repository...</p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Create Template Modal */}
                <div id="createModal" class="fixed inset-0 z-[100] hidden overflow-y-auto px-4 py-12 sm:px-0">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-md transition-opacity" onclick="closeModal()"></div>
                    <div class="flex min-h-full items-center justify-center">
                        <div class="relative w-full max-w-xl transform overflow-hidden rounded-[2.5rem] bg-white p-12 text-left shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] animate-slide-in">
                            <div class="absolute top-8 right-8">
                                <button onclick="closeModal()" class="p-3 text-slate-400 hover:text-slate-900 rounded-2xl hover:bg-slate-50 transition-all active:scale-95">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                            <div class="mb-10">
                                <h3 class="text-3xl font-black text-slate-900 mb-3 tracking-tightest leading-tight">Engineer New Template</h3>
                                <p class="text-lg text-slate-400 font-medium">Define a high-fidelity inspection checklist.</p>
                            </div>
                            <div class="space-y-8">
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Template Label</label>
                                    <input type="text" id="tplName" placeholder="e.g., Luxury Residential Standard"
                                        class="premium-input w-full px-6 py-4.5 rounded-2xl border-2 border-slate-100 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-semibold" />
                                </div>
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Logic Schema (JSON)</label>
                                    <p class="text-[10px] text-slate-300 uppercase tracking-tighter mb-2 ml-1">Format: <code class="bg-slate-50 px-1 rounded">{`{"id":"id","label":"Label"}`}</code></p>
                                    <textarea id="tplSchema" rows={8} placeholder={'[\n  {"id":"structure","label":"Structural Integrity"},\n  {"id":"electrical","label":"Electrical Systems"}\n]'}
                                        class="w-full px-6 py-4.5 rounded-2xl border-2 border-slate-100 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-mono text-xs resize-none leading-relaxed"></textarea>
                                </div>
                                <div class="pt-4 flex gap-6">
                                    <button type="button" onclick="closeModal()" class="flex-1 py-4.5 rounded-2xl font-black text-slate-400 hover:text-slate-900 transition-all uppercase text-[10px] tracking-widest">
                                        Discard
                                    </button>
                                    <button type="button" onclick="submitTemplate()" id="submitTplBtn" class="flex-[2] premium-button py-4.5 rounded-2xl bg-indigo-600 text-white font-bold shadow-2xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all">
                                        Deploy Template
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/templates.js"></script>
            </div>
        </MainLayout>
    );
};
