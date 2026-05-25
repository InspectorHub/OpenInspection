/**
 * Design System 0520 subsystem B phase 6 task 6.5 — TeamBanner.
 *
 * Top-of-editor strip visible only when inspection.team_mode === true.
 * Static avatars for lead + helpers (from inspection record); clicking
 * "Manage" dispatches the open-roster-popover event so the existing
 * RosterPopover (P7 T7.2) can surface the live editing state.
 *
 * Reads from the inspectionEditor Alpine scope via $root.* (the banner
 * is mounted inside the editor's x-data tree).
 */

export function TeamBanner(): JSX.Element {
    return (
        <div
            x-data="teamBanner()"
            x-show="show"
            x-cloak
            class="px-4 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-3"
        >
            <span class="ih-eyebrow text-indigo-700">Team mode</span>
            <div class="flex -space-x-1.5">
                <template x-for="m in members" x-bind:key="m.id">
                    <div
                        class="w-7 h-7 rounded-full ring-2 ring-indigo-50 bg-slate-300 flex items-center justify-center text-xs font-bold text-slate-700"
                        x-bind:title="`${m.name || m.id}${m.role === 'lead' ? ' (lead)' : ''}`"
                        x-text="(m.name || m.id || '?').slice(0,2).toUpperCase()"
                    ></div>
                </template>
                <div x-show="members.length === 0" class="ih-meta">No roster set</div>
            </div>
            <button
                type="button"
                class="ih-btn ih-btn--sm ih-btn--ghost ml-auto"
                x-on:click="window.dispatchEvent(new CustomEvent('open-roster-popover'))"
                aria-label="Open team roster"
            >Manage →</button>
        </div>
    );
}
