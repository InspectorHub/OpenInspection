import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const TeamPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Team`} branding={branding}>
            <div class="space-y-12 animate-fade-in">
    
                {/* Header */}
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div class="space-y-4">
                        <div class="flex items-center gap-3">
                            <span class="inline-flex items-center rounded-lg bg-indigo-600/10 px-3 py-1 text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-indigo-600/20">Administration</span>
                        </div>
                        <h1 class="text-5xl font-black tracking-tight text-slate-900 sm:text-6xl text-gradient">Workspace Team</h1>
                        <p class="text-lg text-slate-500 max-w-2xl font-semibold leading-relaxed">Manage members, inspectors, and organizational permissions.</p>
                    </div>
                    
                    <div class="flex flex-col items-end gap-4">
                        <button type="button" id="openInviteModalBtn"
                            class="premium-button group relative flex items-center justify-center gap-3 overflow-hidden px-10 py-5 rounded-[1.5rem] bg-indigo-600 text-white font-bold shadow-2xl shadow-indigo-100 hover:bg-slate-900 hover:shadow-indigo-200 active:scale-95 transition-all">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                            Invite Member
                        </button>
                        <div id="quotaBadge" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-50 border border-slate-100 shadow-sm transition-all group hover:bg-white hover:border-indigo-100">
                             <div class="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                             <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Seats: </span>
                             <span class="text-xs font-black text-slate-900 leading-none">Loading...</span>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 gap-12">
                    {/* Active Members */}
                    <div class="glass-panel rounded-[3rem] overflow-hidden shadow-2xl shadow-slate-200/50">
                        <div class="px-10 py-8 border-b border-slate-100/50 bg-slate-50/30 flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Active Directory</h2>
                                <span class="text-[10px] font-black text-slate-300 uppercase tracking-widest">Team Members</span>
                            </div>
                        </div>
                        <div class="overflow-x-auto custom-scrollbar">
                            <table class="w-full text-left">
                                <thead class="bg-slate-50/50">
                                    <tr>
                                        <th class="py-6 px-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Name</th>
                                        <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Role</th>
                                        <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Onboarding Date</th>
                                    </tr>
                                </thead>
                                <tbody id="membersList" class="divide-y divide-slate-100/50">
                                    <tr><td colspan={3} class="px-10 py-16 text-sm font-black text-center text-slate-300 uppercase tracking-[0.2em]">Loading...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Pending Invites */}
                    <div class="glass-panel rounded-[3rem] overflow-hidden shadow-xl shadow-slate-100/50 border-dashed border-2 border-slate-200 bg-slate-50/10">
                        <div class="px-10 py-8 border-b border-slate-100/50 bg-white/30 flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <h2 class="text-xl font-black text-slate-400 tracking-tightest">Pending Invitations</h2>
                                <div class="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-black text-slate-400 uppercase">Incoming</div>
                            </div>
                        </div>
                        <div class="overflow-x-auto custom-scrollbar">
                            <table class="w-full text-left">
                                <thead class="bg-slate-50/20">
                                    <tr>
                                        <th class="py-6 px-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Target Email</th>
                                        <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Assigned Role</th>
                                        <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Status</th>
                                    </tr>
                                </thead>
                                <tbody id="invitesList" class="divide-y divide-slate-100/50">
                                    <tr><td colspan={3} class="px-10 py-12 text-sm font-bold text-center text-slate-400">No pending deployments found.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Invite Modal */}
                <div id="inviteModal" class="fixed inset-0 z-[100] hidden overflow-y-auto">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xl transition-opacity animate-fade-in"></div>
                    <div class="fixed inset-0 flex items-center justify-center p-6">
                        <div role="dialog" aria-modal="true" class="relative bg-white rounded-[3.5rem] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.3)] w-full max-w-xl p-12 overflow-hidden border border-white/40 animate-fade-in">
                            <div class="mb-12">
                                <div class="w-16 h-16 bg-indigo-600/10 rounded-2xl flex items-center justify-center text-indigo-600 mb-6">
                                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                                </div>
                                <h3 class="text-4xl font-black text-slate-900 tracking-tightest mb-3 leading-none">Invite Team Member</h3>
                                <p class="text-base text-slate-500 font-semibold tracking-tight">Send an invitation to join your workspace.</p>
                            </div>

                            <form id="inviteForm" class="space-y-8">
                                <div class="space-y-3">
                                    <label for="inviteEmail" class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Email Address</label>
                                    <div class="relative group">
                                         <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                         <input type="email" id="inviteEmail" name="email" required placeholder="colleague@example.com"
                                            class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-300 font-bold text-sm" />
                                    </div>
                                </div>
                                <div class="space-y-3">
                                    <label for="inviteRole" class="block text-xs font-black text-slate-900 ml-1 uppercase tracking-[0.2em]">Role</label>
                                    <div class="relative group">
                                         <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition-opacity"></div>
                                         <select id="inviteRole" name="role"
                                            class="premium-input relative w-full px-7 py-5 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all appearance-none cursor-pointer font-bold text-sm bg-no-repeat bg-[right_1.5rem_center]">
                                            <option value="admin">Admin</option>
                                            <option value="inspector">Inspector</option>
                                            <option value="office_staff">Office Staff</option>
                                        </select>
                                    </div>
                                </div>
                                <div id="inviteResult" class="hidden text-sm font-black text-red-600 px-6 py-4 bg-red-50 rounded-2xl border border-red-100 animate-fade-in"></div>
                            </form>

                            <div class="mt-10 flex flex-col sm:flex-row gap-4">
                                <button type="button" id="submitInviteBtn"
                                    class="premium-button flex-[2] py-5 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl hover:bg-black transition-all active:scale-95">
                                    Send Invitation
                                </button>
                                <button type="button" id="closeInviteModalBtn"
                                    class="flex-1 py-5 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <script src="/js/auth.js"></script>
                <script src="/js/team.js"></script>
            </div>
        </MainLayout>
    );
};

