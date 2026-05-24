/**
 * Design System 0520 subsystem C P5.4 — InviteSeatModal.
 *
 * Unified modal for inviting a new permanent member or minting a guest
 * invite link. Both modes share the same role + section/mentor fields;
 * only the trailing surface differs (email + send vs. duration +
 * generated URL).
 *
 * The Alpine factory lives in /js/invite-seat-modal.js. Mount the modal
 * inside a page that loads that script via `<script>`.
 */
import type { FC } from 'hono/jsx';

export const InviteSeatModal: FC = () => (
    <div
        x-data="inviteSeatModal()"
        x-show="open"
        style="display: none"
        class="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Invite seat"
        {...{ '@keydown.escape.window': 'close()' }}
    >
        <div class="ih-card max-w-md w-full bg-white rounded-xl shadow-2xl">
            <header class="px-6 py-4 border-b border-slate-200 flex items-center gap-4">
                <h2 class="ih-h2 flex-1">Invite</h2>
                <div class="flex gap-1">
                    <button class="ih-btn ih-btn--sm"
                            {...{ ':class': "mode === 'permanent' ? 'ih-btn--primary' : 'ih-btn--ghost'", '@click': "mode = 'permanent'" }}>
                        Permanent
                    </button>
                    <button class="ih-btn ih-btn--sm"
                            {...{ ':class': "mode === 'guest' ? 'ih-btn--primary' : 'ih-btn--ghost'", '@click': "mode = 'guest'" }}>
                        Guest
                    </button>
                </div>
            </header>

            <div class="p-6 space-y-4">
                <div x-show="mode === 'permanent'" class="space-y-3">
                    <label class="block">
                        <span class="ih-eyebrow block mb-1">Email</span>
                        <input class="ih-input w-full" type="email" {...{ 'x-model': 'email' }} />
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" {...{ 'x-model': 'notify' }} />
                        Send email notification
                    </label>
                </div>

                <label class="block">
                    <span class="ih-eyebrow block mb-1">Role</span>
                    <select class="ih-input w-full" {...{ 'x-model': 'role' }}>
                        <option value="lead">Lead inspector</option>
                        <option value="specialist">Specialist</option>
                        <option value="apprentice">Apprentice</option>
                        <option value="office">Office staff</option>
                    </select>
                </label>
                <p class="ih-meta mt-1" x-text="roleDesc[role]" />

                <div x-show="role === 'apprentice'">
                    <label class="block">
                        <span class="ih-eyebrow block mb-1">Mentor</span>
                        <select class="ih-input w-full" {...{ 'x-model': 'mentorId' }}>
                            <option value="">Select a lead inspector…</option>
                            <template {...{ 'x-for': 'm in leads' }}>
                                <option {...{ ':value': 'm.id', 'x-text': 'm.email' }} />
                            </template>
                        </select>
                    </label>
                </div>

                <div x-show="role === 'specialist'">
                    <span class="ih-eyebrow block mb-1">Assigned sections</span>
                    <div class="ih-card p-3 max-h-40 overflow-y-auto space-y-1 bg-slate-50">
                        <template {...{ 'x-for': 's in sections' }}>
                            <label class="flex items-center gap-2 text-sm">
                                <input type="checkbox" {...{ ':value': 's.id', 'x-model': 'sectionIds' }} />
                                <span x-text="s.name" />
                            </label>
                        </template>
                        <p class="ih-meta" x-show="sections.length === 0">
                            No template sections loaded yet — switch templates first.
                        </p>
                    </div>
                </div>

                <div x-show="mode === 'guest'">
                    <span class="ih-eyebrow block mb-1">Duration</span>
                    <div class="flex gap-2 flex-wrap">
                        <label class="flex items-center gap-1 text-sm">
                            <input type="radio" {...{ 'x-model.number': 'durationSeconds', ':value': '86400' }} />
                            <span>1 day <span class="ih-meta">$1.49</span></span>
                        </label>
                        <label class="flex items-center gap-1 text-sm">
                            <input type="radio" {...{ 'x-model.number': 'durationSeconds', ':value': '259200' }} />
                            <span>3 days <span class="ih-meta">$4.47</span></span>
                        </label>
                        <label class="flex items-center gap-1 text-sm">
                            <input type="radio" {...{ 'x-model.number': 'durationSeconds', ':value': '604800' }} />
                            <span>7 days <span class="ih-meta">$10.43</span></span>
                        </label>
                    </div>
                    <p class="ih-meta mt-2">
                        Guest counts against your team's seat quota while active.
                    </p>

                    <div x-show="generatedUrl" class="ih-card p-3 mt-3 bg-emerald-50 border border-emerald-200 rounded-md">
                        <div class="ih-eyebrow text-emerald-800 mb-1">Invite link (one-time)</div>
                        <input class="ih-input w-full text-xs" {...{ ':value': 'generatedUrl', 'readonly': true }} />
                        <button class="ih-btn ih-btn--sm ih-btn--secondary mt-2"
                                {...{ '@click': 'copy(generatedUrl)' }}>Copy link</button>
                    </div>
                </div>

                <div x-show="mode === 'guest'" class="ih-card p-3 bg-amber-50 border border-amber-200 rounded-md text-sm">
                    <span class="font-medium">Estimated cost:</span>{' '}
                    <span x-text="guestPriceLabel" />
                </div>

                <p class="ih-meta text-rose-600" x-show="error" x-text="error" />
            </div>

            <footer class="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
                <button class="ih-btn ih-btn--ghost" {...{ '@click': 'close()' }}>Cancel</button>
                <button class="ih-btn ih-btn--primary"
                        x-show="mode === 'permanent'"
                        {...{ '@click': 'submitPermanent()', ':disabled': 'submitting' }}>
                    Send invite
                </button>
                <button class="ih-btn ih-btn--primary"
                        x-show="mode === 'guest' && !generatedUrl"
                        {...{ '@click': 'submitGuest()', ':disabled': 'submitting' }}>
                    Generate link
                </button>
            </footer>
        </div>
    </div>
);
