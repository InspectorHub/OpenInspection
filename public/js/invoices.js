var allInvoices = [];

document.addEventListener('DOMContentLoaded', loadInvoices);

async function loadInvoices() {
    var res = await authFetch('/api/invoices');
    if (!res.ok) return;
    var data = await res.json();
    allInvoices = data.data?.invoices || [];
    renderInvoices(allInvoices);
    updateStats(allInvoices);
}

function updateStats(list) {
    var unpaid = list.filter(function (i) { return i.status !== 'paid'; });
    var paid = list.filter(function (i) { return i.status === 'paid'; });
    var revenue = paid.reduce(function (sum, i) { return sum + i.amountCents; }, 0);
    var el = function (id, val) { var e = document.getElementById(id); if (e) e.textContent = val; };
    el('statTotal', list.length);
    el('statUnpaid', unpaid.length);
    el('statPaid', paid.length);
    el('statRevenue', '$' + (revenue / 100).toFixed(2));
}

function statusBadge(status) {
    if (status === 'paid') return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Paid</span>';
    if (status === 'sent') return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">Sent</span>';
    return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500">Draft</span>';
}

function renderInvoices(list) {
    var tbody = document.getElementById('invoicesBody');
    if (!tbody) return;
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-10 py-8 text-center text-slate-400 font-semibold">No invoices yet. Create your first one.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(function (inv) {
        var actions = '';
        if (inv.status === 'draft') {
            actions += '<button onclick="markSent(\'' + inv.id + '\')" class="text-xs font-bold text-blue-500 hover:text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition">Mark Sent</button>';
        }
        if (inv.status !== 'paid') {
            actions += '<button onclick="markPaid(\'' + inv.id + '\')" class="text-xs font-bold text-emerald-500 hover:text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition">Mark Paid</button>';
        }
        actions += '<button onclick="deleteInvoice(\'' + inv.id + '\')" class="text-xs font-bold text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">Delete</button>';
        return '<tr class="border-t border-slate-100 hover:bg-slate-50 transition">' +
            '<td class="py-5 px-10"><p class="text-sm font-bold text-slate-900">' + (inv.clientName || '\u2014') + '</p>' +
            (inv.clientEmail ? '<p class="text-xs text-slate-400">' + inv.clientEmail + '</p>' : '') + '</td>' +
            '<td class="py-5 px-8 text-sm font-bold text-slate-900">$' + (inv.amountCents / 100).toFixed(2) + '</td>' +
            '<td class="py-5 px-8 text-sm text-slate-500">' + (inv.dueDate || '\u2014') + '</td>' +
            '<td class="py-5 px-8">' + statusBadge(inv.status) + '</td>' +
            '<td class="py-5 pr-10 text-right flex gap-2 justify-end">' + actions + '</td></tr>';
    }).join('');
}

function showCreateModal() {
    ['invClientName', 'invClientEmail', 'invAmount', 'invDueDate', 'invNotes'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('invoiceModal')?.classList.remove('hidden');
}

function closeInvoiceModal() {
    document.getElementById('invoiceModal')?.classList.add('hidden');
}

async function submitInvoice() {
    var clientName = document.getElementById('invClientName')?.value.trim();
    var amountStr = document.getElementById('invAmount')?.value;
    if (!clientName) { modalAlert('Client name is required.'); return; }
    if (!amountStr || isNaN(parseFloat(amountStr))) { modalAlert('A valid amount is required.'); return; }
    var body = {
        clientName,
        clientEmail: document.getElementById('invClientEmail')?.value.trim() || null,
        amountCents: Math.round(parseFloat(amountStr) * 100),
        lineItems: [],
        dueDate: document.getElementById('invDueDate')?.value || null,
        notes: document.getElementById('invNotes')?.value.trim() || null,
    };
    var res = await authFetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { var e = await res.json(); modalAlert(e.error?.message || 'Failed to create invoice.'); return; }
    closeInvoiceModal();
    await loadInvoices();
}

async function markSent(id) {
    var res = await authFetch('/api/invoices/' + id + '/mark-sent', { method: 'POST' });
    if (!res.ok) { modalAlert('Failed to mark as sent.'); return; }
    await loadInvoices();
}

async function markPaid(id) {
    var res = await authFetch('/api/invoices/' + id + '/mark-paid', { method: 'POST' });
    if (!res.ok) { modalAlert('Failed to mark as paid.'); return; }
    await loadInvoices();
}

async function deleteInvoice(id) {
    if (!await modalConfirm('Delete this invoice?', 'Delete Invoice')) return;
    var res = await authFetch('/api/invoices/' + id, { method: 'DELETE' });
    if (!res.ok) { modalAlert('Delete failed.'); return; }
    await loadInvoices();
}
