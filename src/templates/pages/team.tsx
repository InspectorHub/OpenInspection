import { MainLayout } from '../layouts/main-layout';
import { Modal } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const TeamPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Team`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                <div x-data="teamMeta">
                    <PageHeader
                        eyebrow="SETTINGS · TEAM"
                        eyebrowColor="slate"
                        title="Workspace Team"
                        breadcrumb={[{ label: 'Settings', href: '/settings' }, { label: 'Team' }]}
                        meta={<span x-text="metaText"></span>}
                        actions={
                            <div class="flex items-center gap-2">
                                <div id="quotaBadge" class="hidden sm:flex items-center gap-2 px-3 h-8 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <span class="w-1 h-1 rounded-full bg-indigo-500"></span>
                                    <span class="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">Seats:</span>
                                    <span class="text-[12px] font-bold text-slate-900 dark:text-slate-100 leading-none">Loading...</span>
                                </div>
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
                                    <tr><td colspan={3} class="px-10 py-10 text-sm font-bold text-center text-slate-300 uppercase tracking-[0.2em]">Loading...</td></tr>
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
            </div>
        </MainLayout>
    );
};

