var allInspections = [];
var currentYear = new Date().getFullYear();
var currentMonth = new Date().getMonth(); // 0-indexed

function _statusChipClass(status) {
    if (status === 'complete') return 'bg-emerald-100 text-emerald-700';
    if (status === 'in_progress') return 'bg-blue-100 text-blue-700';
    return 'bg-indigo-100 text-indigo-700';
}

function _statusBadgeClass(status) {
    if (status === 'complete') return 'text-emerald-600 bg-emerald-50';
    if (status === 'in_progress') return 'text-blue-600 bg-blue-50';
    return 'text-indigo-600 bg-indigo-50';
}

document.addEventListener('DOMContentLoaded', loadCalendar);

async function loadCalendar() {
    var res = await authFetch('/api/inspections?limit=200');
    if (!res.ok) return;
    var data = await res.json();
    allInspections = data.data || [];
    renderMonth();
}

function goToday() {
    var now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    renderMonth();
}

function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderMonth();
}

function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderMonth();
}

function renderMonth() {
    var label = document.getElementById('calMonthLabel');
    var grid = document.getElementById('calGrid');
    if (!label || !grid) return;

    var monthName = new Date(currentYear, currentMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    label.textContent = monthName;

    // Build a map: dateStr (YYYY-MM-DD) -> inspections[]
    var map = {};
    allInspections.forEach(function(insp) {
        var d = insp.date ? insp.date.substring(0, 10) : null;
        if (!d) return;
        if (!map[d]) map[d] = [];
        map[d].push(insp);
    });

    var firstDay = new Date(currentYear, currentMonth, 1).getDay(); // 0=Sun
    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    var cells = '';
    // Leading empty cells
    for (var i = 0; i < firstDay; i++) {
        cells += '<div class="border-b border-r border-slate-100 bg-slate-50/30 min-h-[100px]"></div>';
    }

    for (var day = 1; day <= daysInMonth; day++) {
        var mm = String(currentMonth + 1).padStart(2, '0');
        var dd = String(day).padStart(2, '0');
        var dateStr = currentYear + '-' + mm + '-' + dd;
        var dayInsp = map[dateStr] || [];
        var isToday = dateStr === todayStr;
        var col = (firstDay + day - 1) % 7;
        var isLastCol = col === 6;

        cells += '<div onclick="showDay(\'' + dateStr + '\')" class="border-b ' + (isLastCol ? '' : 'border-r') + ' border-slate-100 min-h-[100px] p-2 cursor-pointer hover:bg-indigo-50/40 transition group">';
        cells += '<div class="flex items-center justify-between mb-1">';
        cells += '<span class="text-xs font-black ' + (isToday ? 'w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center' : 'text-slate-500') + '">' + day + '</span>';
        if (dayInsp.length > 0) {
            cells += '<span class="text-[9px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">' + dayInsp.length + '</span>';
        }
        cells += '</div>';
        dayInsp.slice(0, 3).forEach(function(insp) {
            cells += '<div class="text-[10px] font-bold px-1.5 py-0.5 rounded mb-0.5 truncate ' + _statusChipClass(insp.status) + '">' + _escapeHtml(insp.propertyAddress || 'Inspection') + '</div>';
        });
        if (dayInsp.length > 3) {
            cells += '<div class="text-[9px] text-slate-400 font-bold px-1">+' + (dayInsp.length - 3) + ' more</div>';
        }
        cells += '</div>';
    }

    // Trailing empty cells to fill last row
    var totalCells = firstDay + daysInMonth;
    var remainder = totalCells % 7;
    if (remainder !== 0) {
        for (var j = remainder; j < 7; j++) {
            cells += '<div class="border-b border-r border-slate-100 bg-slate-50/30 min-h-[100px]"></div>';
        }
    }

    grid.innerHTML = cells;

    // Hide day detail when month changes
    var detail = document.getElementById('dayDetail');
    if (detail) detail.classList.add('hidden');
}

function showDay(dateStr) {
    var detail = document.getElementById('dayDetail');
    var title = document.getElementById('dayDetailTitle');
    var list = document.getElementById('dayDetailList');
    if (!detail || !title || !list) return;

    var insp = allInspections.filter(function(i) { return i.date && i.date.substring(0, 10) === dateStr; });
    if (insp.length === 0) { detail.classList.add('hidden'); return; }

    title.textContent = new Date(dateStr + 'T12:00:00').toLocaleDateString('default', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    list.innerHTML = insp.map(function(i) {
        return '<a href="/inspections/' + i.id + '/edit" class="flex items-start gap-4 p-4 rounded-2xl hover:bg-slate-50 transition">' +
            '<div class="w-2 h-2 rounded-full bg-indigo-400 mt-2 flex-shrink-0"></div>' +
            '<div class="flex-1 min-w-0">' +
            '<p class="font-bold text-slate-900 text-sm truncate">' + _escapeHtml(i.propertyAddress || 'Unknown') + '</p>' +
            (i.clientName ? '<p class="text-xs text-slate-400 font-semibold">' + _escapeHtml(i.clientName) + '</p>' : '') +
            '</div>' +
            '<span class="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ' + _statusBadgeClass(i.status) + '">' + (i.status || 'draft') + '</span>' +
            '</a>';
    }).join('');

    detail.classList.remove('hidden');
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

