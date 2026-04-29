(function() {
    const membersList = document.getElementById('membersList');
    const invitesList = document.getElementById('invitesList');
    const quotaBadge = document.getElementById('quotaBadge');
    const openInviteBtn = document.getElementById('openInviteModalBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    async function fetchData() {
        try {
            const res = await authFetch('/api/team/members');
            if (res.status === 401) { window.location.href = '/login'; return; }

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                membersList.innerHTML = `<tr><td colspan="3" class="px-6 py-8 text-sm text-center text-red-400">Failed to load: ${err.error || res.status}</td></tr>`;
                return;
            }

            const response = await res.json();
            const { members = [], invites = [], maxUsers } = response.data || response;

            const pending = invites.filter(i => i.status === 'pending');
            const total = members.length + pending.length;
            quotaBadge.textContent = maxUsers ? `Seats used: ${total} / ${maxUsers}` : `Seats used: ${total}`;

            renderMembers(members);
            renderInvites(pending);

        } catch (e) {
            console.error('Error fetching team:', e);
            membersList.innerHTML = '<tr><td colspan="3" class="px-6 py-8 text-sm text-center text-red-400">Network error. Please refresh.</td></tr>';
        }
    }

    const roleNames = {
        'admin': 'Admin',
        'inspector': 'Inspector',
        'office_staff': 'Office Staff',
        'sysadmin': 'System Admin'
    };

    function renderMembers(members) {
        if (!members || members.length === 0) {
            membersList.innerHTML = `
                <tr>
                    <td colspan="3" class="py-32 text-center">
                        <div class="flex flex-col items-center gap-6">
                            <div class="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center">
                                <svg class="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                            </div>
                            <div>
                                <p class="text-lg font-black text-slate-900 tracking-tight">Just you for now</p>
                                <p class="text-sm text-slate-400 font-medium mt-1">Invite team members to collaborate.</p>
                            </div>
                        </div>
                    </td>
                </tr>`;
            return;
        }
        membersList.innerHTML = members.map(m => `
            <tr class="hover:bg-slate-50/80 transition-colors">
                <td class="px-6 py-4 text-sm font-medium text-slate-900">${m.email}</td>
                <td class="px-4 py-4 text-sm text-slate-500">
                    <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700">${roleNames[m.role] || m.role}</span>
                </td>
                <td class="px-4 py-4 text-sm text-slate-400">${m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—'}</td>
            </tr>
        `).join('');
    }

    function renderInvites(invites) {
        if (!invites || invites.length === 0) {
            invitesList.innerHTML = '<tr><td colspan="3" class="px-6 py-8 text-sm text-center text-slate-400">No pending invitations.</td></tr>';
            return;
        }
        invitesList.innerHTML = invites.map(i => `
            <tr class="hover:bg-slate-50/80 transition-colors">
                <td class="px-6 py-4 text-sm font-medium text-slate-900">${i.email}</td>
                <td class="px-4 py-4 text-sm text-slate-500 font-bold">${roleNames[i.role] || i.role}</td>
                <td class="px-4 py-4 text-sm">
                    <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 uppercase">${i.status}</span>
                </td>
            </tr>
        `).join('');
    }

    const modal = document.getElementById('inviteModal');
    const closeBtn = document.getElementById('closeInviteModalBtn');
    const submitBtn = document.getElementById('submitInviteBtn');
    const inviteResult = document.getElementById('inviteResult');

    openInviteBtn.onclick = () => modal.classList.remove('hidden');
    closeBtn.onclick = () => {
        modal.classList.add('hidden');
        inviteResult.classList.add('hidden');
        inviteResult.textContent = '';
    };

    submitBtn.onclick = async () => {
        const email = document.getElementById('inviteEmail').value.trim();
        const role = document.getElementById('inviteRole').value;

        if (!email) {
            inviteResult.textContent = 'Please enter an email address.';
            inviteResult.classList.remove('hidden');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
        inviteResult.classList.add('hidden');

        try {
            const res = await authFetch('/api/team/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, role })
            });
            const data = await res.json();

            if (data.success) {
                modal.classList.add('hidden');
                document.getElementById('inviteEmail').value = '';
                fetchData();
            } else {
                inviteResult.textContent = data.error?.message || data.error || 'Invitation failed.';
                inviteResult.classList.remove('hidden');
            }
        } catch {
            inviteResult.textContent = 'Server error. Please try again.';
            inviteResult.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Invitation';
        }
    };

    fetchData();
})();
