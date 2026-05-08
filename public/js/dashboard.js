// ─── Non-Alpine dashboard state ────────────────────────────────────────────
let allInspectors = [];
let allTemplates = [];
let currentUserEmail = '';
let availableServices = [];
let selectedServiceIds = [];
let discountCode = '';
let discountResult = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Fetch current user for avatar. If unauthenticated, htmlAuthGuard already redirected.
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

    fetchPrerequisites();
    loadServices();
});

// ─── Services (for create modal) ───────────────────────────────────────────

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
                ${svc.durationMinutes ? `<div class="text-xs text-slate-400">&#x23F1; ${svc.durationMinutes} min</div>` : ''}
            </div>
            <div class="text-sm font-bold text-slate-900">${formatCents(svc.price)}</div>
        </div>
    `).join('');
    updateTotalBar();
}

function toggleService(id) {
    const idx = selectedServiceIds.indexOf(id);
    if (idx >= 0) selectedServiceIds.splice(idx, 1);
    else selectedServiceIds.push(id);

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

// ─── Earnings Alpine factory ────────────────────────────────────────────────
// Owner/admin only — fetch silently fails for inspectors (RBAC), and the
// x-show predicate hides the card when there's no revenue activity.
function dashboardEarnings() {
    return {
        earnings: { paid: 0, pending: 0, count: 0 },
        formatCurrency(cents) {
            return '$' + ((cents || 0) / 100).toFixed(2);
        },
        async loadEarnings() {
            try {
                const r = await authFetch('/api/admin/earnings-summary');
                if (!r.ok) return;
                const d = await r.json();
                this.earnings = d.data || { paid: 0, pending: 0, count: 0 };
            } catch {}
        },
    };
}
window.dashboardEarnings = dashboardEarnings;

// ─── Sub-spec B Task 3 — PageHeader meta ────────────────────────────────────
// Drives the meta string under the dashboard H1. Polls the same endpoint as
// the bucket grid so numbers stay in sync. Renders the canonical
// "{total} inspections · {inProgress} in progress · last sync {syncedAt}".
function dashboardMeta() {
    return {
        total:      0,
        inProgress: 0,
        syncedAt:   '',
        get metaText() {
            const parts = [];
            if (this.total > 0) parts.push(this.total + ' inspection' + (this.total === 1 ? '' : 's'));
            if (this.inProgress > 0) parts.push(this.inProgress + ' in progress');
            if (this.syncedAt) parts.push('last sync ' + this.syncedAt);
            return parts.length ? parts.join(' · ') : 'No inspections yet';
        },
        async init() {
            await this.reload();
            window.addEventListener('inspection-updated', () => this.reload());
        },
        async reload() {
            try {
                const r = await fetch('/api/inspections/dashboard', { credentials: 'include' });
                if (!r.ok) return;
                const j = await r.json();
                const d = j.data || {};
                const all = [
                    ...(d.needsAttention || []),
                    ...(d.today || []),
                    ...(d.thisWeek || []),
                    ...(d.later || []),
                    ...(d.recentReports || []),
                ];
                this.total = (d.laterTotal && d.laterTotal > (d.later || []).length)
                    ? all.length - (d.later || []).length + d.laterTotal
                    : all.length;
                this.inProgress = all.filter(i => i.status === 'in_progress').length;
                this.syncedAt = relativeTime(new Date());
            } catch {}
        },
    };
}
function relativeTime(d) {
    const now = new Date();
    const diffSec = Math.round((now - d) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    return d.toLocaleDateString();
}
document.addEventListener('alpine:init', () => window.Alpine.data('dashboardMeta', dashboardMeta));
window.dashboardMeta = dashboardMeta;

// ─── Sub-spec B Task 5 (B-4) — defectAggregate for top 4 cards ──────────────
// Pulls aggregate from /api/inspections/dashboard once on init and exposes
// agg(bucket) helper that the dashboard cards use to render colored chips.
const ZERO_AGG = { safety: 0, recommendation: 0, maintenance: 0 };
function dashboardCards() {
    return {
        defectAggregate: {
            later:          ZERO_AGG,
            thisWeek:       ZERO_AGG,
            needsAttention: ZERO_AGG,
            recentReports:  ZERO_AGG,
        },
        agg(target) {
            return this.defectAggregate?.[target] || ZERO_AGG;
        },
        async init() {
            await this.reload();
            window.addEventListener('inspection-updated', () => this.reload());
        },
        async reload() {
            try {
                const r = await fetch('/api/inspections/dashboard', { credentials: 'include' });
                if (!r.ok) return;
                const j = await r.json();
                if (j.data?.defectAggregate) {
                    this.defectAggregate = j.data.defectAggregate;
                }
            } catch {}
        },
    };
}
document.addEventListener('alpine:init', () => window.Alpine.data('dashboardCards', dashboardCards));
window.dashboardCards = dashboardCards;

// ─── Prerequisites (templates, inspectors, agents for create modal) ─────────

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

            const select = document.getElementById('inspectorId');
            if (select) {
                allInspectors.forEach(i => {
                    const opt = document.createElement('option');
                    opt.value = i.id;
                    opt.innerText = i.name || i.email;
                    select.appendChild(opt);
                });
            }
        }
    } catch (e) {
        console.error('Prerequisites Load Error:', e);
    }

    try {
        await populateAgents();
    } catch (e) {
        console.error('populateAgents failed:', e);
    }

    // R7-NEW-1: calendar's dateClick navigates here with ?newInspection=1&date=...
    // Auto-open the New Inspection modal + pre-fill the date input.
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('newInspection') === '1') {
            showCreateModal();
            const d = params.get('date');
            const dateInput = document.getElementById('inspectionDate');
            if (dateInput && d) {
                // Flatpickr accepts ISO strings; setting .value works because
                // flatpickr-init.js binds on focusin and reads the current value.
                dateInput.value = d.replace('T', ' ').slice(0, 16);
            }
            // Clean URL so refresh doesn't reopen.
            const url = new URL(window.location.href);
            url.searchParams.delete('newInspection');
            url.searchParams.delete('date');
            window.history.replaceState({}, '', url.toString());
        }
    } catch (e) {
        console.error('newInspection deep-link failed:', e);
    }
}

async function populateAgents() {
    const res = await authFetch('/api/contacts?type=agent&limit=100');
    if (!res.ok) return;
    const data = await res.json();
    const agents = data.data?.contacts || [];
    // R7-09: same agent list populates Listing Agent + Buyer's Agent dropdowns.
    const targets = [document.getElementById('agentId'), document.getElementById('buyerAgentId')];
    if (agents.length === 0) return;
    targets.forEach(select => {
        if (!select) return;
        agents.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.innerText = a.name || a.email || a.id;
            select.appendChild(opt);
        });
    });
}

// ─── Create modal helpers ──────────────────────────────────────────────────

// Spec 5D — Address Autocomplete. Generates a fresh session UUID on each
// modal open so Google bills the typing-session as ONE Autocomplete (~$0.017)
// instead of one per keystroke. UUID is reset in showCreateModal/closeModal.
let __placesSession = null;
let __placesSearchTimer = null;

function newPlacesSession() {
    __placesSession = crypto.randomUUID();
}

async function searchPlaces(q) {
    if (!__placesSession) newPlacesSession();
    try {
        const url = '/api/places/autocomplete?q=' + encodeURIComponent(q) + '&session=' + __placesSession;
        const res = await authFetch(url);
        if (!res.ok) return null; // graceful: hide dropdown on any failure
        const j = await res.json();
        return j?.data?.results || j?.results || [];
    } catch { return null; }
}

async function selectPlace(placeId, displayText) {
    if (!__placesSession) newPlacesSession();
    const propAddr = document.getElementById('propAddress');
    const dropdown = document.getElementById('propAddressDropdown');
    if (propAddr) propAddr.value = displayText;
    if (dropdown) dropdown.classList.add('hidden');
    try {
        const res = await authFetch('/api/places/details?placeId=' + encodeURIComponent(placeId) + '&session=' + __placesSession);
        if (!res.ok) return;
        const j = await res.json();
        const d = j?.data || j;
        if (!d || !d.placeId) return;
        if (propAddr) propAddr.value = d.formatted || displayText;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        set('propPlaceId',  d.placeId);
        set('propAddrStreet', d.street);
        set('propAddrCity',   d.city);
        set('propAddrState',  d.state);
        set('propAddrZip',    d.zip);
        set('propAddrCounty', d.county);
        set('propLat', d.lat != null ? String(d.lat) : '');
        set('propLng', d.lng != null ? String(d.lng) : '');
        // After successful details fetch, end the billing session — next
        // typing will start a fresh one.
        newPlacesSession();
    } catch { /* silent */ }
}

function renderPlacesDropdown(results) {
    const dropdown = document.getElementById('propAddressDropdown');
    if (!dropdown) return;
    if (!results || results.length === 0) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        return;
    }
    dropdown.innerHTML = results.slice(0, 6).map(r => `
        <button type="button" data-place-id="${r.placeId}" data-place-text="${(r.description || '').replace(/"/g, '&quot;')}"
                class="w-full text-left px-5 py-3 hover:bg-emerald-50 border-b border-slate-100 last:border-b-0 transition">
          <div class="font-bold text-sm text-slate-900">${r.mainText || r.description}</div>
          ${r.secondaryText ? `<div class="text-xs text-slate-500 mt-0.5">${r.secondaryText}</div>` : ''}
        </button>
    `).join('');
    dropdown.classList.remove('hidden');
    dropdown.querySelectorAll('button[data-place-id]').forEach(btn => {
        btn.addEventListener('click', () => selectPlace(btn.dataset.placeId, btn.dataset.placeText));
    });
}

document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('#propAddress[data-places-autocomplete]')) return;
    // Any manual edit invalidates previously-resolved geocoded fields.
    ['propPlaceId','propAddrStreet','propAddrCity','propAddrState','propAddrZip','propAddrCounty','propLat','propLng']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const q = t.value.trim();
    if (q.length < 2) { renderPlacesDropdown([]); return; }
    clearTimeout(__placesSearchTimer);
    __placesSearchTimer = setTimeout(async () => {
        const results = await searchPlaces(q);
        if (results) renderPlacesDropdown(results);
    }, 250);
});

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('propAddressDropdown');
    if (!dropdown) return;
    if (e.target.closest('#propAddressDropdown') || e.target.closest('#propAddress')) return;
    dropdown.classList.add('hidden');
});

function showCreateModal() {
    newPlacesSession(); // fresh billing session per modal open
    document.getElementById('createModal')?.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('createModal')?.classList.add('hidden');
}

async function cloneInspection(id) {
    const res = await authFetch('/api/inspections/' + id);
    if (!res.ok) return;
    const data = await res.json();
    const ins = data?.data?.inspection || data?.data;
    if (!ins) return;
    const confirmed = await modalConfirm(
        'Create a new inspection at "' + ins.propertyAddress + '" with the same template and client details?',
        'Clone Inspection'
    );
    if (!confirmed) return;
    try {
        const cloneRes = await authFetch('/api/inspections', {
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
        if (cloneRes.ok) {
            showToast('Inspection cloned successfully.');
            window.dispatchEvent(new CustomEvent('inspection-updated'));
        } else {
            const err = await cloneRes.json().catch(function() { return {}; });
            modalAlert('Failed to clone: ' + (err.error?.message || 'Unknown error'), 'Error');
        }
    } catch (e) {
        modalAlert('Network error: ' + e.message, 'Error');
    }
}

async function deleteInspection(id) {
    var confirmed = await modalConfirm('This will permanently delete this inspection and all its data. This cannot be undone.', 'Delete Inspection');
    if (!confirmed) return;
    try {
        var res = await authFetch('/api/inspections/' + id, { method: 'DELETE' });
        if (res.ok) {
            window.dispatchEvent(new CustomEvent('inspection-updated'));
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
        sellingAgentId: document.getElementById('buyerAgentId')?.value || undefined,
        // Spec 5D — geocoded address payload (only when autocomplete picked).
        addressPlaceId: document.getElementById('propPlaceId')?.value || undefined,
        addressStreet:  document.getElementById('propAddrStreet')?.value || undefined,
        addressCity:    document.getElementById('propAddrCity')?.value || undefined,
        addressState:   document.getElementById('propAddrState')?.value || undefined,
        addressZip:     document.getElementById('propAddrZip')?.value || undefined,
        addressCounty:  document.getElementById('propAddrCounty')?.value || undefined,
        addressLat:     document.getElementById('propLat')?.value ? Number(document.getElementById('propLat').value) : undefined,
        addressLng:     document.getElementById('propLng')?.value ? Number(document.getElementById('propLng').value) : undefined,
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
           const buyerAg = document.getElementById('buyerAgentId');
           if (buyerAg) buyerAg.value = '';
           // Spec 5D — clear geocoded payload after successful create.
           ['propPlaceId','propAddrStreet','propAddrCity','propAddrState','propAddrZip','propAddrCounty','propLat','propLng']
               .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

           if (newId) {
               window.location.href = '/inspections/' + newId + '/edit';
               return;
           }
           window.dispatchEvent(new CustomEvent('inspection-updated'));
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

window.showCreateModal = showCreateModal;
window.closeModal = closeModal;
window.cloneInspection = cloneInspection;
window.deleteInspection = deleteInspection;
window.submitInspection = submitInspection;

// ─── Time-based filter helpers (Competitor parity Feature C1) ───────────────
// Pure JS port of src/lib/inspection-filter.ts — kept in sync by the unit
// tests in tests/unit/inspection-filter.spec.ts. Both modules share the same
// filter ids and date semantics so the dashboard tab strip behaves identically
// to any future server-side filter.
const INSPECTION_FILTERS = [
    { id: 'all',         label: 'All' },
    { id: 'past',        label: 'Past' },
    { id: 'yesterday',   label: 'Yesterday' },
    { id: 'today',       label: 'Today' },
    { id: 'tomorrow',    label: 'Tomorrow' },
    { id: 'this_week',   label: 'This Week' },
    { id: 'future',      label: 'Future' },
    { id: 'unconfirmed', label: 'Unconfirmed' },
    { id: 'in_progress', label: 'In Progress' },
];

function _startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function _addDays(d, days) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
}

function _startOfWeek(d) {
    const x = _startOfDay(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
}

function _parseInspectionDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function matchesInspectionFilter(insp, filter, now) {
    if (filter === 'all') return true;
    const status = ((insp && insp.status) || '').toLowerCase();
    if (filter === 'unconfirmed') return status === 'scheduled' || status === 'draft';
    if (filter === 'in_progress') return status === 'in_progress';
    const date = _parseInspectionDate(insp && insp.date != null ? insp.date : null);
    if (!date) return false;
    const today     = _startOfDay(now || new Date());
    const yesterday = _addDays(today, -1);
    const tomorrow  = _addDays(today, 1);
    const weekStart = _startOfWeek(today);
    const weekEnd   = _addDays(weekStart, 7);
    const dayStart  = _startOfDay(date);
    switch (filter) {
        case 'past':       return dayStart.getTime() < today.getTime();
        case 'yesterday':  return dayStart.getTime() === yesterday.getTime();
        case 'today':      return dayStart.getTime() === today.getTime();
        case 'tomorrow':   return dayStart.getTime() === tomorrow.getTime();
        case 'this_week':  return dayStart.getTime() >= weekStart.getTime() && dayStart.getTime() < weekEnd.getTime();
        case 'future':     return dayStart.getTime() >= weekEnd.getTime();
    }
    return false;
}

window.INSPECTION_FILTERS         = INSPECTION_FILTERS;
window.matchesInspectionFilter    = matchesInspectionFilter;

// ─── Alpine dashboard factory ───────────────────────────────────────────────

function dashboardFactory() {
    return {
        loading: true,
        buckets: {
            needsAttention: [],
            today: [],
            thisWeek: [],
            later: [],
            laterTotal: 0,
            recentReports: [],
            cancelled: [],
        },
        sections: {
            needsAttention: true,
            today: true,
            todayEvents: true,
            thisWeek: true,
            later: false,
            recentReports: false,
            cancelled: false,
        },
        // Competitor parity C1 — time-based filter tabs.
        // 'all' shows the existing grouped buckets; any other filter id
        // collapses to a single flat list filtered in-memory.
        activeFilter: 'all',
        filterOptions: INSPECTION_FILTERS,
        // Spec 4D.T10 — Today's events bucket
        todayEvents: [],
        eventTypes: [],
        // Spec 4E — prefetch progress pill
        cacheProgress: null,

        async init() {
            await this.reload();
            window.addEventListener('inspection-updated', () => this.reload());
        },

        async reload() {
            this.loading = true;
            try {
                // Parallel fetch dashboard buckets + today's events + event types (for name lookup).
                // Event-type fetch runs in parallel; failures (e.g. inspector role lacking permission)
                // gracefully fall back to showing the raw eventTypeId.
                const [boardRes, eventsRes, typesRes] = await Promise.all([
                    fetch('/api/inspections/dashboard', { credentials: 'include' }),
                    fetch('/api/events/upcoming?days=1',  { credentials: 'include' }).catch(() => null),
                    fetch('/api/event-types',             { credentials: 'include' }).catch(() => null),
                ]);
                if (boardRes.status === 401) { window.location.href = '/login'; return; }
                if (!boardRes.ok) throw new Error('HTTP ' + boardRes.status);
                const json = await boardRes.json();
                if (json.data) {
                    this.buckets = {
                        needsAttention: json.data.needsAttention || [],
                        today: json.data.today || [],
                        thisWeek: json.data.thisWeek || [],
                        later: json.data.later || [],
                        laterTotal: json.data.laterTotal || 0,
                        recentReports: json.data.recentReports || [],
                        cancelled: json.data.cancelled || [],
                    };
                }
                if (eventsRes && eventsRes.ok) {
                    const ej = await eventsRes.json().catch(() => ({ data: [] }));
                    this.todayEvents = ej.data || [];
                }
                if (typesRes && typesRes.ok) {
                    const tj = await typesRes.json().catch(() => ({ data: [] }));
                    this.eventTypes = tj.data || [];
                }
                // Auto-expand needsAttention or today if they have items; collapse others if empty
                if (this.buckets.needsAttention.length > 0) this.sections.needsAttention = true;
                if (this.buckets.today.length > 0) this.sections.today = true;
                // R7-05 fix: when all the "above the fold" buckets are empty
                // but Later has items, auto-expand Later so the inspector
                // doesn't see a dashboard that looks empty when it isn't.
                const aboveFoldEmpty = this.buckets.needsAttention.length === 0
                    && this.buckets.today.length === 0
                    && this.buckets.thisWeek.length === 0;
                if (aboveFoldEmpty && this.buckets.later.length > 0) {
                    this.sections.later = true;
                }
                this.computeStats();
            } catch (e) {
                if (typeof window.showToast === 'function') {
                    window.showToast('Failed to load dashboard: ' + e.message, true);
                }
            } finally {
                this.loading = false;
            }
        },

        eventTypeName(id) {
            const t = this.eventTypes.find(function(x) { return x.id === id; });
            return t ? t.name : id;
        },

        computeStats() {
            // R45 — each stat's number, label, and click-target bucket are now
            // aligned. No more double-counting recentReports as both 'review'
            // and 'completed'. No more renaming the same number under two
            // different headers.
            const b = this.buckets;
            const inProgressItems = [
                ...b.needsAttention.filter(i => i.status === 'in_progress'),
                ...b.today.filter(i => i.status === 'in_progress'),
                ...b.thisWeek.filter(i => i.status === 'in_progress'),
                ...b.later.filter(i => i.status === 'in_progress'),
            ];
            const dedupCount = (rows) => new Set(rows.map(r => r.id)).size;

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = String(val);
            };

            // Upcoming = scheduled work (today + thisWeek + later, dedup'd)
            setText('statUpcoming',   dedupCount([...b.today, ...b.thisWeek, ...b.later]));
            // In Progress = inspections currently being worked on
            setText('statInProgress', dedupCount(inProgressItems));
            // Needs Attention = inspections flagged as needing review
            setText('statNeedsAttn',  b.needsAttention.length);
            // Recent Reports = published reports (was previously double-named
            // 'Ready for Review' AND 'Completed' for the same dataset)
            setText('statRecentRpt',  b.recentReports.length);
        },

        async loadAllLater() {
            try {
                const res = await fetch('/api/inspections?status=upcoming&limit=500', { credentials: 'include' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                this.buckets.later = json.data || this.buckets.later;
            } catch (e) {
                if (typeof window.showToast === 'function') {
                    window.showToast('Failed to load: ' + e.message, true);
                }
            }
        },

        get allBucketsEmpty() {
            const b = this.buckets;
            return (
                b.needsAttention.length +
                b.today.length +
                b.thisWeek.length +
                b.later.length +
                b.recentReports.length +
                b.cancelled.length
            ) === 0;
        },

        // Competitor parity C1 — flat dedup'd union of every bucket. Used
        // exclusively when activeFilter !== 'all' so the inspector sees one
        // clean list instead of 5 collapsing sections.
        get _allInspections() {
            const b = this.buckets;
            const seen = new Set();
            const out  = [];
            const push = (rows) => {
                for (let i = 0; i < (rows || []).length; i++) {
                    const r = rows[i];
                    const id = r && r.id;
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    out.push(r);
                }
            };
            push(b.needsAttention);
            push(b.today);
            push(b.thisWeek);
            push(b.later);
            push(b.recentReports);
            push(b.cancelled);
            return out;
        },

        // Inspections matching the currently active non-'all' filter, sorted
        // by inspection date ascending (closest first). Stable enough that
        // re-renders don't shuffle rows when the same data reloads.
        get filteredInspections() {
            if (this.activeFilter === 'all') return [];
            const now = new Date();
            const list = this._allInspections.filter(i => matchesInspectionFilter(i, this.activeFilter, now));
            list.sort((a, b) => {
                const da = a && a.date ? new Date(a.date).getTime() : 0;
                const db = b && b.date ? new Date(b.date).getTime() : 0;
                return da - db;
            });
            return list;
        },

        // Counts for the tab strip pills, e.g. "TODAY (3)". Computed once
        // per Alpine reactive cycle.
        get filterCounts() {
            const counts = { all: 0, past: 0, yesterday: 0, today: 0, tomorrow: 0,
                             this_week: 0, future: 0, unconfirmed: 0, in_progress: 0 };
            const now = new Date();
            const list = this._allInspections;
            counts.all = list.length;
            for (let i = 0; i < list.length; i++) {
                const insp = list[i];
                for (let j = 0; j < INSPECTION_FILTERS.length; j++) {
                    const f = INSPECTION_FILTERS[j].id;
                    if (f === 'all') continue;
                    if (matchesInspectionFilter(insp, f, now)) counts[f]++;
                }
            }
            return counts;
        },

        setFilter(filter) {
            this.activeFilter = filter || 'all';
        },
    };
}

function registerB4Component(name, factory) {
    document.addEventListener('alpine:init', () => window.Alpine.data(name, factory));
    if (window.Alpine && typeof window.Alpine.data === 'function') {
        window.Alpine.data(name, factory);
        document.querySelectorAll('[x-data="' + name + '()"]').forEach(el => {
            try { window.Alpine.destroyTree?.(el); } catch {}
            try { window.Alpine.initTree(el); } catch {}
        });
    }
}
registerB4Component('dashboard', dashboardFactory);
