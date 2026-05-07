/**
 * B4 — Three-column conflict resolution modal (base / yours / theirs).
 * Triggered when db.conflicts is non-empty.
 */
export const ConflictModal = () => (
    <div
        x-data="conflictModal"
        x-show="open"
        x-cloak
        class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        {...{ 'x-on:click.self': 'open = false' }}
    >
        <div class="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <header class="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                    <h2 class="text-xl font-black text-slate-900">Sync Conflict</h2>
                    <p class="text-sm text-slate-500" x-text="`${current?.itemId} · ${current?.field}`"></p>
                </div>
                <span x-text="`${index + 1} of ${conflicts.length}`" class="text-xs font-bold text-slate-400"></span>
            </header>
            <div class="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <section><h3 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Base</h3><pre class="bg-slate-50 p-3 rounded-lg text-xs whitespace-pre-wrap" x-text="current?.base"></pre></section>
                <section><h3 class="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-2">Yours</h3><pre class="bg-indigo-50 p-3 rounded-lg text-xs whitespace-pre-wrap" x-text="current?.ours"></pre></section>
                <section><h3 class="text-xs font-bold uppercase tracking-widest text-rose-600 mb-2">Theirs</h3><pre class="bg-rose-50 p-3 rounded-lg text-xs whitespace-pre-wrap" x-text="current?.theirs"></pre></section>
            </div>
            <footer class="px-8 py-5 border-t border-slate-100 flex items-center gap-3 justify-end">
                <button x-on:click="resolve('ours')"   class="px-5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700">Keep Mine</button>
                <button x-on:click="resolve('theirs')" class="px-5 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-rose-700">Accept Theirs</button>
                <button x-on:click="resolve('edit')"   class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold uppercase tracking-widest hover:bg-slate-50">Edit Merged</button>
            </footer>
        </div>
    </div>
);
