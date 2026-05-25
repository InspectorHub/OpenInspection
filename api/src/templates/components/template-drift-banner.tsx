/**
 * B4 — Yellow banner shown when the master template version is newer than
 * the inspection's snapshot. Inspector can view diff, upgrade, or dismiss.
 */
export const TemplateDriftBanner = () => (
    <div
        x-data="templateDriftBanner"
        x-show="show"
        x-cloak
        class="bg-amber-50 border-l-4 border-amber-500 p-4 mb-4 rounded-r-lg"
    >
        <div class="flex items-start justify-between gap-3">
            <div>
                <p class="text-sm font-bold text-amber-900">Template was updated</p>
                <p class="text-xs text-amber-800 mt-1" x-text="message"></p>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                <button x-on:click="upgrade()" class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">Upgrade</button>
                <button x-on:click="dismiss()" class="px-3 py-1.5 rounded-lg ring-1 ring-amber-300 text-amber-800 text-xs font-bold hover:bg-amber-100">Dismiss</button>
            </div>
        </div>
    </div>
);
