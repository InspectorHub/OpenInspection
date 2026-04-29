var allContacts = [];
var currentTypeFilter = '';

document.addEventListener('DOMContentLoaded', loadContacts);

async function loadContacts() {
    var url = '/api/contacts?limit=200' + (currentTypeFilter ? '&type=' + currentTypeFilter : '');
    var res = await authFetch(url);
    if (!res.ok) return;
    var data = await res.json();
    allContacts = data.data?.contacts || [];
    renderContacts(allContacts);
}

function filterContacts() {
    currentTypeFilter = document.getElementById('filterType')?.value || '';
    loadContacts();
}

function renderContacts(list) {
    var tbody = document.getElementById('contactsBody');
    if (!tbody) return;
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-10 py-8 text-center text-slate-400 font-semibold">No contacts yet. Add your first agent or client.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(function (c) {
        var typeBadge = c.type === 'agent'
            ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">Agent</span>'
            : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Client</span>';
        return '<tr class="border-t border-slate-100 hover:bg-slate-50 transition">' +
            '<td class="py-5 px-10 text-sm font-bold text-slate-900">' + c.name + '</td>' +
            '<td class="py-5 px-8">' + typeBadge + '</td>' +
            '<td class="py-5 px-8 text-sm text-slate-500">' + (c.email || '\u2014') + '</td>' +
            '<td class="py-5 px-8 text-sm text-slate-500">' + (c.phone || '\u2014') + '</td>' +
            '<td class="py-5 px-8 text-sm text-slate-500">' + (c.agency || '\u2014') + '</td>' +
            '<td class="py-5 px-8 text-sm font-bold text-slate-700">' + (c.inspectionCount || 0) + '</td>' +
            '<td class="py-5 pr-10 text-right flex gap-2 justify-end">' +
            '<button onclick="showEditModal(\'' + c.id + '\')" class="text-xs font-bold text-indigo-500 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition">Edit</button>' +
            '<button onclick="deleteContactById(\'' + c.id + '\')" class="text-xs font-bold text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">Remove</button>' +
            '</td></tr>';
    }).join('');
}

function showCreateModal() {
    document.getElementById('editContactId').value = '';
    document.getElementById('contactModalTitle').textContent = 'Add Contact';
    ['contactType', 'contactName', 'contactEmail', 'contactPhone', 'contactAgency'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = id === 'contactType' ? 'agent' : '';
    });
    document.getElementById('contactModal')?.classList.remove('hidden');
}

function showEditModal(id) {
    var c = allContacts.find(function (x) { return x.id === id; });
    if (!c) return;
    document.getElementById('editContactId').value = c.id;
    document.getElementById('contactModalTitle').textContent = 'Edit Contact';
    document.getElementById('contactType').value = c.type;
    document.getElementById('contactName').value = c.name;
    document.getElementById('contactEmail').value = c.email || '';
    document.getElementById('contactPhone').value = c.phone || '';
    document.getElementById('contactAgency').value = c.agency || '';
    document.getElementById('contactModal')?.classList.remove('hidden');
}

function closeContactModal() {
    document.getElementById('contactModal')?.classList.add('hidden');
}

async function submitContact() {
    var editId = document.getElementById('editContactId')?.value;
    var body = {
        type: document.getElementById('contactType')?.value,
        name: document.getElementById('contactName')?.value.trim(),
        email: document.getElementById('contactEmail')?.value.trim() || null,
        phone: document.getElementById('contactPhone')?.value.trim() || null,
        agency: document.getElementById('contactAgency')?.value.trim() || null,
    };
    if (!body.name) { modalAlert('Name is required.'); return; }
    var url = editId ? '/api/contacts/' + editId : '/api/contacts';
    var method = editId ? 'PUT' : 'POST';
    var res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { var e = await res.json(); modalAlert(e.error?.message || 'Save failed.'); return; }
    closeContactModal();
    await loadContacts();
}

async function deleteContactById(id) {
    var c = allContacts.find(function (x) { return x.id === id; });
    if (!c) return;
    if (!await modalConfirm('Remove "' + c.name + '"?', 'Remove Contact')) return;
    var res = await authFetch('/api/contacts/' + id, { method: 'DELETE' });
    if (!res.ok) { modalAlert('Delete failed.'); return; }
    await loadContacts();
}
