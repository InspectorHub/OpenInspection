// Cookie-only auth: the HttpOnly inspector_token cookie is sent automatically on same-origin
// fetches. Do NOT read/write the token from JS — that would downgrade the cookie to JS-readable.

const authFetch = (url, opts = {}) =>
    fetch(url, { credentials: 'same-origin', ...opts });

async function logout() {
    try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
}

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
            avatarEl.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=6366f1&color=fff';
            avatarEl.alt = name;
        }
    } catch (e) {
        console.error('Failed to load session:', e);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    loadTemplates();
});

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
        try { const p = JSON.parse(schema); return Array.isArray(p) ? p.length : 0; } catch { return 0; }
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
              <div class="flex flex-col items-center gap-4 animate-slide-in">
                <div class="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-2">
                  <svg class="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                </div>
                <p class="text-xl font-bold text-slate-900">No templates yet</p>
                <p class="text-slate-500 max-w-xs mx-auto">Click "New Template" to create your first checklist.</p>
              </div>
            </td>
          </tr>`;
        return;
    }
    tbody.innerHTML = allTemplates.map(t => {
        const itemCount = countSchemaItems(t.schema);
        return `
          <tr class="table-row-hover group">
            <td class="py-6 pl-10 pr-3">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                </div>
                <div>
                  <p class="text-sm font-bold text-slate-900">${t.name}</p>
                  <p class="text-[10px] text-slate-400 font-mono tracking-tighter uppercase">Ref: ${t.id.split('-')[0]}</p>
                </div>
              </div>
            </td>
            <td class="px-6 py-6">
              <span class="inline-flex items-center rounded-lg border border-indigo-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-indigo-50/50 text-indigo-600">v${t.version}.0</span>
            </td>
            <td class="px-6 py-6 text-sm text-slate-500 font-bold">${itemCount} Points</td>
            <td class="py-6 pl-3 pr-10 text-right">
              <button onclick="deleteTemplate('${t.id}')" class="inline-flex items-center gap-2 text-slate-300 font-black text-[10px] uppercase tracking-widest hover:text-red-500 transition-all active:scale-95">
                Remove
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            </td>
          </tr>`;
    }).join('');
}

async function deleteTemplate(id) {
    if (!await modalConfirm('Eliminate this template from the repository?', 'Remove Template')) return;
    const res = await authFetch('/api/inspections/templates/' + id, { method: 'DELETE' });
    if (res.ok) {
        allTemplates = allTemplates.filter(t => t.id !== id);
        renderTemplates();
    } else {
        const err = await res.json();
        modalAlert('Deployment Error: ' + (err.error || 'Failed to delete'), 'Error');
    }
}

function showCreateModal() {
    document.getElementById('createModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('createModal').classList.add('hidden');
    document.getElementById('tplName').value = '';
    document.getElementById('tplSchema').value = '';
}

async function submitTemplate() {
    const name = document.getElementById('tplName').value.trim();
    const schemaRaw = document.getElementById('tplSchema').value.trim();
    if (!name) { modalAlert('Please enter a template name.', 'Validation'); return; }
    let schema;
    try {
        schema = schemaRaw ? JSON.parse(schemaRaw) : [];
    } catch {
        modalAlert('Schema must be valid JSON.', 'Validation'); return;
    }
    const btn = document.getElementById('submitTplBtn');
    btn.disabled = true;
    btn.textContent = 'Deploying...';

    const res = await authFetch('/api/inspections/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, schema })
    });
    btn.disabled = false;
    btn.textContent = 'Deploy Template';
    if (res.ok) {
        closeModal();
        loadTemplates();
    } else {
        const err = await res.json();
        modalAlert('Sync Error: ' + (err.error || 'Failed to create'), 'Error');
    }
}
