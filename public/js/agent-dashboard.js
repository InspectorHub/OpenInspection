// Cookie-only auth. htmlAuthGuard already gated this page server-side.

const authFetch = (url, opts = {}) =>
    fetch(url, { credentials: 'same-origin', ...opts });

async function logout() {
    try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);

const statusColors = {
    draft: 'bg-amber-100/50 text-amber-700 border-amber-200',
    completed: 'bg-emerald-100/50 text-emerald-700 border-emerald-200',
    delivered: 'bg-indigo-100/50 text-indigo-700 border-indigo-200',
};

async function loadReports() {
    try {
        const res = await authFetch('/api/agent/my-reports');
        if (res.status === 401) { window.location.href = '/login'; return; }
        const reportsList = document.getElementById('reportsList');
        if (!reportsList) return;

        if (!res.ok) {
            reportsList.innerHTML =
                '<tr><td colspan="4" class="py-20 text-center text-sm text-red-500">Failed to load referrals. Check your session.</td></tr>';
            return;
        }
        const response = await res.json();
        const reports = (response.data && response.data.reports) || response.reports || [];
        const statTotal = document.getElementById('statTotal');
        if (statTotal) statTotal.textContent = reports.length.toString();

        if (reports.length === 0) {
            reportsList.innerHTML =
                '<tr><td colspan="4" class="py-20 text-center text-sm text-slate-400">No referred inspections yet.</td></tr>';
            return;
        }

        reportsList.innerHTML = reports.map(r => `
            <tr class="hover:bg-slate-50/80 transition-colors">
                <td class="py-5 pl-8 pr-3 text-sm font-semibold text-slate-900">${r.propertyAddress}</td>
                <td class="px-6 py-5 text-sm text-slate-600">
                    <p>${r.clientName || '—'}</p>
                    <p class="text-xs text-slate-400">${r.clientEmail || ''}</p>
                </td>
                <td class="px-6 py-5">
                    <span class="inline-flex items-center rounded-xl border px-3 py-1 text-xs font-bold ${statusColors[r.status] || 'bg-slate-100 text-slate-600 border-slate-200'}">
                        ${r.status.toUpperCase()}
                    </span>
                </td>
                <td class="px-6 py-5 text-sm text-slate-600">${new Date(r.date).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error(e);
    }
}

loadReports();
