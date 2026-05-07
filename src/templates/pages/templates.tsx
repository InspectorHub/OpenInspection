import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';

export const TemplatesPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Templates`} branding={branding}>
            <div class="animate-slide-in space-y-12">
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <div class="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold uppercase tracking-widest mb-4 ring-1 ring-indigo-100">
                            <span class="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                            Templates
                        </div>
                        <h1 class="text-3xl font-bold tracking-tight text-slate-900 mb-4">Templates</h1>
                        <p class="text-lg text-slate-500 font-semibold max-w-2xl leading-relaxed">Manage your inspection checklists.</p>
                    </div>
                    <button type="button" onclick="showCreateModal()" class="premium-button flex items-center justify-center gap-2 px-4 py-1.5 text-sm rounded-md shadow-md/20 bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all font-bold">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        New Template
                    </button>
                </div>

                {/* Templates List */}
                <div class="glass-panel rounded-xl overflow-hidden shadow-md/5">
                    <div class="overflow-x-auto">
                        <table class="min-w-full">
                            <thead>
                                <tr class="bg-slate-50/50">
                                    <th scope="col" class="py-6 pl-10 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</th>
                                    <th scope="col" class="px-6 py-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Version</th>
                                    <th scope="col" class="px-6 py-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Items</th>
                                    <th scope="col" class="relative py-6 pl-3 pr-10"><span class="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody id="templatesList" class="divide-y divide-slate-100">
                                <tr id="loadingRow">
                                    <td colspan={4} class="py-32 text-center">
                                        <div class="flex flex-col items-center gap-4">
                                            <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin shadow-md"></div>
                                            <p class="text-sm font-bold text-slate-400 animate-pulse">Loading templates...</p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Create Template Modal */}
                <Modal
                    id="createModal"
                    title="New Template"
                    subtitle="Create an inspection checklist."
                    size="xl"
                    footer={
                        <ModalFooter
                            onCancelJs="closeModal()"
                            onConfirmJs="submitTemplate()"
                            confirmText="Create Template"
                            confirmId="submitTplBtn"
                        />
                    }
                >
                    <div class="space-y-4">
                        <div class="space-y-2">
                            <label class="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Template Name</label>
                            <input type="text" id="tplName" placeholder="e.g., Luxury Residential Standard"
                                class="premium-input w-full px-3 py-2.5 rounded-2xl border-2 border-slate-100 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-semibold" />
                        </div>
                        <p class="text-sm text-slate-400 font-medium leading-relaxed">
                            After creating the template, you will be taken to the visual editor where you can add sections and inspection items.
                        </p>
                    </div>
                </Modal>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/templates.js"></script>
            </div>
        </MainLayout>
    );
};
