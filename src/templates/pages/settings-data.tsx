import { SettingsLayout } from '../components/settings-layout';
import { BrandingConfig } from '../../types/auth';

interface SettingsDataPageProps {
    branding?: BrandingConfig | undefined;
}

export function SettingsDataPage({ branding }: SettingsDataPageProps) {
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Data import / export"
            group="advanced"
            subPage="data"
            pageTitle="Data import / export"
            pageSubtitle="Download your data as CSV, or import contacts from Spectora / Inspector Toolbelt exports."
        >
            <div x-data="dataExport" class="max-w-2xl space-y-5">
                {/* Export */}
                <section class="bg-white border border-surface-200 rounded-lg p-6">
                    <h2 class="text-sm font-bold text-ink-900 mb-1">Export</h2>
                    <p class="text-xs text-ink-500 mb-4">Download your data as CSV. All historical records are included.</p>
                    <div class="flex gap-3 flex-wrap">
                        <button
                            x-on:click="downloadExport('inspections')"
                            class="px-4 py-2 bg-blueprint-500 text-white rounded-md text-sm font-bold hover:bg-blueprint-700 active:scale-[.98] transition-all"
                        >Download Inspections CSV</button>
                        <button
                            x-on:click="downloadExport('contacts')"
                            class="px-4 py-2 rounded-md border border-surface-200 bg-white text-ink-700 text-sm font-semibold hover:bg-surface-100 transition-all"
                        >Download Contacts CSV</button>
                    </div>
                </section>

                {/* Import */}
                <section class="bg-white border border-surface-200 rounded-lg p-6">
                    <h2 class="text-sm font-bold text-ink-900 mb-1">Import Contacts</h2>
                    <p class="text-xs text-ink-500 mb-4">
                        Supports Spectora and Inspector Toolbelt export formats. Duplicates (same email) are skipped automatically.
                    </p>
                    <label class="block cursor-pointer">
                        <div class="inline-flex items-center gap-3">
                            <div class="px-4 py-2 rounded-md border border-surface-200 bg-white text-ink-700 text-sm font-semibold hover:bg-surface-100 transition-all">
                                <span x-text="importing ? 'Importing...' : 'Choose CSV file'" />
                            </div>
                            <span class="text-xs text-ink-500">Max 5 MB, UTF-8 encoded</span>
                        </div>
                        <input
                            type="file"
                            accept=".csv,text/csv"
                            x-on:change="importContacts($event)"
                            x-bind:disabled="importing"
                            class="hidden"
                        />
                    </label>

                    <div x-show="importResult" class="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm">
                        <span class="font-bold text-emerald-800" x-text="`Imported ${importResult?.imported} contacts`" />
                        <span class="text-emerald-700 ml-2" x-text="importResult?.skipped ? `(${importResult.skipped} skipped — already exist)` : ''" />
                        <ul x-show="importResult?.errors?.length" class="mt-2 text-xs text-rose-600 space-y-0.5">
                            <template x-for="err in importResult?.errors?.slice(0, 5)" x-key="err">
                                <li x-text="err" />
                            </template>
                        </ul>
                    </div>
                    <div x-show="importError" x-text="importError" class="mt-4 text-sm text-rose-600" />
                </section>
            </div>
            <script src="/js/auth.js" />
            <script src="/js/data.js" />
        </SettingsLayout>
    );
}
