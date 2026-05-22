import { MainLayout } from '../layouts/main-layout';
import { Modal } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';
import { SeatBanner } from '../../features/seat-quota/seat-banner';
import type { SeatUsage } from '../../features/seat-quota/usage';

interface TeamPageProps {
    branding?: BrandingConfig | undefined;
    seatUsage?: SeatUsage;
    billingPortalUrl?: string | null;
}

export const TeamPage = ({ branding, seatUsage, billingPortalUrl }: TeamPageProps = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Team`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                {seatUsage !== undefined && billingPortalUrl !== undefined ? (
                    <SeatBanner usage={seatUsage} billingPortalUrl={billingPortalUrl} />
                ) : null}
                <div x-data="teamMeta">
                    <PageHeader
                        eyebrow="SETTINGS · TEAM"
                        eyebrowColor="slate"
                        title="Workspace Team"
                        breadcrumb={[{ label: 'Settings', href: '/settings' }, { label: 'Team' }]}
                        meta={<span x-text="metaText"></span>}
                        actions={
                            <div class="flex items-center gap-2">
                                {seatUsage !== undefined ? (
                                    <div id="quotaBadge" class="hidden sm:flex items-center gap-2 px-3 h-8 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span class="w-1 h-1 rounded-full bg-indigo-500"></span>
                                        <span class="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">Seats:</span>
                                        <span class="sr-only">Loading seat count…</span>
                                        <span class="ih-skeleton ih-skeleton--text inline-block" style="width: 3.5rem; height: 0.875rem; vertical-align: middle;" aria-hidden="true"></span>
                                    </div>
                                ) : null}
                                <button
                                    type="button"
                                    id="openInviteModalBtn"
                                    class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                                    Invite Member
                                </button>
                            </div>
                        }
                    />
                </div>

                <div class="grid grid-cols-1 gap-6">
                    {/* Active Members */}
                    <div class="glass-panel rounded-xl overflow-hidden shadow-md">
                        <div class="px-10 py-8 border-b border-slate-100/50 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/30 flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <h2 class="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Active Directory</h2>
                                <span class="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-widest">Team Members</span>
                            </div>
                        </div>
                        <div class="overflow-x-auto custom-scrollbar">
                            <table class="w-full text-left">
                                <thead class="bg-slate-50/50 dark:bg-slate-700/50">
                                    <tr>
                                        <th class="py-6 px-10 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Name</th>
                                        <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Role</th>
                                        <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Onboarding Date</th>
                                    </tr>
                                </thead>
                                <tbody id="membersList" class="divide-y divide-slate-100/50">
                                    <tr aria-busy="true"><td colspan={3} class="px-10 py-4"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 80%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={3} class="px-10 py-4"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 65%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={3} class="px-10 py-4"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 90%; margin: 0 auto;"></div></td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Pending Invites */}
                    <div class="glass-panel rounded-xl overflow-hidden shadow-xl shadow-slate-100/50 border-dashed border-2 border-slate-200 dark:border-slate-700 bg-slate-50/10">
                        <div class="px-10 py-8 border-b border-slate-100/50 dark:border-slate-700 bg-white/30 dark:bg-slate-900/20 flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <h2 class="text-xl font-bold text-slate-400 dark:text-slate-500 tracking-tight">Pending Invitations</h2>
                                <div class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">Incoming</div>
                            </div>
                        </div>
                        <div class="overflow-x-auto custom-scrollbar">
                            <table class="w-full text-left">
                                <thead class="bg-slate-50/20">
                                    <tr>
                                        <th class="py-6 px-10 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Target Email</th>
                                        <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Assigned Role</th>
                                        <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Status</th>
                                    </tr>
                                </thead>
                                <tbody id="invitesList" class="divide-y divide-slate-100/50">
                                    <tr><td colspan={3} class="px-10 py-6 text-sm font-bold text-center text-slate-400">No pending deployments found.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Design System 0520 subsystem C P10 — Defaults toggles. Owner/admin
                    surfaces the three tenant-wide team-page switches. The factory in
                    team-page-extras.js fetches /api/team/defaults on init and PUTs on
                    @change. */}
                <section x-data="teamDefaults()" {...{ 'x-init': 'init()' }}
                    class="glass-panel rounded-xl p-6 shadow-md space-y-3">
                    <h2 class="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Defaults</h2>
                    <label class="flex items-center gap-3">
                        <input type="checkbox" {...{ 'x-model': 'teamModeDefault', '@change': 'save()' }} class="w-4 h-4" />
                        <span class="text-sm font-medium">New inspections default to <strong>Team mode</strong></span>
                    </label>
                    <label class="flex items-center gap-3">
                        <input type="checkbox" {...{ 'x-model': 'apprenticeReviewRequired', '@change': 'save()' }} class="w-4 h-4" />
                        <span class="text-sm font-medium">Always require <strong>apprentice review</strong></span>
                    </label>
                    <label class="flex items-center gap-3">
                        <input type="checkbox" {...{ 'x-model': 'guestInvitesEnabled', '@change': 'save()' }} class="w-4 h-4" />
                        <span class="text-sm font-medium">Allow <strong>guest invites</strong></span>
                    </label>
                    <p class="text-xs text-slate-400" x-show="saving">Saving…</p>
                </section>

                {/* Design System 0520 subsystem C P10 — Apprentices + Active Guests +
                    Billing pointer. All three are populated by team-page-extras.js
                    against the endpoints added in P10.2. */}
                <section x-data="teamApprentices()" {...{ 'x-init': 'init()' }}
                    class="glass-panel rounded-xl p-6 shadow-md">
                    <h2 class="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">Apprentices</h2>
                    <ul class="space-y-2">
                        <template {...{ 'x-for': 'a in items', ':key': 'a.id' }}>
                            <li class="flex items-center gap-3 p-3 border border-slate-200 rounded">
                                <span class="font-medium" x-text="a.name" />
                                <span class="text-xs text-slate-500" x-show="a.mentorName">
                                    mentor <span x-text="a.mentorName" />
                                </span>
                                <a class="ml-auto inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-xs font-bold"
                                   href="/apprentice-review"
                                   x-show="a.pendingCount > 0">
                                    <span x-text="a.pendingCount" /> awaiting
                                </a>
                            </li>
                        </template>
                    </ul>
                    <p class="text-sm text-slate-400" x-show="items.length === 0 && !loading">No apprentices yet.</p>
                </section>

                <section x-data="teamGuests()" {...{ 'x-init': 'init()' }}
                    class="glass-panel rounded-xl p-6 shadow-md">
                    <h2 class="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">Active guests</h2>
                    <ul class="space-y-2">
                        <template {...{ 'x-for': 'g in items', ':key': 'g.id' }}>
                            <li class="flex items-center gap-3 p-3 border border-slate-200 rounded">
                                <span class="font-medium" x-text="g.name" />
                                <span class="text-xs text-slate-500">
                                    <span x-text="g.role" /> · expires <span x-text="g.expiresRel" />
                                </span>
                                <button class="ml-auto px-2 h-7 rounded-md bg-rose-50 text-rose-700 text-xs font-bold border border-rose-200 hover:bg-rose-100"
                                        {...{ '@click': 'revoke(g)' }}>Revoke</button>
                            </li>
                        </template>
                    </ul>
                    <p class="text-sm text-slate-400" x-show="items.length === 0 && !loading">No active guests.</p>
                </section>

                {/* Roles reference — surfaces the RBAC matrix so workspace
                    admins know what each role actually does before they
                    assign one. The roles themselves are defined globally
                    in src/lib/middleware/rbac.ts; this card is purely a
                    documentation surface (no edit affordance — roles can't
                    be customised without a code change, matching the
                    design's "Defined globally" subtitle). */}
                <section class="glass-panel rounded-xl p-6 shadow-md">
                    <header class="mb-4">
                        <h2 class="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">Roles</h2>
                        <p class="text-sm text-slate-500 dark:text-slate-400">
                            Defined globally. To request a custom role, file a ticket on the OpenInspection repo.
                        </p>
                    </header>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div class="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md">
                            <div class="text-sm font-bold text-slate-900 dark:text-slate-100">Lead inspector</div>
                            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Full edit · can publish · approves apprentice ratings. <span class="font-mono text-slate-400 dark:text-slate-500">(role: <code>lead</code> / <code>inspector</code>)</span></div>
                        </div>
                        <div class="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md">
                            <div class="text-sm font-bold text-slate-900 dark:text-slate-100">Specialist</div>
                            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Full edit within their assigned sections. <span class="font-mono text-slate-400 dark:text-slate-500">(role: <code>specialist</code>)</span></div>
                        </div>
                        <div class="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md">
                            <div class="text-sm font-bold text-slate-900 dark:text-slate-100">Apprentice</div>
                            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Edits route through the lead's review queue at <a href="/apprentice-review" class="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">/apprentice-review</a> before publish. <span class="font-mono text-slate-400 dark:text-slate-500">(role: <code>apprentice</code>)</span></div>
                        </div>
                        <div class="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md">
                            <div class="text-sm font-bold text-slate-900 dark:text-slate-100">Office staff</div>
                            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Read-only access to inspections + scheduling. <span class="font-mono text-slate-400 dark:text-slate-500">(role: <code>office</code>)</span></div>
                        </div>
                    </div>
                </section>

                <section class="rounded-xl p-6 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 flex items-center justify-between">
                    <div>
                        <div class="text-[10px] font-bold text-indigo-700 uppercase tracking-widest">Billing</div>
                        <div class="text-lg font-medium text-slate-900">Manage seats, invoices, and payment in the billing portal</div>
                    </div>
                    <a class="h-9 px-4 rounded-md bg-indigo-600 text-white text-sm font-bold inline-flex items-center hover:bg-indigo-700"
                       href="/settings/billing">Manage billing →</a>
                </section>

                {/* Invite Modal — team.js looks up #closeInviteModalBtn / #submitInviteBtn
                    by id to bind onclick handlers, so those ids are preserved on the
                    inlined footer buttons. */}
                <Modal
                    id="inviteModal"
                    title="Invite Team Member"
                    subtitle="Send an invitation to join your workspace."
                    size="xl"
                    footer={
                        <>
                            <button
                                type="button"
                                id="closeInviteModalBtn"
                                class="flex-1 h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                id="submitInviteBtn"
                                class="flex-[2] h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
                            >
                                Send Invitation
                            </button>
                        </>
                    }
                >
                    <form id="inviteForm" class="space-y-4">
                        <div class="space-y-3">
                            <label for="inviteEmail" class="block text-xs font-bold text-slate-900 dark:text-slate-100 ml-1 uppercase tracking-[0.2em]">Email Address</label>
                            <input type="email" id="inviteEmail" name="email" required placeholder="colleague@example.com"
                                class="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500 font-medium text-sm" />
                        </div>
                        <div class="space-y-3">
                            <label for="inviteRole" class="block text-xs font-bold text-slate-900 dark:text-slate-100 ml-1 uppercase tracking-[0.2em]">Role</label>
                            <select id="inviteRole" name="role"
                                class="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer font-medium text-sm bg-no-repeat bg-[right_1.5rem_center]">
                                <option value="admin">Admin</option>
                                <option value="inspector">Inspector</option>
                                <option value="office_staff">Office Staff</option>
                            </select>
                        </div>
                        <div id="inviteResult" class="hidden text-sm font-bold text-red-600 px-3 py-2 bg-red-50 rounded-md border border-red-100"></div>
                    </form>
                </Modal>

                <script src="/js/auth.js"></script>
                <script src="/js/team.js"></script>
                <script src="/js/team-page-extras.js"></script>
            </div>
        </MainLayout>
    );
};

