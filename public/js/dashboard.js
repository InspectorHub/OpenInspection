let inspections = [];
let allInspectors = [];
let allTemplates = [];
let searchDebounce;
let currentUserEmail = '';
let selectedInspectorId = '';
let availableServices = [];
let selectedServiceIds = [];
let discountCode = '';
let discountResult = null;
let activeTab = 'all';
let tabCounts = { all: 0, today: 0, upcoming: 0, past: 0, unconfirmed: 0, inProgress: 0 };

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
        avatarEl.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="8" fill="%236366f1"/><text x="32" y="32" text-anchor="middle" dy=".35em" fill="white" font-family="sans-serif" font-size="24" font-weight="600">' + (name.charAt(0) || 'U').toUpperCase() + '</text></svg>');
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

    const inspectorFilter = document.getElementById('filterInspector');
    if (inspectorFilter) {
        inspectorFilter.onchange = () => {
            selectedInspectorId = inspectorFilter.value;
            fetchInspections(true);
        };
    }

    fetchInspections(true);
    fetchCounts();
    fetchPrerequisites();
    loadServices();
});

async function fetchInspections() {
    const tbody = document.getElementById('inspectionsList');
    if (!tbody) return;

    try {
        const searchInput = document.getElementById('filterSearch');
        const query = searchInput ? searchInput.value.trim() : '';
        const params = new URLSearchParams();
        if (query) params.set('search', query);
        if (selectedInspectorId) params.set('inspectorId', selectedInspectorId);
        if (activeTab && activeTab !== 'all') params.set('tab', activeTab);
        const qs = params.toString();
        const url = qs ? `/api/inspections?${qs}` : '/api/inspections';

        const res = await authFetch(url);
        if (res.status === 401) { window.location.href = '/login'; return; }

        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-20 text-center text-sm font-bold text-red-500">Failed to sync with registry.</td></tr>';
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
            tbody.innerHTML = '<tr><td colspan="7" class="py-20 text-center text-sm font-bold text-red-500">Network error during synchronization.</td></tr>';
        }
    }
}

async function fetchCounts() {
    try {
        const res = await authFetch('/api/inspections/counts');
        if (!res.ok) return;
        const json = await res.json();
        tabCounts = json.data || tabCounts;
        renderTabCounts();
        // Default to Today tab if there are inspections today, else Upcoming
        if (activeTab === 'all' && (tabCounts.today > 0 || tabCounts.upcoming > 0)) {
            activeTab = tabCounts.today > 0 ? 'today' : 'upcoming';
            renderTabActive();
            fetchInspections();
        }
    } catch (e) {
        console.error('[Dashboard] fetchCounts error', e);
    }
}

async function loadServices() {
    try {
        const res = await authFetch('/api/services');
        if (!res.ok) return;
        const json = await res.json();
        availableServices = json.data || [];
        renderServicesSection();
    } catch (e) {
        console.error('[Dashboard] loadServices error', e);
    }
}

