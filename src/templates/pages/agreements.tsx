import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const AgreementsPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Agreements`} branding={branding}>
            <div class="animate-slide-in flex flex-col space-y-[18px]" style="min-height: calc(100vh - 5rem);">
                <div x-data="agreementsMeta">
                    <PageHeader
                        eyebrow="LIBRARY · AGREEMENTS"
                        eyebrowColor="slate"
                        title="Agreements"
                        meta={<span x-text="metaText"></span>}
                        actions={
                            <button
                                type="button"
                                onclick="showCreateModal()"
                                class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                New Agreement
                            </button>
                        }
                    />
                </div>

                {/* Tabs: Templates / Signing Requests (Spec 5H P2) */}
                <div x-data="{ tab: 'templates', requests: [], reqLoading: false, async loadRequests() { if (this.requests.length) return; this.reqLoading = true; try { const r = await authFetch('/api/admin/agreements/requests'); const j = await r.json(); this.requests = j.data?.requests || []; } finally { this.reqLoading = false; } } }" class="flex-1 flex flex-col">
                    <div class="flex items-center gap-1 mb-4 border-b border-slate-200 dark:border-slate-700">
                        <button x-on:click="tab = 'templates'" x-bind:class="tab === 'templates' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'"
                            class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors">Templates</button>
                        <button x-on:click="tab = 'requests'; loadRequests()" x-bind:class="tab === 'requests' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'"
                            class="px-4 py-2 text-sm font-semibold border-b-2 transition-colors">Signing Requests</button>
                    </div>

                    {/* Templates list */}
                    <div x-show="tab === 'templates'" class="glass-panel rounded-xl overflow-hidden shadow-md/5 flex-1 flex flex-col">
                        <div class="overflow-x-auto flex-1">
                            <table class="min-w-full h-full">
                                <thead>
                                    <tr class="bg-slate-50/50 dark:bg-slate-700/50">
                                        <th scope="col" class="py-3 pl-4 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-400">Agreement Name</th>
                                        <th scope="col" class="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-400">Version</th>
                                        <th scope="col" class="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-400">Effective Date</th>
                                        <th scope="col" class="relative py-3 pl-3 pr-4"><span class="sr-only">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody id="agreementsList" class="divide-y divide-slate-100 dark:divide-slate-700">
                                    <tr id="loadingRow">
                                        <td colspan={4} class="py-32 text-center">
                                            <div class="flex flex-col items-center gap-4">
                                                <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin shadow-md"></div>
                                                <span class="sr-only">Loading…</span><div aria-busy="true" class="ih-skeleton ih-skeleton--text" style="width: 30%; height: 0.875rem;"></div>
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Signing Requests list */}
                    <div x-show="tab === 'requests'" x-cloak class="glass-panel rounded-xl overflow-hidden shadow-md/5 flex-1 flex flex-col">
                        <div class="overflow-x-auto flex-1">
                            <table class="min-w-full">
                                <thead>
                                    <tr class="bg-slate-50/50 dark:bg-slate-700/50">
                                        <th class="py-4 pl-6 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Client</th>
                                        <th class="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Agreement</th>
                                        <th class="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                                        <th class="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Sent</th>
                                        <th class="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Signed</th>
                                        <th class="px-4 py-4 pr-6"><span class="sr-only">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-700">
                                    <tr aria-busy="true"><td colspan={6} class="px-4 py-3"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 80%; margin: 0 auto;"></div></td></tr>
                                    <tr aria-busy="true"><td colspan={6} class="px-4 py-3"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 65%; margin: 0 auto;"></div></td></tr>
                                    <tr x-show="!reqLoading && requests.length === 0"><td colspan={6} class="py-16 text-center text-sm text-slate-400 italic">No signing requests yet. Use a template's "Send" action.</td></tr>
                                    <template x-for="r in requests" x-bind:key="r.id">
                                        <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-700/50">
                                            <td class="py-3 pl-6 pr-3 text-sm">
                                                <div class="font-semibold text-slate-900 dark:text-slate-100" x-text="r.clientName || '—'"></div>
                                                <div class="text-[11px] text-slate-500 dark:text-slate-400" x-text="r.clientEmail"></div>
                                            </td>
                                            <td class="px-4 py-3 text-sm text-slate-700 dark:text-slate-300" x-text="r.agreementName || '—'"></td>
                                            <td class="px-4 py-3">
                                                <span class="ih-pill"
                                                    x-bind:style="r.status === 'signed' ? 'background:#dcfce7;color:#15803d' : (r.status === 'declined' ? 'background:#fee2e2;color:#b91c1c' : (r.status === 'viewed' ? 'background:#dbeafe;color:#1d4ed8' : 'background:#fef3c7;color:#b45309'))"
                                                    x-text="r.status"></span>
                                            </td>
                                            <td class="px-4 py-3 text-[11px] font-mono text-slate-500" x-text="r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'"></td>
                                            <td class="px-4 py-3 text-[11px] font-mono text-slate-500" x-text="r.signedAt ? new Date(r.signedAt).toLocaleString() : '—'"></td>
                                            <td class="px-4 py-3 pr-6 text-right">
                                                <a x-bind:href="'/verify/' + r.id" target="_blank" class="text-xs font-semibold text-indigo-600 hover:underline">Verify ›</a>
                                            </td>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Create Agreement Modal — external JS toggles the title via
                    id="modalAgreementTitle" (Create vs Edit), so the Modal renders
                    with hideHeader and a custom in-body header keeps the id intact. */}
                <Modal
                    id="createModal"
                    size="2xl"
                    hideHeader={true}
                    footer={
                        <ModalFooter
                            cancelText="Discard"
                            onCancelJs="closeModal()"
                            onConfirmJs="submitAgreement()"
                            confirmText="Publish Agreement"
                            confirmId="submitAgreementBtn"
                        />
                    }
                >
                    <header class="flex items-start justify-between gap-3 mb-4">
                        <div class="min-w-0 flex-1">
                            <h2 id="modalAgreementTitle" class="text-lg font-bold text-slate-900 dark:text-slate-100">Create Professional Agreement</h2>
                            <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Draft a new service agreement or liability waiver.</p>
                        </div>
                        <button
                            type="button"
                            aria-label="Close dialog"
                            onclick="closeModal()"
                            class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center text-slate-500 dark:text-slate-300 flex-shrink-0"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </header>
                    <input type="hidden" id="editAgreementId" />
                    <div class="space-y-4">
                        <div class="space-y-2">
                            <label class="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Agreement Name</label>
                            <input type="text" id="agreementName" placeholder="e.g., Standard Home Inspection Version 2.0"
                                class="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                        </div>
                        <div class="space-y-2">
                            <label class="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Legal Content (Rich Text)</label>
                            <link rel="stylesheet" href="/vendor/quill/quill.snow.css" />
                            <div class="rounded-md border-2 border-slate-100 dark:border-slate-600 focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-50 transition-all overflow-hidden bg-white dark:bg-slate-800">
                                <div id="agreementEditor" style="min-height: 280px; font-size: 15px;"></div>
                            </div>
                            <input type="hidden" id="agreementContent" />
                            <p class="text-[10px] text-slate-400 font-semibold ml-1 mt-1">Tip: variables like {'{{client_name}}'}, {'{{property_address}}'}, {'{{inspection_date}}'}, {'{{inspector_name}}'}, and {'{{inspector_license}}'} will be substituted on the sign page.</p>
                        </div>
                    </div>
                </Modal>

                {/* Send Agreement Modal */}
                <Modal
                    id="sendModal"
                    title="Send for Signature"
                    subtitle="Client will receive an email with a link to review and sign."
                    size="md"
                    footer={
                        <ModalFooter
                            onCancelJs="closeSendModal()"
                            onConfirmJs="submitSend()"
                            confirmText="Send Request"
                            confirmId="submitSendBtn"
                        />
                    }
                >
                    <input type="hidden" id="sendAgreementId" />
                    <div class="space-y-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Client Email *</label>
                            <input type="email" id="sendClientEmail" placeholder="client@example.com" class="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Client Name</label>
                            <input type="text" id="sendClientName" placeholder="John Smith" class="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                        </div>
                    </div>
                </Modal>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/vendor/quill/quill.js"></script>
                <script src="/js/agreements.js"></script>
            </div>
        </MainLayout>
    );
};

