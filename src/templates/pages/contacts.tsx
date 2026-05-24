import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const ContactsPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Contacts`} branding={branding}>
            <div class="space-y-[18px] animate-fade-in">
                <div x-data="contactsMeta">
                    <PageHeader
                        eyebrow="CONTACTS"
                        eyebrowColor="indigo"
                        title="Contacts"
                        meta={<span x-text="metaText"></span>}
                        actions={
                            <div class="flex items-center gap-2">
                                <select id="filterType" onchange="filterContacts()" class="h-8 px-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] bg-white">
                                    <option value="">All Types</option>
                                    <option value="agent">Agents</option>
                                    <option value="client">Clients</option>
                                </select>
                                <button
                                    type="button"
                                    x-on:click="$dispatch('open-csv-modal')"
                                    class="h-8 px-3 rounded-md ring-1 ring-slate-300 text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all"
                                >
                                    Import CSV
                                </button>
                                <button
                                    onclick="showCreateModal()"
                                    class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                    Add Contact
                                </button>
                            </div>
                        }
                    />
                </div>

                {/* Agent Accounts A2 — tab strip splits "Contacts" (the legacy
                    address book) from "Agents" (partner-link management). The
                    Agents tab fetches /api/agents and renders status-badged
                    rows with Revoke / Re-invite per row. */}
                <div role="tablist" aria-label="Contacts and partner agents" class="flex gap-2 border-b border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        role="tab"
                        id="contactsTabClientsBtn"
                        data-testid="contacts-tab-clients"
                        data-tab="clients"
                        aria-selected="true"
                        aria-controls="contactsClientsPanel"
                        class="px-4 py-2 text-[13px] font-bold text-slate-700 dark:text-slate-300 border-b-2 border-indigo-600"
                    >
                        Contacts
                    </button>
                    <button
                        type="button"
                        role="tab"
                        id="contactsTabAgentsBtn"
                        data-testid="contacts-tab-agents"
                        data-tab="agents"
                        aria-selected="false"
                        aria-controls="contactsAgentsPanel"
                        class="px-4 py-2 text-[13px] font-bold text-slate-500 dark:text-slate-400 border-b-2 border-transparent hover:text-slate-700 dark:hover:text-slate-300"
                    >
                        Agents
                    </button>
                </div>

                <div
                    id="contactsClientsPanel"
                    role="tabpanel"
                    aria-labelledby="contactsTabClientsBtn"
                    class="glass-panel rounded-xl overflow-hidden shadow-md"
                >
                    <table class="w-full text-left">
                        <thead class="bg-slate-50/40">
                            <tr>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Name</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Type</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Email</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Phone</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Agency</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Inspections</th>
                                <th class="relative py-3 pl-3 pr-4 text-right"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody id="contactsBody">
                            <tr aria-busy="true"><td colspan={7} class="px-4 py-3"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 80%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={7} class="px-4 py-3"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 65%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={7} class="px-4 py-3"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 90%; margin: 0 auto;"></div></td></tr>
                        </tbody>
                    </table>
                </div>

                <div
                    id="contactsAgentsPanel"
                    data-testid="contacts-agents-panel"
                    role="tabpanel"
                    aria-labelledby="contactsTabAgentsBtn"
                    hidden
                    class="glass-panel rounded-xl overflow-hidden shadow-md"
                >
                    <table class="w-full text-left">
                        <thead class="bg-slate-50/40">
                            <tr>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Agent</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Status</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Linked</th>
                                <th class="relative py-3 pl-3 pr-4 text-right"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody id="agentLinksBody">
                            <tr aria-busy="true"><td colspan={4} class="px-4 py-3"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 80%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={4} class="px-4 py-3"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 65%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={4} class="px-4 py-3"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 90%; margin: 0 auto;"></div></td></tr>
                        </tbody>
                    </table>
                </div>

                {/* Create/Edit Modal — contacts.js toggles #contactModalTitle text
                    so we keep that id on a custom in-body header (hideHeader=true). */}
                <Modal
                    id="contactModal"
                    size="lg"
                    hideHeader={true}
                    footer={
                        <ModalFooter
                            onCancelJs="closeContactModal()"
                            onConfirmJs="submitContact()"
                            confirmText="Save"
                        />
                    }
                >
                    <header class="flex items-start justify-between gap-3 mb-4">
                        <h3 id="contactModalTitle" class="text-lg font-bold text-slate-900 flex-1">Add Contact</h3>
                        <button
                            type="button"
                            aria-label="Close dialog"
                            onclick="closeContactModal()"
                            class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 flex-shrink-0"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </header>
                    <input type="hidden" id="editContactId" />
                    <div class="space-y-5">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Type</label>
                            <select id="contactType" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm bg-white">
                                <option value="agent">Agent</option>
                                <option value="client">Client</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Full Name *</label>
                            <input type="text" id="contactName" placeholder="Jane Smith" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Email</label>
                                <input type="email" id="contactEmail" placeholder="jane@realty.com" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Phone</label>
                                <input type="tel" id="contactPhone" placeholder="(555) 123-4567" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Agency</label>
                            <input type="text" id="contactAgency" placeholder="Sunrise Realty" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                        </div>
                    </div>
                </Modal>

                {/* CSV import modal — mounted at page root */}
                <div
                    x-data="csvImportModal"
                    x-init="$el.addEventListener('open-csv-modal', () => show(), { once: false })"
                    x-show="open"
                    x-cloak
                    class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
                    {...{ 'x-on:click': 'if ($event.target === $el) close()' }}
                >
                    <div class="bg-white dark:bg-slate-800 rounded-md shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                        <header class="px-3 py-2 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                            <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Import contacts from CSV</h2>
                            <button x-on:click="close()" class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-xl leading-none">&times;</button>
                        </header>

                        {/* Step 1: Upload */}
                        <div x-show="step === 'upload'" class="p-6 space-y-4">
                            <p class="text-sm text-slate-600 dark:text-slate-400">Upload a CSV with your contacts. Spectora and ITB exports work out of the box.</p>
                            <input type="file" accept=".csv,text/csv" x-on:change="onFileChange($event)" class="text-sm" />
                            <p x-show="fileName" class="text-xs text-slate-500" x-text={"`Selected: ${fileName}`"}></p>
                            <textarea x-model="csvText" rows={6} placeholder="...or paste CSV content here" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono"></textarea>
                            <button x-on:click="preview()" {...{ 'x-bind:disabled': 'loading || !csvText.trim()' }} class="px-5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50">
                                <span x-text="loading ? 'Previewing...' : 'Preview'"></span>
                            </button>
                        </div>

                        {/* Step 2: Preview */}
                        <div x-show="step === 'preview'" class="p-6 space-y-4">
                            <div class="grid grid-cols-3 gap-4 text-center">
                                <div class="p-4 bg-emerald-50 rounded-lg">
                                    <div class="text-xl font-bold text-emerald-700" x-text="previewResult?.imported || 0"></div>
                                    <div class="text-xs text-emerald-700 mt-1">New contacts</div>
                                </div>
                                <div class="p-4 bg-amber-50 rounded-lg">
                                    <div class="text-xl font-bold text-amber-700" x-text="previewResult?.skipped || 0"></div>
                                    <div class="text-xs text-amber-700 mt-1">Duplicates (skipped)</div>
                                </div>
                                <div class="p-4 bg-rose-50 rounded-lg">
                                    <div class="text-xl font-bold text-rose-700" x-text="previewResult?.errors?.length || 0"></div>
                                    <div class="text-xs text-rose-700 mt-1">Errors</div>
                                </div>
                            </div>
                            <div x-show="previewResult?.errors?.length > 0" class="bg-rose-50 p-3 rounded-lg text-xs text-rose-700">
                                <div class="font-bold mb-1">Errors:</div>
                                <ul class="space-y-1">
                                    <template x-for="err in previewResult?.errors?.slice(0, 5)" {...{ 'x-bind:key': 'err' }}>
                                        <li x-text="err"></li>
                                    </template>
                                </ul>
                            </div>
                            <div class="flex gap-3 justify-end">
                                <button x-on:click="step = 'upload'" class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold">Back</button>
                                <button x-on:click="confirm()" {...{ 'x-bind:disabled': 'loading || (previewResult?.imported || 0) === 0' }} class="px-5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50">
                                    <span x-text="loading ? 'Importing...' : 'Confirm Import'"></span>
                                </button>
                            </div>
                        </div>

                        {/* Step 3: Done */}
                        <div x-show="step === 'done'" class="p-6 text-center">
                            <div class="text-3xl mb-3">✓</div>
                            <p class="text-lg font-bold text-emerald-700" x-text={"`Imported ${finalResult?.imported || 0} contacts`"}></p>
                            <button x-on:click="close()" class="mt-4 px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest">Done</button>
                        </div>
                    </div>
                </div>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/contacts.js"></script>
                <script src="/js/contacts-agents-tab.js"></script>
                <script type="module" src="/js/csv-import-modal.js"></script>
            </div>
        </MainLayout>
    );
};
