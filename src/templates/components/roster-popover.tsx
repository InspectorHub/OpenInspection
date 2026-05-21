/**
 * Design System 0520 subsystem B phase 7 task 7.2 — RosterPopover.
 *
 * Slide-out side panel showing the current inspection's live roster
 * (inspectors currently editing) plus disabled "Add inspector" / "Invite
 * guest" CTAs that route into Subsystem C's InviteSeatModal once that
 * lands (M9 — out of scope here).
 *
 * Opens via `open-roster-popover` window event so any future trigger
 * (TeamBanner avatar click, FAB dock tile, etc.) can summon it without
 * cross-component refs. Closes on Esc or backdrop click.
 *
 * Mounted on inspection-edit.tsx; factory reads `inspectionId` from the
 * editor's Alpine `x-data` scope so it knows which presence channel to
 * subscribe to.
 */

export function RosterPopover(): JSX.Element {
    return (
        <div
            x-data="rosterPopover()"
            x-show="open"
            x-cloak
            style="display:none"
            class="fixed inset-0 z-40 bg-slate-900/30 flex items-start justify-end p-4"
            {...{
                'x-on:click.self':             'close()',
                'x-on:keydown.escape.window':  'close()',
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Roster"
        >
            <div class="ih-card w-80 max-w-full p-4 bg-white">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="ih-eyebrow">Inspectors on this inspection</h3>
                    <button
                        type="button"
                        class="ih-btn ih-btn--sm ih-btn--ghost"
                        x-on:click="close()"
                        aria-label="Close"
                    >×</button>
                </div>

                <ul class="space-y-2">
                    <template x-for="u in roster" x-bind:key="u.userId">
                        <li class="flex items-center gap-3">
                            <div class="relative">
                                {/* Design System 0520 subsystem D P6 — observers
                                    render the 👁 glyph instead of initials so they
                                    visually separate from inspectors in the live
                                    roster. The amber halo + bg distinguishes
                                    "watching" from "working". */}
                                <div
                                    class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                                    {...{
                                        ':class': "u.role === 'observer' ? 'bg-amber-100 text-amber-700' : 'bg-slate-300 text-slate-700'",
                                        'x-text': "u.role === 'observer' ? '👁' : (u.name || u.userId || '?').slice(0,2).toUpperCase()",
                                    }}
                                ></div>
                                <span
                                    class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white"
                                    {...{ ':class': "u.role === 'observer' ? 'bg-amber-400' : 'bg-emerald-500'" }}
                                    aria-hidden="true"
                                ></span>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="text-sm font-medium truncate" x-text="u.name || u.userId"></div>
                                <div class="ih-meta" x-show="u.focusItemId" x-text="`editing ${u.focusItemId}`"></div>
                                <div class="ih-meta" x-show="u.role === 'observer'">Observer (read-only)</div>
                            </div>
                        </li>
                    </template>
                    <li x-show="roster.length === 0" class="ih-meta text-center py-4">
                        Nobody else is on this inspection right now.
                    </li>
                </ul>

                {/* Live-add CTAs — dispatch the InviteSeatModal open event
                    with a mode + sourceLabel so the modal opens pre-tuned
                    to the right tab. The page mounting RosterPopover must
                    also mount InviteSeatModal (inspection-edit.tsx does). */}
                <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                    <button
                        type="button"
                        class="ih-btn ih-btn--sm ih-btn--secondary"
                        x-on:click="close(); window.dispatchEvent(new CustomEvent('invite-seat-modal:open', { detail: { mode: 'permanent', sourceLabel: 'Inspection roster · live add' } }))"
                        title="Send an email invite to a new permanent inspector"
                    >Add inspector</button>
                    <button
                        type="button"
                        class="ih-btn ih-btn--sm ih-btn--secondary"
                        x-on:click="close(); window.dispatchEvent(new CustomEvent('invite-seat-modal:open', { detail: { mode: 'guest', sourceLabel: 'Inspection roster · live add' } }))"
                        title="Generate a one-time guest invite link"
                    >Invite guest</button>
                </div>
            </div>
        </div>
    );
}
