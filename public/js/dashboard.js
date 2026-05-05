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
            <div class="text-sm font-black text-slate-900">${formatCents(svc.price)}</div>
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

// ─── Create modal helpers ──────────────────────────────────────────────────

function showCreateModal() {
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
            const b = this.buckets;
            const allActive = [...b.today, ...b.thisWeek, ...b.later];
            const inProgressItems = [
                ...b.needsAttention.filter(i => i.status === 'in_progress'),
                ...b.today.filter(i => i.status === 'in_progress'),
                ...b.thisWeek.filter(i => i.status === 'in_progress'),
                ...b.later.filter(i => i.status === 'in_progress'),
            ];
            const completedItems = [
                ...b.needsAttention.filter(i => i.status === 'completed'),
                ...b.today.filter(i => i.status === 'completed'),
                ...b.thisWeek.filter(i => i.status === 'completed'),
                ...b.later.filter(i => i.status === 'completed'),
                ...b.recentReports,
            ];
            const dedupCount = (rows) => new Set(rows.map(r => r.id)).size;

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = String(val);
            };

            setText('statActive',    allActive.length);
            setText('statProgress',  dedupCount(inProgressItems));
            setText('statReview',    b.recentReports.length);
            setText('statCompleted', dedupCount(completedItems));
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
