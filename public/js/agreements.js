// Cookie-only auth. Server reads the HttpOnly inspector_token cookie automatically.

const authFetch = (url, opts = {}) =>
    fetch(url, { credentials: 'same-origin', ...opts });

async function logout() {
    try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const meRes = await authFetch('/api/auth/me');
        if (meRes.status === 401) { window.location.href = '/login'; return; }
        const me = await meRes.json();
        const email = me?.data?.user?.email || '';
        const name = email ? email.split('@')[0] : 'User';
        const avatarEl = document.querySelector('nav img[alt="User"]');
        if (avatarEl) {
            avatarEl.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=6366f1&color=fff';
            avatarEl.alt = name;
        }
    } catch { /* fall through; page continues without avatar */ }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = logout;

    loadAgreements();
});

async function loadAgreements() {
    const list = document.getElementById('agreementsList');
    if (!list) return;

    try {
        const res = await authFetch('/api/admin/agreements');
        if (res.status === 401) { window.location.href = '/login'; return; }
        const response = await res.json();

        const agreements = (response.data && response.data.agreements) || response.agreements || [];

        if (agreements && agreements.length > 0) {
            list.innerHTML = agreements.map(a => `
                <tr class="table-row-hover group">
                    <td class="py-6 pl-10 pr-3">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            </div>
                            <div>
                                <p class="text-sm font-bold text-slate-900">${a.name}</p>
                                <p class="text-[10px] text-slate-400 font-mono tracking-tighter uppercase">ID: ${a.id.split('-')[0]}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-6">
                        <span class="inline-flex items-center rounded-lg border border-indigo-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-indigo-50/50 text-indigo-600">v${a.version}.0</span>
                    </td>
                    <td class="px-6 py-6 text-sm text-slate-500 font-bold">${new Date(a.createdAt).toLocaleDateString()}</td>
                    <td class="py-6 pl-3 pr-10 text-right">
                        <button onclick="deleteAgreement('${a.id}')" class="inline-flex items-center gap-2 text-slate-300 font-black text-[10px] uppercase tracking-widest hover:text-red-500 transition-all active:scale-95">
                            Remove
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </td>
                </tr>
            `).join('');
        } else {
            list.innerHTML = `
                <tr>
                    <td colspan="4" class="py-32 text-center">
                        <div class="flex flex-col items-center gap-4 animate-slide-in">
                            <div class="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-2">
                                <svg class="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            </div>
                            <p class="text-xl font-bold text-slate-900">No agreements yet</p>
                            <p class="text-slate-500 max-w-xs mx-auto">Draft your first professional service agreement.</p>
                        </div>
                    </td>
                </tr>
            `;
        }
    } catch (e) {
        console.error('Agreement Load Error:', e);
        list.innerHTML = '<tr><td colspan="4" class="py-32 text-center text-red-500 font-bold font-mono tracking-tighter">REGISTRY_FETCH_ERROR</td></tr>';
    }
}

function showCreateModal() {
    document.getElementById('createModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('createModal').classList.add('hidden');
}

async function submitAgreement() {
    const name = document.getElementById('agreementName').value;
    const content = document.getElementById('agreementContent').value;
    const btn = document.getElementById('submitAgreementBtn');

    if (!name || !content) {
        modalAlert('Name and content are required', 'Validation');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Publishing...';

    try {
        const res = await authFetch('/api/admin/agreements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content })
        });

        if (res.ok) {
            closeModal();
            document.getElementById('agreementName').value = '';
            document.getElementById('agreementContent').value = '';
            loadAgreements();
        } else {
            const err = await res.json();
            modalAlert(err.error || 'Failed to create agreement', 'Error');
        }
    } catch (e) {
        modalAlert('An error occurred during publication', 'Error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Publish Agreement';
    }
}

async function deleteAgreement(id) {
    if (!await modalConfirm('Are you sure you want to remove this agreement?', 'Remove Agreement')) return;

    try {
        const res = await authFetch(`/api/admin/agreements/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadAgreements();
        } else {
            await modalAlert('Failed to delete agreement', 'Error');
        }
    } catch (e) {
        await modalAlert('An error occurred during removal', 'Error');
    }
}
