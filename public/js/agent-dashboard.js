const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);

// ─── Sub-spec B Task 3 — PageHeader meta ────────────────────────────────────
function agentMeta() {
    return {
        total:   0,
        pending: 0,
        async init() {
            try {
                const r = await authFetch('/api/agent/my-reports');
                if (!r.ok) return;
                const j = await r.json();
                const list = j.data?.reports || j.data || [];
                this.total = list.length;
                this.pending = list.filter(x => x.status === 'draft' || x.status === 'in_progress').length;
            } catch {}
        },
    };
}
document.addEventListener('alpine:init', () => window.Alpine.data('agentMeta', agentMeta));
window.agentMeta = agentMeta;

// Sub-spec D Task 7 — Alpine factory for the hero strip + share-with-buyer
// CTA. State is mutated by loadReports() once the referral list is fetched
// so the hero reflects the most recent referral.
document.addEventListener('alpine:init', function () {
    if (!window.Alpine || typeof window.Alpine.data !== 'function') return;
    window.Alpine.data('agentDashboardState', function () {
        return {
            hero: {
                inspectionId:    '',
                propertyAddress: '',
                subline:         '',
                inspectorName:   '',
                status:          '',
            },
            init() {
                window.__oiAgentHero = this.hero;
            },
            shareToBuyer() {
                if (!this.hero.inspectionId) {
                    if (typeof window.showToast === 'function') window.showToast('No referral selected to share', false);
                    return;
                }
                const fetchFn = typeof window.authFetch === 'function' ? window.authFetch : window.fetch.bind(window);
                fetchFn('/api/inspections/' + this.hero.inspectionId + '/agent-token', { method: 'POST' })
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        const url = j && j.data && j.data.url;
                        if (!url) throw new Error(j && j.error && j.error.message);
                        if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
                        if (typeof window.showToast === 'function') window.showToast('Buyer share link copied to clipboard');
                    })
                    .catch(function (err) {
                        console.warn('[agent-dashboard] shareToBuyer failed', err);
                        if (typeof window.showToast === 'function') window.showToast('Could not generate share link', false);
                    });
            },
        };
    });
});

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

        // Sub-spec D Task 7 — push the most recent referral into the hero
        // strip so the address + share CTA refer to a real inspection.
        const hero = window.__oiAgentHero;
        if (hero && reports.length > 0) {
            const top = reports[0];
            hero.inspectionId    = top.id || '';
            hero.propertyAddress = top.propertyAddress || '';
            const date = top.date ? new Date(top.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            hero.subline         = date + (top.clientName ? (date ? ' · for ' : 'for ') + top.clientName : '');
            hero.inspectorName   = top.inspectorName || '';
            hero.status          = top.status || 'published';
        }

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

// Spec 5G — Leaderboard card (closes API-only orphan from Round 27 audit).
async function loadLeaderboard() {
    try {
        const res = await authFetch('/api/agent/leaderboard');
        if (!res.ok) return;
        const response = await res.json();
        const list = (response.data && response.data.leaderboard) || [];
        const tbody = document.getElementById('leaderboardList');
        if (!tbody) return;
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="py-12 text-center text-xs text-slate-400 italic">No referrals tracked yet.</td></tr>';
            return;
        }
        // top 10 only
        const top = list.slice(0, 10);
        const max = top[0]?.total || 1;
        tbody.innerHTML = top.map((r, i) => {
            const pct = Math.round((r.total / max) * 100);
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            return `
                <tr class="border-b border-slate-100 last:border-0">
                    <td class="py-2 pl-4 pr-2 text-sm font-mono text-slate-500 w-12">${medal}</td>
                    <td class="px-2 py-2 text-sm">
                        <div class="font-semibold text-slate-900">${r.name || '<span class=\\'italic text-slate-400\\'>Unknown agent</span>'}</div>
                        <div class="text-[11px] text-slate-500">${r.agency || ''}</div>
                    </td>
                    <td class="px-2 py-2 w-32">
                        <div class="h-1.5 bg-indigo-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-600 rounded-full" style="width: ${pct}%"></div></div>
                    </td>
                    <td class="px-2 py-2 pr-4 text-sm font-bold text-indigo-600 text-right w-16">${r.total}</td>
                </tr>
            `;
        }).join('');
    } catch (e) { console.error(e); }
}

loadLeaderboard();
