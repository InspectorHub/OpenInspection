let allTemplates = [];

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const meRes = await authFetch('/api/auth/me');
        if (meRes.status === 401) { window.location.href = '/login'; return; }
        const me = await meRes.json();
        const email = me?.data?.user?.email || '';
        const name = email ? email.split('@')[0] : 'User';
        const avatarEl = document.querySelector('nav img[alt="User"]');
        if (avatarEl) {
            avatarEl.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="8" fill="%236366f1"/><text x="32" y="32" text-anchor="middle" dy=".35em" fill="white" font-family="sans-serif" font-size="24" font-weight="600">' + (name.charAt(0) || 'U').toUpperCase() + '</text></svg>');
            avatarEl.alt = name;
        }
    } catch (e) {
        console.error('Failed to load session:', e);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    loadTemplates();
});

// ─── Sub-spec B Task 3 — PageHeader meta ────────────────────────────────────
function templatesMeta() {
    return {
        total:    0,
        imported: 0,
        updates:  0,
        get metaText() {
            if (this.total === 0) return 'No templates yet';
            const parts = [this.total + ' template' + (this.total === 1 ? '' : 's')];
            if (this.imported > 0) parts.push(this.imported + ' imported from Marketplace');
            if (this.updates > 0)  parts.push(this.updates + ' with updates available');
            return parts.join(' · ');
        },
        async init() {
            try {
                const r = await authFetch('/api/inspections/templates');
                if (!r.ok) return;
                const j = await r.json();
                const list = j.data?.templates || j.data || [];
                this.total    = list.length;
                this.imported = list.filter(t => t.marketplaceTemplateId).length;
                this.updates  = list.filter(t => t.upstreamUpdateAvailable).length;
            } catch {}
        },
    };
}
document.addEventListener('alpine:init', () => window.Alpine.data('templatesMeta', templatesMeta));
window.templatesMeta = templatesMeta;

async function loadTemplates() {
    try {
        const res = await authFetch('/api/inspections/templates');
        if (res.status === 401) { window.location.href = '/login'; return; }
        const tbody = document.getElementById('templatesList');
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="4" class="py-20 text-center text-sm text-red-500 font-bold">Failed to load templates.</td></tr>';
            return;
        }
        const response = await res.json();
        allTemplates = (response.data && response.data.templates) || response.templates || [];
        renderTemplates();
    } catch (e) {
        console.error('Failed to load templates:', e);
        const tbody = document.getElementById('templatesList');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" class="py-20 text-center text-sm text-red-500 font-bold">Network error while fetching templates.</td></tr>';
        }
    }
}

function countSchemaItems(schema) {
    if (!schema) return 0;
    if (Array.isArray(schema)) return schema.length;
    if (typeof schema === 'string') {
        try { const p = JSON.parse(schema); return Array.isArray(p) ? p.length : countSchemaItems(p); } catch { return 0; }
    }
    if (typeof schema === 'object' && Array.isArray(schema.items)) return schema.items.length;
    if (typeof schema === 'object' && Array.isArray(schema.sections)) {
        return schema.sections.reduce((acc, sec) => acc + (Array.isArray(sec.items) ? sec.items.length : 0), 0);
    }
    return 0;
}

