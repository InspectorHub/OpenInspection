/**
 * B4 — Top-right floating network state pill.
 * Layout has no top header so this is fixed-position. Z-order below the
 * sync progress bar (which is fixed top:0).
 *
 * Sprint 1 C-3 — When `isPublic` is true (i.e. unauth-aware public
 * pages such as /book, /agreements/sign, /r/* report viewer) the pill
 * is hidden entirely. Customers do not need to see "Online" / sync
 * state — that is an internal inspector tool.
 */
interface NetworkPillProps {
    isPublic?: boolean;
}

export const NetworkPill = ({ isPublic = false }: NetworkPillProps = {}): JSX.Element => {
    if (isPublic) return <></>;
    return (
    <div
        x-data="networkPill"
        x-cloak
        x-show="!suppressed"
        class="fixed top-4 right-4 z-40"
    >
        <button
            type="button"
            x-on:click="popoverOpen = !popoverOpen"
            class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 shadow-md ring-1 ring-slate-200 dark:ring-slate-600 text-xs font-bold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
            <span class="w-2 h-2 rounded-full" x-bind:class="dotClass"></span>
            <span x-text="label"></span>
        </button>
        <div
            x-show="popoverOpen"
            {...{ 'x-on:click.outside': 'popoverOpen = false' }}
            class="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 p-4 text-sm"
        >
            {/* Round 38 — replace 'Tier E — Android / Other' technical jargon
                with a plain-English status line. Tier-specific guidance only
                surfaces when actionable (offline, low-storage iOS device,
                cap-approaching). When online with no pending changes there is
                nothing for the user to do — show a single calm status only. */}
            <div class="font-semibold text-slate-900 dark:text-slate-100 mb-2"
                 x-text="!online ? 'Working offline' : (pendingItems.length > 0 ? `Syncing ${pendingItems.length} change${pendingItems.length === 1 ? '' : 's'}` : 'All synced')">
            </div>

            <div x-show="online && pendingItems.length === 0" class="text-xs text-slate-500 dark:text-slate-400">
                Your work auto-saves to this device and uploads automatically.
            </div>

            <div x-show="!online" class="text-xs text-slate-600 dark:text-slate-400 mb-2">
                Your work is being saved on this device. It will upload as soon
                as you're back online.
            </div>

            {/* Tier-specific advice — only shown when storage actually matters */}
            <div x-show="!online && tier?.id === 'C'" class="text-xs text-amber-700 bg-amber-50 rounded-md p-2 mb-2">
                On iOS Safari you can store about 75 photos per inspection while offline.
                For unlimited offline storage, install this app: Share → Add to Home Screen.
            </div>
            <div x-show="!online && tier?.id === 'D'" class="text-xs text-amber-700 bg-amber-50 rounded-md p-2 mb-2">
                Your iOS version stores about 30 photos per inspection while offline.
                Updating iOS will lift this limit.
            </div>
            <div x-show="online && tier?.id === 'B'" class="text-xs text-slate-500 mb-2">
                Tip: install this app from your browser menu so the device keeps your data permanently.
            </div>

            <ul x-show="pendingItems.length > 0" class="space-y-2 max-h-60 overflow-y-auto mt-2 border-t border-slate-100 dark:border-slate-700 pt-2">
                <template x-for="it in pendingItems" {...{ 'x-bind:key': 'it.id' }}>
                    <li class="flex items-start justify-between gap-2 text-xs">
                        <span x-text="`${it.op} · ${new Date(it.createdAt).toLocaleTimeString()}`"></span>
                        <button x-on:click="retryOne(it.id)" class="text-indigo-600 hover:underline">Retry</button>
                    </li>
                </template>
            </ul>
            <button x-show="pendingItems.length > 0"
                x-on:click="syncNow()"
                class="mt-3 w-full h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-all">
                Sync now
            </button>
        </div>
    </div>
    );
};
