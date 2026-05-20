/**
 * Round-2 F1 — Multi-recipient Publish modal (Spectora §G.3).
 *
 * Replaces the old flat "Confirm Publish" button with a per-recipient
 * delivery picker:
 *
 *   - Lists every party associated with the inspection (client, buyer's
 *     agent, listing agent — pulled from GET /api/inspections/:id/recipients).
 *   - Each recipient row carries two checkboxes: Email and Text. Greyed-out
 *     when the recipient lacks that channel (e.g. no phone → no SMS).
 *   - Top of body: radio group switching between "Send a copy of the report"
 *     and "Send a copy of the agreement". Drives `publishOptions.sendAgreementCopy`.
 *   - Empty state: when the recipient list is empty, body shows
 *     "There aren't any contacts to publish to" and the footer shows only
 *     [Cancel].
 *   - Footer: [Cancel] [Send All]. Send All is disabled until at least one
 *     channel checkbox is selected.
 *
 * Wires entirely into the existing inspection-edit.js Alpine data via:
 *   - `loadRecipients()`     — fetches the list when modal opens
 *   - `recipients[]`         — per-row { contactId, name, role, email, phone, channels: { email, text } }
 *   - `selectedRecipientCount()` — reactive count of checked channels (gates Send All)
 *   - `publish()`            — POSTs to /publish with `recipients` payload
 *
 * Driver mode: Alpine `name="showPublishModal"`. The custom footer is inlined
 * because Send All needs an x-bind:disabled wired to the count getter.
 */

import { Modal } from './modal';
import { PreflightChecks } from './preflight-checks';

const ROLE_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
    client:         { label: 'Buyer',         bg: '#eef2ff', fg: '#4338ca' },
    agent_buyer:    { label: "Buyer's Agent", bg: '#ecfeff', fg: '#0e7490' },
    agent_listing:  { label: 'Listing Agent', bg: '#fef3c7', fg: '#92400e' },
};