function renderTemplates() {
    const tbody = document.getElementById('templatesList');
    if (!tbody) return;

    if (allTemplates.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="py-32 text-center">
              <div class="flex flex-col items-center gap-6">
                <div class="w-20 h-20 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <svg class="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                </div>
                <div>
                  <p class="text-lg font-bold text-slate-900 tracking-tight">No templates yet</p>
                  <p class="text-sm text-slate-400 font-medium mt-1">Create a checklist template for your inspections.</p>
                </div>
                <button onclick="showCreateModal()" class="px-6 py-3 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-900 transition-all active:scale-95">New Template</button>
              </div>
            </td>
          </tr>`;
        return;
    }
    tbody.innerHTML = allTemplates.map(t => {
        const itemCount = t.itemCount ?? countSchemaItems(t.schema);
        return `
          <tr class="table-row-hover group">
            <td class="py-6 pl-10 pr-3">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <a href="/templates/${t.id}/edit" class="text-sm font-bold text-slate-900 hover:text-indigo-600 transition-colors">${t.name}</a>
                    ${t.source === 'marketplace' ? '<span class="text-[9px] font-bold uppercase tracking-widest text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">Marketplace</span>' : ''}
                  </div>
                  <p class="text-[10px] text-slate-400 font-medium" title="${t.id}">${itemCount} items · v${t.version}.0${t.source === 'marketplace' ? ' · Imported from Marketplace' : ''}</p>
                </div>
              </div>
            </td>
            <td class="px-6 py-6">
              <span class="inline-flex items-center rounded-lg border border-indigo-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-indigo-50/50 text-indigo-600">v${t.version}.0</span>
            </td>
            <td class="px-6 py-6 text-sm text-slate-500 font-bold">${itemCount} items</td>
            <td class="py-6 pl-3 pr-10 text-right">
              <div class="inline-flex items-center gap-4">
                <a href="/templates/${t.id}/edit" class="inline-flex items-center gap-1 text-indigo-600 font-bold text-[10px] uppercase tracking-widest hover:text-indigo-700 transition-all" title="Open in template editor">
                  Edit
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                </a>
                <button onclick="deleteTemplate('${t.id}')" class="inline-flex items-center gap-1 text-slate-300 font-bold text-[10px] uppercase tracking-widest hover:text-red-500 transition-all active:scale-95" title="Delete this template (cannot be undone)">
                  Remove
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            </td>
          </tr>`;
    }).join('');
}

async function deleteTemplate(id) {
    if (!await modalConfirm('Delete this template?', 'Delete Template')) return;
    const res = await authFetch('/api/inspections/templates/' + id, { method: 'DELETE' });
    if (res.ok) {
        allTemplates = allTemplates.filter(t => t.id !== id);
        renderTemplates();
    } else {
        const err = await res.json();
        modalAlert('Error: ' + (err.error || 'Failed to delete'), 'Error');
    }
}

function showCreateModal() {
    document.getElementById('createModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('createModal').classList.add('hidden');
    document.getElementById('tplName').value = '';
}

async function submitTemplate() {
    const name = document.getElementById('tplName').value.trim();
    if (!name) { modalAlert('Please enter a template name.', 'Validation'); return; }

    const btn = document.getElementById('submitTplBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const res = await authFetch('/api/inspections/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, schema: { sections: [], ratingLevels: [] } })
        });
        if (res.ok) {
            const result = await res.json();
            const newId = result?.data?.template?.id;
            closeModal();
            if (newId) {
                window.location.href = '/templates/' + newId + '/edit';
            } else {
                loadTemplates();
            }
        } else {
            const err = await res.json();
            modalAlert('Error: ' + (err.error || 'Failed to create'), 'Error');
        }
    } catch (e) {
        modalAlert('Connection error: ' + e.message, 'Error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Template';
    }
}

// Sprint 1 B-8 — Marketplace duplicate banner Alpine handler.
// Detects tenants with > 1 local copy of the same marketplace template and
// surfaces compare/use-new/keep-both actions on /templates.
document.addEventListener('alpine:init', function () {
    var DISMISS_KEY = 'oi.marketplace.dismissedDuplicates';

    function loadDismissed() {
        try {
            var raw = localStorage.getItem(DISMISS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }
    function saveDismissed(list) {
        try { localStorage.setItem(DISMISS_KEY, JSON.stringify(list)); } catch (e) { /* silent */ }
    }

    window.Alpine.data('duplicateBanner', function () {
        return {
            groups:    [],
            dismissed: false,
            dismissedIds: loadDismissed(),

            async load() {
                try {
                    var res = await authFetch('/api/inspections/templates/duplicates');
                    if (!res.ok) return;
                    var json = await res.json();
                    var all = (json && json.data) || [];
                    var self = this;
                    this.groups = all.filter(function (g) { return self.dismissedIds.indexOf(g.marketplaceId) === -1; });
                } catch (e) { /* silent */ }
            },

            oldestVersion(g) {
                if (!g || !g.copies || g.copies.length === 0) return '';
                var sorted = g.copies.slice().sort(function (a, b) {
                    return String(a.version).localeCompare(String(b.version));
                });
                return sorted[0].version;
            },

            compareVersions(g) {
                if (!g || !g.copies || g.copies.length < 2) return;
                var ids = g.copies.map(function (c) { return c.id; }).join(',');
                window.location.href = '/templates/compare?ids=' + encodeURIComponent(ids);
            },

            useNewOnly(g) {
                if (typeof showToast === 'function') {
                    showToast('Migration ships in next release (Sprint 2 S2-6).', false);
                } else {
                    window.alert('Migration ships in next release.');
                }
            },

            keepBoth(g) {
                if (!g || !g.marketplaceId) return;
                this.dismissedIds.push(g.marketplaceId);
                saveDismissed(this.dismissedIds);
                this.groups = this.groups.filter(function (x) { return x.marketplaceId !== g.marketplaceId; });
                if (typeof showToast === 'function') {
                    showToast('Banner dismissed. Manage copies anytime in this list.', false);
                }
            },
        };
    });
});

