// Authenticated browser pages rely on the HttpOnly `inspector_token` cookie. The cookie is not
// readable from JS; the browser sends it automatically with same-origin fetches. We never store
// the token in localStorage or a JS-readable cookie — that would defeat HttpOnly.

const authFetch = (url, opts = {}) =>
    fetch(url, { credentials: 'same-origin', ...opts });

async function logout() {
    try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
}

let inspections = [];
let searchDebounce;
let currentUserEmail = '';

document.addEventListener('DOMContentLoaded', async () => {
    // Fetch current user for avatar. If unauthenticated, htmlAuthGuard already redirected;
    // a 401 here only happens on race conditions — bounce to /login in that case.
    try {
        const meRes = await authFetch('/api/auth/me');
        if (meRes.status === 401) { window.location.href = '/login'; return; }
        const me = await meRes.json();
        currentUserEmail = me?.data?.user?.email || '';
    } catch (e) {
        console.error('Failed to load session:', e);
    }

    const name = currentUserEmail ? currentUserEmail.split('@')[0] : 'User';
    const avatarEl = document.querySelector('nav img[alt="User"]');
    if (avatarEl) {
        avatarEl.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=6366f1&color=fff';
        avatarEl.alt = name;
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = logout;

    const searchInput = document.getElementById('filterSearch');
    if (searchInput) {
        searchInput.oninput = () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => fetchInspections(true), 400);
        };
    }

    fetchInspections(true);
    fetchPrerequisites();
});

async function fetchInspections() {
    const tbody = document.getElementById('inspectionsList');
    if (!tbody) return;

    try {
        const searchInput = document.getElementById('filterSearch');
        const query = searchInput ? searchInput.value.trim() : '';
        const url = query ? `/api/inspections?search=${encodeURIComponent(query)}` : '/api/inspections';

        const res = await authFetch(url);
        if (res.status === 401) { window.location.href = '/login'; return; }

        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-20 text-center text-sm font-bold text-red-500">Failed to sync with registry.</td></tr>';
            return;
        }

        const response = await res.json();
        inspections = response.data || [];
        const counts = response.meta?.counts || { total: 0, pending: 0, completed: 0, in_progress: 0 };

        updateStats(counts);
        renderInspections(inspections);
    } catch (e) {
        console.error('Fetch Error:', e);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-20 text-center text-sm font-bold text-red-500">Network error during synchronization.</td></tr>';
        }
    }
}

function updateStats(counts) {
    const map = {
        'statActive': counts.total || 0,
        'statProgress': counts.in_progress || 0,
        'statReview': counts.pending || 0,
        'statCompleted': counts.completed || 0
    };
    for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }
}

function renderInspections(list) {
    const tbody = document.getElementById('inspectionsList');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="py-32 text-center">
                    <div class="flex flex-col items-center gap-4 animate-fade-in">
                        <div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-200">
                             <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        </div>
                        <p class="text-sm font-black text-slate-400 uppercase tracking-widest">No matching records found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = list.map(ins => `
        <tr class="table-row-hover group">
            <td class="py-6 px-10">
                <div>
                    <p class="text-sm font-bold text-slate-900">${ins.propertyAddress}</p>
                    <p class="text-[10px] text-slate-400 font-mono tracking-tighter uppercase">ID: ${ins.id.split('-')[0]}</p>
                </div>
            </td>
            <td class="px-8 py-6">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-400 border border-slate-200 uppercase">
                        ${(ins.clientName || 'U')[0]}
                    </div>
                    <div>
                        <p class="text-[11px] font-bold text-slate-900">${ins.clientName || 'Unnamed'}</p>
                        <p class="text-[9px] text-slate-400 font-medium">${ins.clientEmail || 'No email'}</p>
                    </div>
                </div>
            </td>
            <td class="px-8 py-6">
                <span class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest ${getStatusStyle(ins.status)} shadow-sm ring-1 ring-inset">
                    <span class="w-1 h-1 rounded-full bg-current"></span>
                    ${ins.status.replace('_', ' ')}
                </span>
            </td>
            <td class="px-8 py-6">
                <p class="text-[11px] font-bold text-slate-900">$${(ins.price || 0).toLocaleString()}</p>
                <p class="text-[9px] text-slate-400 font-medium">${ins.paymentStatus || 'unknown'}</p>
            </td>
            <td class="py-6 pl-3 pr-10 text-right">
                <a href="/api/inspections/${ins.id}/report" target="_blank" class="inline-flex items-center gap-2 text-slate-300 font-black text-[10px] uppercase tracking-widest hover:text-indigo-600 transition-all active:scale-95">
                    Live Report
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                </a>
            </td>
        </tr>
    `).join('');
}

function getStatusStyle(status) {
    const styles = {
        'scheduled': 'bg-slate-100 text-slate-600 ring-slate-200',
        'in_progress': 'bg-blue-50 text-blue-600 ring-blue-100',
        'pending': 'bg-amber-50 text-amber-600 ring-amber-100',
        'completed': 'bg-emerald-50 text-emerald-600 ring-emerald-100',
        'cancelled': 'bg-red-50 text-red-600 ring-red-100'
    };
    return styles[status] || styles['scheduled'];
}

async function fetchPrerequisites() {
    try {
        const [templatesRes, inspectorsRes] = await Promise.all([
            authFetch('/api/inspections/templates'),
            authFetch('/api/inspections/inspectors')
        ]);

        if (templatesRes.ok) {
            const tplData = await templatesRes.json();
            const list = tplData.data?.templates || tplData.templates || [];
            const select = document.getElementById('templateId');
            if (select) {
                list.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.innerText = t.name;
                    select.appendChild(opt);
                });
            }
        }

        if (inspectorsRes.ok) {
            const insData = await inspectorsRes.json();
            const list = insData.data?.inspectors || insData.inspectors || [];
            const select = document.getElementById('inspectorId');
            if (select) {
                list.forEach(i => {
                    const opt = document.createElement('option');
                    opt.value = i.id;
                    opt.innerText = i.email;
                    select.appendChild(opt);
                });
            }
        }
    } catch (e) {
        console.error('Prerequisites Load Error:', e);
    }
}

function showCreateModal() {
    document.getElementById('createModal')?.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('createModal')?.classList.add('hidden');
}

async function submitInspection() {
    const btn = document.getElementById('submitInsBtn');

    const body = {
        propertyAddress: document.getElementById('propAddress')?.value.trim(),
        templateId: document.getElementById('templateId')?.value,
        clientName: document.getElementById('clientName')?.value.trim(),
        clientEmail: document.getElementById('clientEmail')?.value.trim(),
        inspectorId: document.getElementById('inspectorId')?.value || undefined
    };

    if (!body.propertyAddress || !body.templateId) {
        modalAlert('Address and Template logic are required.', 'Validation');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Deploying...';
    }

    try {
       const res = await authFetch('/api/inspections', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(body)
       });

       if (res.ok) {
           await modalAlert('Inspection deployed successfully!', 'Success');
           closeModal();
           document.getElementById('propAddress').value = '';
           document.getElementById('templateId').value = '';
           document.getElementById('clientName').value = '';
           document.getElementById('clientEmail').value = '';
           document.getElementById('inspectorId').value = '';

           fetchInspections(true);
       } else {
           const err = await res.json();
           await modalAlert('Sync Error: ' + (err.error || 'Failed to deploy workflow'), 'Error');
       }
   } catch (e) {
       console.error(e);
       await modalAlert('Connection error while deploying workflow.', 'Error');
   } finally {
       if (btn) {
           btn.disabled = false;
           btn.innerText = 'Deploy Workflow';
       }
   }
}
