/**
 * Sprint 1 B-8 / Sprint 2 S2-6 — Marketplace duplicate banner.
 *
 * Sits on top of /templates. When the tenant has imported the same
 * marketplace template more than once (typical after an "update" that landed
 * via the keep-old + new-copy strategy), this banner explains the situation
 * and offers Compare versions / Use new only / Keep both actions.
 *
 * Sprint 2 S2-6 wires the "Use new only" button to a real migration endpoint
 * via a confirmation modal — replaces the old "coming next release" toast.
 */
export const MarketplaceDuplicateBanner = (): JSX.Element => (
    <div
        x-data="duplicateBanner"
        x-init="load()"
        x-show="groups.length > 0 && !dismissed"
        x-cloak
        x-transition:enter="ease-out duration-200"
        x-transition:enter-start="opacity-0 -translate-y-1"
        x-transition:enter-end="opacity-100 translate-y-0"
        class="rounded-lg border border-amber-200 bg-amber-50 p-4"
        role="status"
    >
        <template x-for="g in groups" {...{ 'x-bind:key': 'g.marketplaceId' }}>
            <div class="flex items-start gap-3">
                <svg
                    class="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                >
                    <path
                        fill-rule="evenodd"
                        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                        clip-rule="evenodd"
                    />
                </svg>
                <div class="flex-1 min-w-0">
                    <p class="text-[13px] font-semibold text-amber-900">
                        You have <span x-text="g.copies.length"></span> copies of <span class="font-bold" x-text="g.copies[0]?.name"></span>.
                    </p>
                    <p class="text-[12px] text-amber-700 mt-0.5">
                        Older version <span class="font-mono" x-text="oldestVersion(g)"></span> may be outdated.
                    </p>
                    <div class="mt-2 flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            x-on:click="compareVersions(g)"
                            class="h-7 px-3 rounded-md bg-white border border-amber-300 text-amber-700 text-[12px] font-bold hover:bg-amber-100 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                        >
                            Compare versions
                        </button>
                        <button
                            type="button"
                            x-on:click="useNewOnly(g)"
                            x-bind:disabled="migrateLoading"
                            class="h-7 px-3 rounded-md bg-amber-600 text-white text-[12px] font-bold hover:bg-amber-700 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            Use new only
                        </button>
                        <button
                            type="button"
                            x-on:click="keepBoth(g)"
                            class="h-7 px-3 rounded-md text-amber-700 text-[12px] font-medium hover:bg-amber-100 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        >
                            Keep both
                        </button>
                    </div>
                </div>
            </div>
        </template>

        {/* Sprint 2 S2-6 — Migrate confirm modal. Lives inside the same x-data
            scope so it can share the migrate* state without prop-drilling.
            Uses style="display:none" + x-show to avoid the x-cloak nested-element
            sticky-display gotcha (see main-layout.tsx). */}
        <div
            x-show="migrateModalOpen"
            {...{ 'x-on:keydown.escape.window': 'closeMigrateModal()' }}
            style="display:none"
            class="fixed inset-0 z-50 flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="migrate-modal-title"
        >
            <div class="absolute inset-0 bg-slate-900/40" x-on:click="closeMigrateModal()"></div>
            <div
                class="relative w-full max-w-md mx-4 bg-white rounded-xl shadow-xl border border-slate-200"
                x-transition:enter="ease-out duration-200"
                x-transition:enter-start="opacity-0 scale-95"
                x-transition:enter-end="opacity-100 scale-100"
            >
                <div class="px-5 py-4 border-b border-slate-100">
                    <h3 id="migrate-modal-title" class="text-[15px] font-semibold text-slate-900">
                        Migrate inspections?
                    </h3>
                </div>
                <div class="px-5 py-4 space-y-3 text-sm text-slate-700">
                    <p>
                        <strong x-text="migrateGroup?.copies?.[0]?.name || 'this template'"></strong>
                        will move
                        <span class="font-mono text-xs" x-text="(migratePreview?.affected ?? 0) + ' inspection' + ((migratePreview?.affected ?? 0) === 1 ? '' : 's')"></span>
                        from the old version to the new version.
                    </p>
                    <template x-if="migratePreview && migratePreview.breakingItems && migratePreview.breakingItems.length > 0">
                        <p class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
                            <span class="font-bold" x-text="migratePreview.breakingItems.length"></span>
                            inspection(s) reference items that no longer exist in the new template.
                            Their data will be parked under <span class="font-mono">_legacy</span> so nothing is lost — review later in inspection-edit.
                        </p>
                    </template>
                    <template x-if="migratePreview && (!migratePreview.breakingItems || migratePreview.breakingItems.length === 0) && (migratePreview.affected ?? 0) > 0">
                        <p class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                            All affected inspections map cleanly to the new template — no data parked under <span class="font-mono">_legacy</span>.
                        </p>
                    </template>
                    <p class="text-[12px] text-slate-500">
                        The old template will be deleted after a successful migration so the duplicate banner clears.
                    </p>
                </div>
                <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        x-on:click="closeMigrateModal()"
                        x-bind:disabled="migrateLoading"
                        class="h-8 px-4 rounded-md border border-slate-200 bg-white text-slate-600 text-[13px] font-semibold hover:bg-slate-50 transition-colors disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        x-on:click="confirmMigrate()"
                        x-bind:disabled="migrateLoading"
                        class="h-8 px-4 rounded-md bg-amber-600 text-white text-[13px] font-bold hover:bg-amber-700 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
                    >
                        <span x-show="!migrateLoading">Migrate &amp; remove old</span>
                        <span x-show="migrateLoading" style="display:none">Migrating…</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
);