export const PublishModal = (): JSX.Element => (
    <Modal
        name="showPublishModal"
        title="Publish Report"
        size="md"
        footer={
            <>
                <button
                    type="button"
                    x-on:click="showPublishModal = false"
                    class="flex-1 h-10 px-4 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
                >
                    Cancel
                </button>
                {/* Send All — only rendered when there is at least one
                    recipient. Disabled until any channel checkbox is checked. */}
                <button
                    type="button"
                    x-show="recipients.length > 0"
                    x-on:click="publish()"
                    /* Design System 0520 subsystem E P1.4 — pre-flight gate.
                       `preflightAllPassed` is mirrored from the panel's
                       `preflight-status` window event by inspectionEditor.
                       A pre-flight failure shows the gates above with
                       remediation buttons so the inspector knows what
                       to fix before the button becomes clickable. */
                    x-bind:disabled="publishing || selectedRecipientCount() === 0 || !preflightAllPassed"
                    x-bind:title="!preflightAllPassed ? 'Resolve pre-flight checks above first' : ''"
                    class="flex-1 h-10 px-4 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 transition-all"
                    data-test="publish-send-all"
                >
                    <span x-text="publishing ? 'Sending…' : 'Send All'"></span>
                </button>
            </>
        }
    >
        <div class="space-y-4" x-data="{}" x-init="if (typeof loadRecipients === 'function') loadRecipients()">
            {/* Loading state */}
            <div
                x-show="loadingRecipients"
                style="display:none"
                class="text-center py-8 text-sm"
                {...{ 'data-test': 'publish-loading' }}
            >
                Loading recipients…
            </div>

            {/* Empty state — no contacts to publish to */}
            <div
                x-show="!loadingRecipients && recipients.length === 0"
                style="display:none"
                class="text-center py-8"
                data-test="publish-empty-state"
            >
                <p class="text-sm font-semibold text-slate-700">
                    There aren't any contacts to publish to.
                </p>
                <p class="text-xs text-slate-500 mt-2">
                    Add a client email/phone or link an agent under Settings to enable publish.
                </p>
            </div>

            {/* Body — only when recipients are loaded */}
            <div x-show="!loadingRecipients && recipients.length > 0" style="display:none" class="space-y-4">
                {/* Design System 0520 subsystem E P1.4 — pre-flight gates.
                    Re-fetches on `refresh-preflight` window event so user
                    remediation (signing the agreement, etc.) is reflected
                    without re-opening the modal. */}
                <PreflightChecks />

                {/* Report summary card (same as before) */}
                <div class="p-3 rounded-xl bg-slate-100 dark:bg-slate-700/50">
                    <div class="text-xs font-mono text-slate-500 dark:text-slate-400">Report Summary</div>
                    <div
                        class="text-sm mt-1 font-semibold text-slate-900 dark:text-slate-100"
                        x-text="reportStats.total + ' items  |  ' + reportStats.defect + ' defects  |  ' + reportStats.monitor + ' monitors'"
                    ></div>
                </div>

                {/* Design System 0520 subsystem D phase 9 — Republish summary.
                    Shown only when the inspection has already been published once
                    (publishedVersion > 0 — derived in the page factory). Free-
                    text "what changed" stored on the new report_versions row. */}
                <div class="space-y-2" x-show="publishedVersion > 0" x-cloak>
                    <label class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 block">
                        What changed in v<span x-text="publishedVersion + 1"></span>?
                    </label>
                    <textarea
                        rows={3}
                        maxlength={500}
                        x-model="publishOptions.summary"
                        placeholder="Optional — visible to the customer in the version-history dropdown"
                        class="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                    ></textarea>
                </div>

                {/* Send a copy of … radio */}
                <div class="space-y-2">
                    <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Send a copy of
                    </div>
                    <div class="flex gap-2" data-test="publish-payload-radio">
                        <label class="flex-1 cursor-pointer">
                            <input
                                type="radio"
                                value="report"
                                x-model="publishOptions.payload"
                                class="peer sr-only"
                            />
                            <div class="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 peer-checked:bg-indigo-50 dark:peer-checked:bg-indigo-900/30 peer-checked:text-indigo-700 dark:peer-checked:text-indigo-300 peer-checked:border-indigo-300 dark:peer-checked:border-indigo-600 transition-all">
                                The report
                            </div>
                        </label>
                        <label class="flex-1 cursor-pointer">
                            <input
                                type="radio"
                                value="agreement"
                                x-model="publishOptions.payload"
                                class="peer sr-only"
                            />
                            <div class="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 peer-checked:bg-indigo-50 dark:peer-checked:bg-indigo-900/30 peer-checked:text-indigo-700 dark:peer-checked:text-indigo-300 peer-checked:border-indigo-300 dark:peer-checked:border-indigo-600 transition-all">
                                The agreement
                            </div>
                        </label>
                    </div>
                </div>

                {/* Recipients list */}
                <div class="space-y-2" data-test="publish-recipient-list">
                    <div class="grid grid-cols-[1fr_auto_auto] gap-3 px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        <span>Recipient</span>
                        <span class="w-12 text-center">Email</span>
                        <span class="w-12 text-center">Text</span>
                    </div>
                    <template x-for="(r, idx) in recipients" {...{ 'x-bind:key': '(r.contactId || "client") + idx' }}>
                        <div class="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm font-semibold truncate text-slate-900 dark:text-slate-100" x-text="r.name"></span>
                                    {Object.entries(ROLE_CHIP).map(([role, chip]) => (
                                        <span
                                            x-show={`r.role === '${role}'`}
                                            class="px-1.5 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap"
                                            style={`background: ${chip.bg}; color: ${chip.fg}`}
                                        >
                                            {chip.label}
                                        </span>
                                    ))}
                                </div>
                                <div class="text-[11px] mt-0.5 truncate text-slate-500 dark:text-slate-400">
                                    <span x-show="r.email" x-text="r.email"></span>
                                    <span x-show="r.email && r.phone"> · </span>
                                    <span x-show="r.phone" x-text="r.phone"></span>
                                </div>
                            </div>
                            <label class="w-12 flex justify-center">
                                <input
                                    type="checkbox"
                                    x-model="r.channels.email"
                                    x-bind:disabled="!r.email"
                                    class="rounded disabled:opacity-30"
                                    {...{ 'data-test': 'publish-channel-email' }}
                                />
                            </label>
                            <label class="w-12 flex justify-center">
                                <input
                                    type="checkbox"
                                    x-model="r.channels.text"
                                    x-bind:disabled="!r.phone"
                                    class="rounded disabled:opacity-30"
                                    {...{ 'data-test': 'publish-channel-text' }}
                                />
                            </label>
                        </div>
                    </template>
                </div>

                {/* Advanced options link — opens the legacy options modal */}
                <button
                    type="button"
                    x-on:click="showLegacyPublishOptions = true"
                    class="text-[11px] font-semibold underline"
                    style="color: #6366f1"
                >
                    Advanced options (theme, signature, payment) →
                </button>
            </div>
        </div>
    </Modal>
);