function renderServicesSection() {
    const container = document.getElementById('servicesSection');
    if (!container) return;
    if (availableServices.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    const list = document.getElementById('servicesList');
    if (!list) return;
    list.innerHTML = availableServices.map(svc => `
        <div onclick="toggleService('${svc.id}')" id="svc-card-${svc.id}"
             class="flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all border-slate-200 bg-white">
            <div id="svc-check-${svc.id}" class="w-5 h-5 rounded-md border-2 border-slate-300 flex items-center justify-center text-xs font-bold text-white flex-shrink-0"></div>
            <div class="flex-1 min-w-0">
                <div class="text-sm font-bold text-slate-900">${svc.name}</div>
                ${svc.durationMinutes ? `<div class="text-xs text-slate-400">⏱ ${svc.durationMinutes} min</div>` : ''}
            </div>
            <div class="text-sm font-black text-slate-900">${formatCents(svc.price)}</div>
        </div>
    `).join('');
    updateTotalBar();
}

function toggleService(id) {
    const idx = selectedServiceIds.indexOf(id);
    if (idx >= 0) selectedServiceIds.splice(idx, 1);
    else selectedServiceIds.push(id);

    // Update card style
    const card = document.getElementById('svc-card-' + id);
    const check = document.getElementById('svc-check-' + id);
    const selected = selectedServiceIds.includes(id);
    if (card) {
        card.className = `flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'}`;
    }
    if (check) {
        check.className = `w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 ${selected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300'}`;
        check.textContent = selected ? '✓' : '';
    }
    discountResult = null;
    discountCode = '';
    const codeInput = document.getElementById('discountCodeInput');
    if (codeInput) codeInput.value = '';
    updateTotalBar();
}

function calcSubtotal() {
    return availableServices
        .filter(s => selectedServiceIds.includes(s.id))
        .reduce((sum, s) => sum + s.price, 0);
}

function calcTotal() {
    const subtotal = calcSubtotal();
    const discount = discountResult?.valid ? discountResult.discountAmount : 0;
    return Math.max(0, subtotal - discount);
}

function formatCents(cents) {
    return '$' + (cents / 100).toFixed(2);
}

function updateTotalBar() {
    const bar = document.getElementById('serviceTotalBar');
    if (!bar) return;
    const count = selectedServiceIds.length;
    bar.style.display = count > 0 ? 'block' : 'none';
    const totalEl = document.getElementById('serviceTotalAmount');
    if (totalEl) totalEl.textContent = formatCents(calcTotal());
    const countEl = document.getElementById('serviceCountLabel');
    if (countEl) countEl.textContent = `${count} service${count !== 1 ? 's' : ''}`;
    const discountEl = document.getElementById('serviceDiscountLine');
    if (discountEl) {
        discountEl.style.display = discountResult?.valid ? 'block' : 'none';
        if (discountResult?.valid) {
            discountEl.textContent = `-${formatCents(discountResult.discountAmount)} discount`;
        }
    }
}

async function validateDiscount() {
    const input = document.getElementById('discountCodeInput');
    const code = input?.value.trim();
    if (!code) return;
    discountCode = code;
    try {
        const res = await authFetch('/api/services/discount/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, subtotal: calcSubtotal() }),
        });
        const json = await res.json();
        discountResult = json.data;
        updateTotalBar();
        const errEl = document.getElementById('discountError');
        if (errEl) {
            errEl.style.display = discountResult?.valid ? 'none' : 'block';
            errEl.textContent = discountResult?.message || '';
        }
    } catch (e) {
        console.error('[Dashboard] validateDiscount error', e);
    }
}
window.toggleService = toggleService;
window.validateDiscount = validateDiscount;

function renderTabCounts() {
    // Map tab keys to API response keys (only in_progress differs)
    const countKeyMap = { in_progress: 'inProgress' };
    ['all', 'today', 'upcoming', 'past', 'unconfirmed', 'in_progress'].forEach(key => {
        const badge = document.getElementById('tab-count-' + key);
        if (badge) badge.textContent = String(tabCounts[countKeyMap[key] || key] ?? 0);
    });

    // Show unconfirmed warning banner
    const banner = document.getElementById('unconfirmedBanner');
    const bannerText = document.getElementById('unconfirmedBannerText');
    if (banner && bannerText) {
        const count = tabCounts.unconfirmed || 0;
        banner.style.display = count > 0 ? 'flex' : 'none';
        bannerText.textContent = `${count} unconfirmed inspection${count !== 1 ? 's' : ''} awaiting confirmation`;
    }
}

function renderTabActive() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
        const tab = btn.getAttribute('data-tab');
        const isActive = tab === activeTab;
        btn.classList.toggle('bg-white', isActive);
        btn.classList.toggle('text-indigo-700', isActive);
        btn.classList.toggle('shadow-sm', isActive);
        btn.classList.toggle('text-slate-500', !isActive);
    });
}

function setTab(tab) {
    activeTab = tab;
    renderTabActive();
    fetchInspections();
}

window.setTab = setTab;

