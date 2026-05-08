/**
 * Sprint 1 Sub-spec D Task 3 (D-3) — Share dropdown.
 *
 * Ghost-style button + popover menu with three actions:
 *  - Copy link (clipboard)
 *  - Email link (mailto:)
 *  - Share with your agent (POST /api/inspections/:id/share-agent)
 *
 * Motion follows the canonical popover-in/-out pattern (200ms enter / 150ms
 * exit). Closes on click-away (`x-on:click.outside`) and Esc (handled in
 * report-viewer.js). Wired to Alpine state owned by the parent
 * `reportViewer` data factory.
 */
export const ShareDropdown = (): JSX.Element => (
    <div class="relative print:hidden" {...{ 'x-on:click.outside': 'shareOpen = false' }}>
        <button
            type="button"
            x-on:click="toggleShare()"
            x-bind:aria-expanded="shareOpen"
            aria-haspopup="menu"
            class="h-9 px-3 rounded-md bg-white border border-slate-200 text-slate-700 text-[13px] font-bold inline-flex items-center gap-1.5 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
            Share
            <svg x-bind:class="shareOpen ? 'rotate-180' : ''" class="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
        <div
            x-show="shareOpen"
            style="display: none"
            x-transition:enter="ease-out duration-200"
            x-transition:enter-start="opacity-0 -translate-y-1 scale-[0.97]"
            x-transition:enter-end="opacity-100 translate-y-0 scale-100"
            x-transition:leave="ease-in duration-150"
            x-transition:leave-start="opacity-100 translate-y-0 scale-100"
            x-transition:leave-end="opacity-0 -translate-y-0.5 scale-[0.98]"
            class="absolute right-0 mt-1 w-56 rounded-md bg-white border border-slate-200 shadow-lg overflow-hidden"
            role="menu"
        >
            <button type="button" x-on:click="copyLink()" role="menuitem" class="block w-full px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 transition-colors">
                <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                Copy link
            </button>
            <button type="button" x-on:click="emailLink()" role="menuitem" class="block w-full px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 transition-colors">
                <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                Email link
            </button>
            <div class="border-t border-slate-100"></div>
            <button type="button" x-on:click="shareToAgent()" role="menuitem" class="block w-full px-4 py-2.5 text-left text-[13px] font-bold text-indigo-700 hover:bg-indigo-50 inline-flex items-center gap-2 transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                Share with your agent
            </button>
        </div>
    </div>
);
