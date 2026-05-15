import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';
import { MarketplaceDuplicateBanner } from '../components/marketplace-duplicate-banner';

export const TemplatesPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Templates`} branding={branding}>
            <div class="animate-slide-in space-y-6">
                <div x-data="templatesMeta">
                    <PageHeader
                        eyebrow="LIBRARY · TEMPLATES"
                        eyebrowColor="slate"
                        title="Inspection Templates"
                        meta={<span x-text="metaText"></span>}
                        actions={
                            <button
                                type="button"
                                onclick="showCreateModal()"
                                class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                New Template
                            </button>
                        }
                    />
                </div>

                {/* Marketplace duplicate banner — shows when same marketplace template
                    has been imported more than once (Sprint 1 B-8). */}
                <MarketplaceDuplicateBanner />

                {/* Templates List */}
                <div class="glass-panel rounded-xl overflow-hidden shadow-md/5">
                    <div class="overflow-x-auto">
                        <table class="min-w-full">
                            <thead>
                                <tr class="bg-slate-50/50 dark:bg-slate-800/50">
                                    <th scope="col" class="py-6 pl-10 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Name</th>
                                    <th scope="col" class="px-6 py-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Version</th>
                                    <th scope="col" class="px-6 py-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Items</th>
                                    <th scope="col" class="relative py-6 pl-3 pr-10"><span class="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody id="templatesList" class="divide-y divide-slate-100 dark:divide-slate-700/50">
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
                                class="premium-input w-full px-3 py-2.5 rounded-md border-2 border-slate-100 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-semibold" />
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
