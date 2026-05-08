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
                    class="flex-1 h-10 px-4 text-sm font-semibold rounded-xl border bg-white hover:bg-slate-50 transition-all"
                    style="border-color: #e2e8f0; color: #475569"
                >
                    Cancel
                </button>
                {/* Send All — only rendered when there is at least one
                    recipient. Disabled until any channel checkbox is checked. */}
                <button
                    type="button"
                    x-show="recipients.length > 0"
                    x-on:click="publish()"
                    x-bind:disabled="publishing || selectedRecipientCount() === 0"
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
                {/* Report summary card (same as before) */}
                <div class="p-3 rounded-xl" style="background: #f1f5f9">
                    <div class="text-xs font-mono" style="color: #94a3b8">Report Summary</div>
                    <div
                        class="text-sm mt-1"
                        style="color: #1e293b"
                        x-text="reportStats.total + ' items  |  ' + reportStats.defect + ' defects  |  ' + reportStats.monitor + ' monitors'"
                    ></div>
                </div>

                {/* Send a copy of … radio */}
                <div class="space-y-2">
                    <div class="text-[10px] font-bold uppercase tracking-[0.2em]" style="color: #94a3b8">
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
                            <div class="px-3 py-2 rounded-xl border text-sm font-semibold text-slate-600 peer-checked:bg-indigo-50 peer-checked:text-indigo-700 peer-checked:border-indigo-300 transition-all" style="border-color: #e2e8f0">
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
                            <div class="px-3 py-2 rounded-xl border text-sm font-semibold text-slate-600 peer-checked:bg-indigo-50 peer-checked:text-indigo-700 peer-checked:border-indigo-300 transition-all" style="border-color: #e2e8f0">
                                The agreement
                            </div>
                        </label>
                    </div>
                </div>

                {/* Recipients list */}
                <div class="space-y-2" data-test="publish-recipient-list">
                    <div class="grid grid-cols-[1fr_auto_auto] gap-3 px-1 text-[10px] font-bold uppercase tracking-[0.2em]" style="color: #94a3b8">
                        <span>Recipient</span>
                        <span class="w-12 text-center">Email</span>
                        <span class="w-12 text-center">Text</span>
                    </div>
                    <template x-for="(r, idx) in recipients" {...{ 'x-bind:key': '(r.contactId || "client") + idx' }}>
                        <div class="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2 rounded-xl border" style="border-color: rgba(226,232,240,0.7); background: rgba(248,250,252,0.5)">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm font-semibold truncate" style="color: #0f172a" x-text="r.name"></span>
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
                                <div class="text-[11px] mt-0.5 truncate" style="color: #64748b">
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
