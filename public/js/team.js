(function() {
    // Get token from cookie (core uses httpOnly cookie + localStorage fallback)
    function getToken() {
        const match = document.cookie.match(/inspector_token=([^;]+)/);
        return match ? match[1] : localStorage.getItem('inspector_token');
    }

    const token = getToken();
    // Removed client-side window.location redirect. 
    // htmlAuthGuard on the server already protects this route.

    const membersList = document.getElementById('membersList');
    const invitesList = document.getElementById('invitesList');
    const quotaBadge = document.getElementById('quotaBadge');
    const openInviteBtn = document.getElementById('openInviteModalBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            document.cookie = 'inspector_token=; Max-Age=0; path=/';
            localStorage.removeItem('inspector_token');
            window.location.href = '/login';
        });
    }

    async function fetchData() {
        try {
            const res = await fetch('/api/team/members', {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                membersList.innerHTML = `<tr><td colspan="3" class="px-6 py-8 text-sm text-center text-red-400">Failed to load: ${err.error || res.status}</td></tr>`;
                return;
            }

            const response = await res.json();
            const { members = [], invites = [], maxUsers } = response.data || response;

            // Quota display
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
            membersList.innerHTML = '<tr><td colspan="3" class="px-6 py-8 text-sm text-center text-slate-400">No active members found.</td></tr>';
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

    // Modal logic
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
            const res = await fetch('/api/team/invite', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
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
