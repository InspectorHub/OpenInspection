/**
 * Sprint 1 Sub-spec D Task 3 (D-3) — PDF dropdown.
 *
 * Primary indigo button + popover menu offering three print modes:
 *  - Print Full Report (window.print() while currentTab=full)
 *  - Print Summary     (switches tab to summary first)
 *  - Print Safety Hazards (switches tab to safety first)
 *
 * The print stylesheet (`input.css @media print`) reads
 * `html[data-viewer-tab="..."]` to drop non-matching items so the actual PDF
 * output respects the selected mode. Stays on Cloudflare Workers Free plan
 * (no Browser Rendering required).
 */
export const PdfDropdown = (): JSX.Element => (
    <div class="relative print:hidden" {...{ 'x-on:click.outside': 'pdfOpen = false' }}>
        <button
            type="button"
            x-on:click="togglePdf()"
            x-bind:aria-expanded="pdfOpen"
            aria-haspopup="menu"
            class="h-9 px-3 rounded-md bg-indigo-600 text-white text-[13px] font-bold inline-flex items-center gap-1.5 hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
            PDF
            <svg x-bind:class="pdfOpen ? 'rotate-180' : ''" class="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
        <div
            x-show="pdfOpen"
            style="display: none"
            x-transition:enter="ease-out duration-200"
            x-transition:enter-start="opacity-0 -translate-y-1 scale-[0.97]"
            x-transition:enter-end="opacity-100 translate-y-0 scale-100"
            x-transition:leave="ease-in duration-150"
            x-transition:leave-start="opacity-100 translate-y-0 scale-100"
            x-transition:leave-end="opacity-0 -translate-y-0.5 scale-[0.98]"
            class="absolute right-0 mt-1 w-64 rounded-md bg-white border border-slate-200 shadow-lg overflow-hidden"
            role="menu"
        >
            <button type="button" x-on:click="printAs('full')" role="menuitem" class="block w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors">
                <div class="text-[13px] font-bold text-slate-900">Print Full Report</div>
                <div class="text-[11px] text-slate-500 mt-0.5">All sections, items, photos</div>
            </button>
            <button type="button" x-on:click="printAs('summary')" role="menuitem" class="block w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors">
                <div class="text-[13px] font-bold text-slate-900">Print Summary</div>
                <div class="text-[11px] text-slate-500 mt-0.5">Only items with defects</div>
            </button>
            <button type="button" x-on:click="printAs('safety')" role="menuitem" class="block w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors">
                <div class="text-[13px] font-bold text-slate-900">Print Safety Hazards</div>
                <div class="text-[11px] text-slate-500 mt-0.5">Only safety category</div>
            </button>
            <div class="border-t border-slate-100"></div>
            <p class="px-4 py-2 text-[10px] text-slate-400">
                Tip: select <span class="font-mono">Save as PDF</span> in your browser's print dialog.
            </p>
        </div>
    </div>
);
