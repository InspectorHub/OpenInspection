import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface SettingsDataPageProps {
    branding?: BrandingConfig | undefined;
}

export function SettingsDataPage({ branding }: SettingsDataPageProps) {
    return (
        <MainLayout title="Data Import / Export" branding={branding}>
            <div x-data="dataExport" class="max-w-2xl">
                <h1 class="text-xl font-bold text-slate-900 mb-6">Data Import / Export</h1>

                {/* Export */}
                <div class="bg-white border border-slate-200 rounded-xl p-6 mb-6">
                    <h2 class="text-sm font-bold text-slate-900 mb-1">Export</h2>
                    <p class="text-xs text-slate-500 mb-4">Download your data as CSV. All historical records are included.</p>
                    <div class="flex gap-3">
                        <button
                            x-on:click="downloadExport('inspections')"
                            class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
                        >Download Inspections CSV</button>
                        <button
                            x-on:click="downloadExport('contacts')"
                            class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200 transition-colors"
                        >Download Contacts CSV</button>
                    </div>
                </div>

                {/* Import */}
                <div class="bg-white border border-slate-200 rounded-xl p-6">
                    <h2 class="text-sm font-bold text-slate-900 mb-1">Import Contacts</h2>
                    <p class="text-xs text-slate-500 mb-4">
                        Supports Spectora and Inspector Toolbelt export formats. Duplicates (same email) are skipped automatically.
                    </p>
                    <label class="block cursor-pointer">
                        <div class="inline-flex items-center gap-3">
                            <div class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200 transition-colors">
                                <span x-text="importing ? 'Importing...' : 'Choose CSV file'" />
                            </div>
                            <span class="text-xs text-slate-400">Max 5 MB, UTF-8 encoded</span>
                        </div>
                        <input
                            type="file"
                            accept=".csv,text/csv"
                            x-on:change="importContacts($event)"
                            x-bind:disabled="importing"
                            class="hidden"
                        />
                    </label>

                    <div x-show="importResult" class="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                        <span class="font-bold text-green-800" x-text="`Imported ${importResult?.imported} contacts`" />
                        <span class="text-green-600 ml-2" x-text="importResult?.skipped ? `(${importResult.skipped} skipped — already exist)` : ''" />
                        <ul x-show="importResult?.errors?.length" class="mt-2 text-xs text-red-600 space-y-0.5">
                            <template x-for="err in importResult?.errors?.slice(0, 5)" x-key="err">
                                <li x-text="err" />
                            </template>
                        </ul>
                    </div>
                    <div x-show="importError" x-text="importError" class="mt-4 text-sm text-red-600" />
                </div>
            </div>
            <script src="/js/auth.js" />
            <script src="/js/data.js" />
        </MainLayout>
    );
}
