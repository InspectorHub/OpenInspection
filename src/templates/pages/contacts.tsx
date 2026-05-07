import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const ContactsPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Contacts`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <span class="inline-flex items-center rounded-lg bg-emerald-600/10 px-3 py-1 text-[10px] font-bold text-emerald-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-emerald-600/20 mb-4">Contacts</span>
                        <h1 class="text-3xl font-bold tracking-tight text-slate-900">Contacts</h1>
                        <p class="text-lg text-slate-500 font-semibold mt-2">Manage agents and clients.</p>
                    </div>
                    <div class="flex gap-3">
                        <select id="filterType" onchange="filterContacts()" class="px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm bg-white">
                            <option value="">All Types</option>
                            <option value="agent">Agents</option>
                            <option value="client">Clients</option>
                        </select>
                        <button
                            type="button"
                            x-on:click="$dispatch('open-csv-modal')"
                            class="px-4 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold uppercase tracking-widest hover:bg-slate-50"
                        >
                            Import CSV
                        </button>
                        <button onclick="showCreateModal()" class="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-sm hover:bg-indigo-700 active:scale-[.98] transition-all">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            Add Contact
                        </button>
                    </div>
                </div>

                <div class="glass-panel rounded-xl overflow-hidden shadow-md">
                    <table class="w-full text-left">
                        <thead class="bg-slate-50/40">
                            <tr>
                                <th class="py-6 px-10 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Name</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Type</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Email</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Phone</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Agency</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Inspections</th>
                                <th class="relative py-6 pl-3 pr-10 text-right"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody id="contactsBody">
                            <tr><td colspan={7} class="px-10 py-8 text-center text-slate-400 font-semibold">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* Create/Edit Modal */}
                <div id="contactModal" class="fixed inset-0 z-[100] hidden overflow-y-auto">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xl" onclick="closeContactModal()"></div>
                    <div class="flex min-h-full items-center justify-center p-6">
                        <div class="relative w-full max-w-lg bg-white rounded-xl p-6 shadow-2xl">
                            <h3 id="contactModalTitle" class="text-xl font-bold text-slate-900 mb-8">Add Contact</h3>
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
                            <div class="mt-8 flex gap-4">
                                <button onclick="closeContactModal()" class="flex-1 px-4 py-2 rounded-md border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all">Cancel</button>
                                <button onclick="submitContact()" class="flex-[2] px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-sm hover:bg-indigo-700 active:scale-[.98] transition-all disabled:bg-slate-300 disabled:cursor-not-allowed">Save</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* CSV import modal — mounted at page root */}
                <div
                    x-data="csvImportModal"
                    x-init="$el.addEventListener('open-csv-modal', () => show(), { once: false })"
                    x-show="open"
                    x-cloak
                    class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
                    {...{ 'x-on:click': 'if ($event.target === $el) close()' }}
                >
                    <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                        <header class="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                            <h2 class="text-lg font-bold text-slate-900">Import contacts from CSV</h2>
                            <button x-on:click="close()" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
                        </header>

                        {/* Step 1: Upload */}
                        <div x-show="step === 'upload'" class="p-6 space-y-4">
                            <p class="text-sm text-slate-600">Upload a CSV with your contacts. Spectora and ITB exports work out of the box.</p>
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
                            <div class="text-5xl mb-3">✓</div>
                            <p class="text-lg font-bold text-emerald-700" x-text={"`Imported ${finalResult?.imported || 0} contacts`"}></p>
                            <button x-on:click="close()" class="mt-4 px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest">Done</button>
                        </div>
                    </div>
                </div>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/contacts.js"></script>
                <script type="module" src="/js/csv-import-modal.js"></script>
            </div>
        </MainLayout>
    );
};
