/**
 * Gap 2C — SideRail vertical tab strip + content panel.
 *
 * 44px persistent vertical tab strip on the rightmost edge of the editor.
 * Three tabs: Preview (panel icon), Library (message icon), Recall (clock icon).
 * Content panel (256px) appears LEFT of the tab strip when expanded.
 *
 * Click active tab → collapse panel. Click inactive tab → expand + switch.
 * Alpine state managed by the parent inspectionEditor factory via:
 *   sideRailMode: 'preview' | 'library' | 'recall'
 *   sideRailOpen: boolean
 */
import type { FC } from 'hono/jsx';

interface SideRailProps {
    inspectionId: string;
}

const TAB_ICON_PATHS: Record<string, string> = {
    preview:  'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    library:  'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
    recall:   'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
};

const TAB_LABELS: Record<string, string> = {
    preview: 'Preview',
    library: 'Library',
    recall:  'Recall',
};

export const SideRail: FC<SideRailProps> = ({ inspectionId: _inspectionId }) => (
    <div class="flex h-full" x-data="{ get _mode() { return sideRailMode }, get _open() { return sideRailOpen } }">
        {/* Content panel — 256px, slides in from left of tab strip */}
        <div
            x-show="sideRailOpen"
            x-cloak
            class="w-64 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden"
            {...{ 'x-transition:enter': 'transition ease-out duration-200', 'x-transition:enter-start': 'opacity-0 translate-x-4', 'x-transition:enter-end': 'opacity-100 translate-x-0', 'x-transition:leave': 'transition ease-in duration-150', 'x-transition:leave-start': 'opacity-100 translate-x-0', 'x-transition:leave-end': 'opacity-0 translate-x-4' }}
        >
            {/* Panel header */}
            <div class="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                <span class="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500" x-text="sideRailMode.charAt(0).toUpperCase() + sideRailMode.slice(1)"></span>
                <button
                    type="button"
                    {...{ 'x-on:click': 'sideRailOpen = false' }}
                    class="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    title="Collapse panel"
                >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/><line x1="15" y1="3" x2="15" y2="21" stroke-width="2"/><polyline points="10 9 7 12 10 15" stroke-width="2"/></svg>
                </button>
            </div>

            {/* Preview tab content */}
            <div x-show="sideRailMode === 'preview'" class="flex-1 overflow-y-auto p-3 space-y-3">
                <div class="text-[11px] text-slate-400 dark:text-slate-500">Live preview of the active item's report rendering.</div>
                <div id="sideRailPreviewContent"></div>
            </div>

            {/* Library tab content */}
            <div x-show="sideRailMode === 'library'" class="flex-1 overflow-y-auto flex flex-col">
                <div class="px-3 pt-2 pb-1">
                    <input
                        type="text"
                        placeholder="Search comments..."
                        class="ih-input w-full text-[12px]"
                        x-model="librarySearchQuery"
                        {...{ 'x-on:input.debounce.200ms': 'searchLibrary()' }}
                    />
                </div>
                <div class="flex-1 overflow-y-auto px-3 pb-3" id="sideRailLibraryContent">
                    <div x-show="!libraryResults || libraryResults.length === 0" class="text-[11px] text-slate-400 dark:text-slate-500 text-center py-6">
                        Type <span class="ih-kbd">/</span> in the note field to search the comment library.
                    </div>
                </div>
            </div>

            {/* Recall tab content */}
            <div x-show="sideRailMode === 'recall'" class="flex-1 overflow-y-auto p-3 space-y-3">
                <div class="text-[11px] text-slate-400 dark:text-slate-500">Prior inspections' notes for similar items.</div>
                <div id="sideRailRecallContent"></div>
            </div>
        </div>

        {/* 44px vertical tab strip — always visible */}
        <div class="w-11 flex-shrink-0 bg-slate-50 dark:bg-slate-800/50 border-l border-slate-200 dark:border-slate-700 flex flex-col items-center py-2 gap-1">
            {(['preview', 'library', 'recall'] as const).map(tabId => (
                <button
                    key={tabId}
                    type="button"
                    {...{ 'x-on:click': `sideRailMode === '${tabId}' && sideRailOpen ? (sideRailOpen = false) : (sideRailMode = '${tabId}', sideRailOpen = true)` }}
                    x-bind:class={`sideRailMode === '${tabId}' && sideRailOpen ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm border-l-2 border-indigo-600 dark:border-indigo-400 -ml-px' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400'`}
                    class="relative w-10 flex flex-col items-center gap-0.5 py-2.5 rounded-r-md transition-all"
                    title={TAB_LABELS[tabId]}
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d={TAB_ICON_PATHS[tabId]} />
                    </svg>
                    <span class="text-[8px] font-bold uppercase tracking-[0.1em]" style="writing-mode: vertical-rl; transform: rotate(180deg)">
                        {TAB_LABELS[tabId]}
                    </span>
                </button>
            ))}
        </div>
    </div>
);
