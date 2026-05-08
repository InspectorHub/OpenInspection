// Reports list — filters inspection list to delivery-ready statuses and adds
// quick actions (view public report, copy share link, mark delivered).
// Re-uses /api/inspections; reports are inspections whose status is one of
// completed/delivered/signed.

let _reports = [];
let _activeStatus = 'all';
let _searchDebounce = null;

// ─── Sub-spec B Task 3 — PageHeader meta ────────────────────────────────────
function reportsMeta() {
    return {
        delivered: 0,
        awaiting:  0,
        unpaid:    0,
        get metaText() {
            const total = this.delivered + this.awaiting + this.unpaid;
            if (total === 0) return 'No reports yet';
            const parts = [];
            if (this.delivered > 0) parts.push(this.delivered + ' delivered');
            if (this.awaiting > 0)  parts.push(this.awaiting + ' awaiting review');
            if (this.unpaid > 0)    parts.push(this.unpaid + ' unpaid');
            return parts.join(' · ');
        },
        async init() {
            try {
                const r = await authFetch('/api/inspections?status=completed&limit=200');
                if (!r.ok) return;
                const j = await r.json();
                const list = j.data?.inspections || [];
                this.delivered = list.filter(i => i.status === 'delivered' || i.status === 'signed').length;
                this.awaiting  = list.filter(i => i.status === 'completed').length;
                this.unpaid    = list.filter(i => i.paymentStatus && i.paymentStatus !== 'paid').length;
            } catch {}
        },
    };
}
document.addEventListener('alpine:init', () => window.Alpine.data('reportsMeta', reportsMeta));
window.reportsMeta = reportsMeta;

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.report-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeStatus = btn.dataset.status;
            document.querySelectorAll('.report-tab').forEach(b => {
                const isActive = b.dataset.status === _activeStatus;
                b.classList.toggle('bg-white', isActive);
                b.classList.toggle('text-indigo-700', isActive);
                b.classList.toggle('shadow-sm', isActive);
                b.classList.toggle('text-slate-500', !isActive);
            });
            render();
        });
    });

    const search = document.getElementById('reportsSearch');
    if (search) {
        search.addEventListener('input', () => {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(load, 350);
        });
    }

    load();
});

async function load() {
    const search = document.getElementById('reportsSearch')?.value.trim() || '';
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    try {
        const res = await authFetch('/api/inspections' + (params.toString() ? '?' + params.toString() : ''));
        if (res.status === 401) { window.location.href = '/login'; return; }
        if (!res.ok) return;
        const data = await res.json();
        // Reports = inspections that are no longer drafts.
        _reports = (data.data || []).filter(i => ['completed', 'delivered', 'signed'].includes(i.status));
        updateCounts();
        render();
    } catch (e) {
        console.error('[Reports] load error', e);
    }
}

function updateCounts() {
    const counts = { all: _reports.length, ready: 0, delivered: 0, signed: 0 };
    _reports.forEach(r => {
        if (r.status === 'completed') counts.ready++;
        else if (r.status === 'delivered') counts.delivered++;
        else if (r.status === 'signed') counts.signed++;
    });
    Object.entries(counts).forEach(([k, v]) => {
        const el = document.getElementById('report-count-' + k);
        if (el) el.textContent = String(v);
    });
}

function render() {
    const tbody = document.getElementById('reportsList');
    const cardList = document.getElementById('reportsCardList');
    if (!tbody) return;

    const filtered = _activeStatus === 'all'
        ? _reports
        : _reports.filter(r => {
            if (_activeStatus === 'ready') return r.status === 'completed';
            return r.status === _activeStatus;
        });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="py-24 text-center text-sm font-bold text-slate-400">No reports in this category yet.</td></tr>';
        if (cardList) cardList.innerHTML = '<div class="py-16 text-center text-sm font-bold text-slate-400">No reports in this category yet.</div>';
        return;
    }

    tbody.innerHTML = filtered.map(r => {
        const dateStr = formatDate(r.date || r.createdAt);
        return `
        <tr class="table-row-hover group">
            <td class="px-6 py-5"><a href="/inspections/${r.id}/edit" class="text-sm font-bold text-slate-900 hover:text-indigo-600 break-words">${_escapeHtml(r.propertyAddress || 'Untitled')}</a></td>
            <td class="px-6 py-5 text-xs font-bold text-slate-700">${_escapeHtml(r.clientName || '—')}</td>
            <td class="px-6 py-5 text-xs font-bold text-slate-500 font-mono">${_escapeHtml(dateStr)}</td>
            <td class="px-6 py-5"><span class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${statusStyle(r.status)} shadow-sm ring-1 ring-inset"><span class="w-1 h-1 rounded-full bg-current"></span>${_escapeHtml((r.status || '').replace('_', ' '))}</span></td>
            <td class="px-6 py-5"><span class="text-xs font-bold ${r.paymentStatus === 'paid' ? 'text-emerald-600' : 'text-amber-600'}">$${(r.price || 0).toLocaleString()} · ${_escapeHtml(r.paymentStatus || 'unpaid')}</span></td>
            <td class="px-6 py-5 text-right">
                <div class="flex items-center justify-end gap-2">
                    <a href="/api/inspections/${r.id}/report" target="_blank" class="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-600 transition-all">View</a>
                    <button onclick="copyReportLink('${r.id}')" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 transition-all">Copy Link</button>
                </div>
            </td>
        </tr>`;
    }).join('');

    if (cardList) {
        cardList.innerHTML = filtered.map(r => {
            const dateStr = formatDate(r.date || r.createdAt);
            return `
            <a href="/inspections/${r.id}/edit" class="block glass-panel rounded-md p-4 hover:shadow-lg transition active:scale-[0.98]">
                <div class="flex items-start justify-between gap-3 mb-2">
                    <p class="text-sm font-bold text-slate-900 break-words flex-1">${_escapeHtml(r.propertyAddress || 'Untitled')}</p>
                    <span class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${statusStyle(r.status)} shadow-sm ring-1 ring-inset">
                        <span class="w-1 h-1 rounded-full bg-current"></span>${_escapeHtml((r.status || '').replace('_', ' '))}
                    </span>
                </div>
                <div class="text-xs text-slate-500 space-y-0.5">
                    <p><span class="font-semibold text-slate-700">${_escapeHtml(r.clientName || '—')}</span></p>
                    <p class="font-mono text-[10px] text-slate-400">${_escapeHtml(dateStr || '')} · $${(r.price || 0).toLocaleString()}</p>
                </div>
            </a>`;
        }).join('');
    }
}

function statusStyle(s) {
    const map = {
        'completed': 'bg-amber-50 text-amber-600 ring-amber-100',
        'delivered': 'bg-emerald-50 text-emerald-600 ring-emerald-100',
        'signed': 'bg-violet-50 text-violet-600 ring-violet-100',
    };
    return map[s] || 'bg-slate-100 text-slate-600 ring-slate-200';
}

function formatDate(d) {
    if (!d) return '—';
    try {
        return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return '—'; }
}

async function copyReportLink(id) {
    const url = window.location.origin + '/report/' + id;
    try {
        await navigator.clipboard.writeText(url);
        if (typeof showToast === 'function') showToast('Public report link copied.');
    } catch {
        prompt('Copy this URL:', url);
    }
}

window.copyReportLink = copyReportLink;
