/**
 * Spec 5G — Mockup 03 (M3): Keyboard HUD
 *
 * Pure Alpine.js modal triggered by `?` (Shift + Slash) on any page.
 * No React / Radix dependency — keeps with our hono/jsx + Alpine stack.
 *
 * Mounted globally from main-layout.tsx so every authenticated page
 * has the discovery surface for keyboard shortcuts. The actual hotkey
 * behaviors (1/2/3 rating, ↑↓ nav, etc.) are implemented per-feature
 * — this component is the legend / cheatsheet, not the dispatcher.
 *
 * Keyboard: `?` opens; `Esc` or backdrop click closes.
 */

interface ShortcutColumn {
    title: string;
    rows: Array<{ key: string; label: string }>;
}

const COLUMNS: ShortcutColumn[] = [
    {
        title: 'Navigate',
        rows: [
            { key: '↑↓',   label: 'Next / previous item' },
            { key: '⏎',    label: 'Next item' },
            { key: '⇧⏎',   label: 'Previous item' },
            { key: 'GS',   label: 'Jump to section' },
            { key: '⌘K',   label: 'Command palette' },
            { key: '⌃/',   label: 'Command palette (Win)' },
        ],
    },
    {
        // Sprint 1 A-8: extended from 1-3 → 1-5 so all rating levels are reachable.
        title: 'Rating',
        rows: [
            { key: '1', label: 'Satisfactory' },
            { key: '2', label: 'Monitor' },
            { key: '3', label: 'Defect' },
            { key: '4', label: 'Not Inspected' },
            { key: '5', label: 'Not Present' },
            { key: '0', label: 'Clear rating' },
            { key: 'N', label: 'Mark Not Applicable' },
        ],
    },
    {
        title: 'Content',
        rows: [
            { key: '/',  label: 'Open Comment Library' },
            { key: ';',  label: 'Insert snippet' },
            { key: 'P',  label: 'Add photo' },
            { key: 'T',  label: 'Add tag' },
            { key: '⌘D', label: 'Save current as snippet' },
        ],
    },
    {
        title: 'View',
        rows: [
            { key: '⌘1',  label: 'Three-pane layout' },
            { key: '⌘2',  label: 'Focus mode' },
            { key: '⌘3',  label: 'Preview' },
            { key: '⌘S',  label: 'Save' },
            { key: '⌘⇧P', label: 'Publish' },
        ],
    },
];

export function KeyboardHUD(): JSX.Element {
    return (
        <div
            x-data="{ open: false }"
            {...{
                'x-on:keydown.window': "if (($event.key === '?' || ($event.shiftKey && $event.key === '/')) && !window.OIHotkeys?.isTyping?.() && !window.__oiLocalCheatsheet) { open = !open; $event.preventDefault(); }",
                'x-on:keydown.escape.window': 'open = false',
                'x-transition.opacity': '',
                'x-cloak': '',
            }}
            class="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            x-show="open"
            style="display:none"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
        >
            <div class="absolute inset-0 bg-slate-900/85 backdrop-blur-sm" x-on:click="open = false"></div>

            <div class="relative bg-white rounded-lg shadow-md border border-slate-200 max-w-4xl w-full max-h-[85vh] overflow-y-auto">
                <header class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h2 class="text-base font-bold text-slate-900">Keyboard shortcuts</h2>
                        <p class="text-xs text-slate-500 mt-0.5">Press <kbd class="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">?</kbd> to toggle, <kbd class="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">Esc</kbd> to close</p>
                    </div>
                    <button x-on:click="open = false" class="text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Close">&times;</button>
                </header>

                <div class="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {COLUMNS.map(col => (
                        <div key={col.title}>
                            <h3 class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{col.title}</h3>
                            <ul class="space-y-2">
                                {col.rows.map(row => (
                                    <li class="flex items-center justify-between gap-3 text-xs" key={row.key}>
                                        <span class="text-slate-600 leading-tight">{row.label}</span>
                                        <kbd class="shrink-0 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-700 min-w-[28px] text-center">{row.key}</kbd>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <footer class="px-6 py-3 border-t border-slate-100 text-[10px] text-slate-400 italic">
                    Shortcuts marked with section icons (e.g. ⌘) require platform meta key on Mac. Behaviors are implemented per-feature; some may be inactive until that feature ships.
                </footer>
            </div>
        </div>
    );
}
