/**
 * Sprint 1 B-8 — Marketplace duplicate banner.
 *
 * Sits on top of /templates. When the tenant has imported the same
 * marketplace template more than once (typical after an "update" that landed
 * via the keep-old + new-copy strategy), this banner explains the situation
 * and offers Compare versions / Use new only / Keep both actions.
 *
 * Sprint 1 ships banner UI + Keep both (localStorage dismissal) + Compare
 * Versions navigation. "Use new only" toasts "coming next release" until
 * Sprint 2 S2-6 ships the inspection migrate-to-template endpoint.
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
                            class="h-7 px-3 rounded-md bg-amber-600 text-white text-[12px] font-bold hover:bg-amber-700 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30"
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
    </div>
);
