import { MainLayout } from '../layouts/main-layout';
import { Modal } from '../components/modal';
import { BrandingConfig } from '../../types/auth';

export const TeamPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Team`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
    
                {/* Header */}
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div class="space-y-4">
                        <div class="flex items-center gap-3">
                            <span class="inline-flex items-center rounded-lg bg-indigo-600/10 px-3 py-1 text-[10px] font-bold text-indigo-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-indigo-600/20">Administration</span>
                        </div>
                        <h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl text-gradient">Workspace Team</h1>
                        <p class="text-lg text-slate-500 max-w-2xl font-semibold leading-relaxed">Manage members, inspectors, and organizational permissions.</p>
                    </div>
                    
                    <div class="flex flex-col items-end gap-4">
                        <button type="button" id="openInviteModalBtn"
                            class="premium-button group relative flex items-center justify-center gap-3 overflow-hidden px-4 py-1.5 text-sm rounded-md bg-indigo-600 text-white font-bold shadow-md hover:bg-slate-900 hover:shadow-indigo-200 active:scale-95 transition-all">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                            Invite Member
                        </button>
                        <div id="quotaBadge" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-50 border border-slate-100 shadow-sm transition-all group hover:bg-white hover:border-indigo-100">
                             <div class="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                             <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Seats: </span>
                             <span class="text-xs font-bold text-slate-900 leading-none">Loading...</span>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 gap-6">
                    {/* Active Members */}
                    <div class="glass-panel rounded-xl overflow-hidden shadow-md">
                        <div class="px-10 py-8 border-b border-slate-100/50 bg-slate-50/30 flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <h2 class="text-xl font-bold text-slate-900 tracking-tight">Active Directory</h2>
                                <span class="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Team Members</span>
                            </div>
                        </div>
                        <div class="overflow-x-auto custom-scrollbar">
                            <table class="w-full text-left">
                                <thead class="bg-slate-50/50">
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
                    <div class="glass-panel rounded-xl overflow-hidden shadow-xl shadow-slate-100/50 border-dashed border-2 border-slate-200 bg-slate-50/10">
                        <div class="px-10 py-8 border-b border-slate-100/50 bg-white/30 flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <h2 class="text-xl font-black text-slate-400 tracking-tight">Pending Invitations</h2>
                                <div class="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-400 uppercase">Incoming</div>
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
                                class="flex-1 h-10 px-4 rounded-xl border bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
                                style="border-color: #e2e8f0"
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
                            <label for="inviteEmail" class="block text-xs font-bold text-slate-900 ml-1 uppercase tracking-[0.2em]">Email Address</label>
                            <input type="email" id="inviteEmail" name="email" required placeholder="colleague@example.com"
                                class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300 font-medium text-sm" />
                        </div>
                        <div class="space-y-3">
                            <label for="inviteRole" class="block text-xs font-bold text-slate-900 ml-1 uppercase tracking-[0.2em]">Role</label>
                            <select id="inviteRole" name="role"
                                class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer font-medium text-sm bg-no-repeat bg-[right_1.5rem_center]">
                                <option value="admin">Admin</option>
                                <option value="inspector">Inspector</option>
                                <option value="office_staff">Office Staff</option>
                            </select>
                        </div>
                        <div id="inviteResult" class="hidden text-sm font-bold text-red-600 px-3 py-2 bg-red-50 rounded-2xl border border-red-100"></div>
                    </form>
                </Modal>

                <script src="/js/auth.js"></script>
                <script src="/js/team.js"></script>
            </div>
        </MainLayout>
    );
};