function updateStats(counts) {
    const map = {
        'statActive': counts.total || 0,
        'statProgress': counts.draft || 0,
        'statReview': counts.completed || 0,
        'statCompleted': counts.delivered || 0,
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
                <td colspan="7" class="py-32 text-center">
                    <div class="flex flex-col items-center gap-6">
                        <div class="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center">
                            <svg class="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        </div>
                        <div>
                            <p class="text-lg font-black text-slate-900 tracking-tight">No inspections yet</p>
                            <p class="text-sm text-slate-400 font-medium mt-1">Create your first inspection to get started.</p>
                        </div>
                        <button onclick="showCreateModal()" class="px-6 py-3 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-900 transition-all active:scale-95">New Inspection</button>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = list.map(ins => {
        const inspectorName = getInspectorName(ins.inspectorId);
        const dateStr = formatInspectionDate(ins.createdAt || ins.scheduledDate);
        return `
        <tr class="table-row-hover group">
            <td class="py-6 px-10">
                <div>
                    <a href="/inspections/${ins.id}/edit" class="text-sm font-bold text-slate-900 hover:text-indigo-600 transition-colors">${ins.propertyAddress}</a>
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
                <p class="text-[11px] font-bold text-slate-700">${inspectorName}</p>
            </td>
            <td class="px-8 py-6">
                <p class="text-[11px] font-bold text-slate-700">${dateStr}</p>
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
                <div class="flex items-center justify-end gap-3">
                    <a href="/api/inspections/${ins.id}/report" target="_blank" class="inline-flex items-center gap-1.5 text-slate-300 font-black text-[10px] uppercase tracking-widest hover:text-indigo-600 transition-all" title="View Report">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>
                    <button onclick="cloneInspection('${ins.id}')" class="text-slate-200 hover:text-indigo-600 transition-colors p-1" aria-label="Clone inspection" title="Clone">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                    <button onclick="deleteInspection('${ins.id}')" class="text-slate-200 hover:text-red-500 transition-colors p-1" aria-label="Delete inspection" title="Delete">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function getStatusStyle(status) {
    const styles = {
        'draft': 'bg-slate-100 text-slate-600 ring-slate-200',
        'scheduled': 'bg-slate-100 text-slate-600 ring-slate-200',
        'confirmed': 'bg-blue-50 text-blue-700 ring-blue-200',
        'in_progress': 'bg-blue-50 text-blue-600 ring-blue-100',
        'pending': 'bg-amber-50 text-amber-600 ring-amber-100',
        'completed': 'bg-emerald-50 text-emerald-600 ring-emerald-100',
        'delivered': 'bg-purple-50 text-purple-600 ring-purple-100',
        'cancelled': 'bg-red-50 text-red-600 ring-red-100',
    };
    return styles[status] || styles['draft'];
}

function getInspectorName(inspectorId) {
    if (!inspectorId) return '—';
    for (var i = 0; i < allInspectors.length; i++) {
        if (allInspectors[i].id === inspectorId) {
            return allInspectors[i].name || allInspectors[i].email.split('@')[0];
        }
    }
    return inspectorId.split('-')[0];
}

function formatInspectionDate(dateStr) {
    if (!dateStr) return '—';
    try {
        var d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return '—'; }
}

async function cloneInspection(id) {
    var ins = inspections.find(function(i) { return i.id === id; });
    if (!ins) return;
    var confirmed = await modalConfirm(
        'Create a new inspection at "' + ins.propertyAddress + '" with the same template and client details?',
        'Clone Inspection'
    );
    if (!confirmed) return;
    try {
        var res = await authFetch('/api/inspections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyAddress: ins.propertyAddress,
                templateId: ins.templateId,
                clientName: ins.clientName || '',
                clientEmail: ins.clientEmail || '',
                inspectorId: ins.inspectorId || undefined
            })
        });
        if (res.ok) {
            showToast('Inspection cloned successfully.');
            fetchInspections(true);
        } else {
            var err = await res.json().catch(function() { return {}; });
            modalAlert('Failed to clone: ' + (err.error?.message || 'Unknown error'), 'Error');
        }
    } catch (e) {
        modalAlert('Network error: ' + e.message, 'Error');
    }
}

async function fetchPrerequisites() {
    try {
        const [templatesRes, inspectorsRes] = await Promise.all([
            authFetch('/api/inspections/templates'),
            authFetch('/api/inspections/inspectors')
        ]);

        if (templatesRes.ok) {
            const tplData = await templatesRes.json();
            allTemplates = tplData.data?.templates || tplData.templates || [];
            const select = document.getElementById('templateId');
            const noTplHint = document.getElementById('noTemplateHint');
            if (select) {
                allTemplates.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.innerText = t.name;
                    select.appendChild(opt);
                });
            }
            if (noTplHint) {
                noTplHint.classList.toggle('hidden', allTemplates.length > 0);
            }
        }

        if (inspectorsRes.ok) {
            const insData = await inspectorsRes.json();
            allInspectors = insData.data?.inspectors || insData.inspectors || [];

            // Populate the modal assign-inspector select
            const select = document.getElementById('inspectorId');
            if (select) {
                allInspectors.forEach(i => {
                    const opt = document.createElement('option');
                    opt.value = i.id;
                    opt.innerText = i.name || i.email;
                    select.appendChild(opt);
                });
            }

            // Populate the filter dropdown
            const filterSelect = document.getElementById('filterInspector');
            if (filterSelect && allInspectors.length > 0) {
                allInspectors.forEach(i => {
                    const opt = document.createElement('option');
                    opt.value = i.id;
                    opt.innerText = i.name || i.email.split('@')[0];
                    filterSelect.appendChild(opt);
                });
            }

            // Re-render now that inspector names are available
            if (inspections.length > 0) renderInspections(inspections);
        }
    } catch (e) {
        console.error('Prerequisites Load Error:', e);
    }

    try {
        await populateAgents();
    } catch (e) {
        console.error('populateAgents failed:', e);
    }
}

async function populateAgents() {
    const res = await authFetch('/api/contacts?type=agent&limit=100');
    if (!res.ok) return;
    const data = await res.json();
    const agents = data.data?.contacts || [];
    const select = document.getElementById('agentId');
    if (!select || agents.length === 0) return;
    agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.innerText = a.name || a.email || a.id;
        select.appendChild(opt);
    });
}

function showCreateModal() {
    document.getElementById('createModal')?.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('createModal')?.classList.add('hidden');
}

async function deleteInspection(id) {
    var confirmed = await modalConfirm('This will permanently delete this inspection and all its data. This cannot be undone.', 'Delete Inspection');
    if (!confirmed) return;
    try {
        var res = await authFetch('/api/inspections/' + id, { method: 'DELETE' });
        if (res.ok) {
            fetchInspections();
        } else {
            var err = await res.json().catch(function() { return {}; });
            modalAlert('Failed to delete: ' + (err.error?.message || 'Unknown error'), 'Error');
        }
    } catch (e) {
        modalAlert('Network error: ' + e.message, 'Error');
    }
}

async function submitInspection() {
    const btn = document.getElementById('submitInsBtn');

    const rawDate = document.getElementById('inspectionDate')?.value;
    const body = {
        propertyAddress: document.getElementById('propAddress')?.value.trim(),
        templateId: document.getElementById('templateId')?.value,
        clientName: document.getElementById('clientName')?.value.trim(),
        clientEmail: document.getElementById('clientEmail')?.value.trim(),
        clientPhone: document.getElementById('clientPhone')?.value.trim() || undefined,
        inspectorId: document.getElementById('inspectorId')?.value || undefined,
        date: rawDate ? new Date(rawDate).toISOString() : undefined,
        referredByAgentId: document.getElementById('agentId')?.value || undefined,
        serviceIds: selectedServiceIds.length > 0 ? [...selectedServiceIds] : undefined,
        price: selectedServiceIds.length > 0 ? calcTotal() : undefined,
        discountCodeId: discountResult?.valid ? discountResult.discountCodeId : undefined,
        discountAmount: discountResult?.valid ? discountResult.discountAmount : undefined,
    };

    if (!body.propertyAddress || !body.templateId) {
        modalAlert('Address and template are required.', 'Validation');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Creating...';
    }

    try {
       const res = await authFetch('/api/inspections', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(body)
       });

       if (res.ok) {
           const data = await res.json();
           const newId = data?.data?.inspection?.id;
           closeModal();
           selectedServiceIds = [];
           discountResult = null;
           renderServicesSection();
           document.getElementById('propAddress').value = '';
           document.getElementById('templateId').value = '';
           document.getElementById('clientName').value = '';
           document.getElementById('clientEmail').value = '';
           document.getElementById('clientPhone').value = '';
           document.getElementById('inspectionDate').value = '';
           document.getElementById('inspectorId').value = '';
           document.getElementById('agentId').value = '';

           if (newId) {
               window.location.href = '/inspections/' + newId + '/edit';
               return;
           }
           fetchInspections(true);
       } else {
           const err = await res.json();
           await modalAlert('Error: ' + (err.error?.message || err.error || 'Failed to create inspection'), 'Error');
       }
   } catch (e) {
       console.error(e);
       await modalAlert('Connection error while creating inspection.', 'Error');
   } finally {
       if (btn) {
           btn.disabled = false;
           btn.innerText = 'Create Inspection';
       }
   }
}
