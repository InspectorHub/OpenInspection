// Comments Library — shared picker for inspection edit page
var _allComments = [];
var _targetTextarea = null;

function _escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

async function loadCommentsLibrary() {
    var res = await authFetch('/api/admin/comments');
    if (!res.ok) return;
    var data = await res.json();
    _allComments = data.data?.comments || [];
}

function openCommentPicker(btn) {
    var picker = document.getElementById('commentPicker');
    if (!picker) return;
    // Find the nearest textarea in the same expanded-detail container
    _targetTextarea = btn.closest('[x-show]')?.querySelector('textarea') || null;
    loadCommentsLibrary().then(function () {
        if (_allComments.length === 0) {
            picker.innerHTML = '<p class="text-sm text-slate-400 text-center py-2">No saved comments. Add them in Templates \u2192 Comments.</p>';
        } else {
            picker.innerHTML = _allComments.map(function (c) {
                var label = (c.category ? '<span class="text-[10px] text-indigo-400 font-black uppercase mr-1">' + _escapeHtml(c.category) + '</span>' : '') + _escapeHtml(c.text);
                return '<button class="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-indigo-50 rounded-lg transition font-semibold" data-comment-id="' + _escapeHtml(c.id) + '">' + label + '</button>';
            }).join('');
        }
        var rect = btn.getBoundingClientRect();
        picker.style.top = (rect.bottom + 4 + window.scrollY) + 'px';
        picker.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
        picker.classList.remove('hidden');
    });
}

// Use event delegation instead of inline onclick handlers
document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-comment-id]');
    if (btn) insertComment(btn.dataset.commentId);
});

function insertComment(id) {
    var c = _allComments.find(function (x) { return x.id === id; });
    if (!c || !_targetTextarea) return;
    var cur = _targetTextarea.value;
    _targetTextarea.value = cur ? cur + ' ' + c.text : c.text;
    // Trigger Alpine x-on:input so debounceSave() fires
    _targetTextarea.dispatchEvent(new Event('input'));
    document.getElementById('commentPicker').classList.add('hidden');
}

document.addEventListener('click', function (e) {
    var picker = document.getElementById('commentPicker');
    if (!picker) return;
    if (!e.target.closest('#commentPicker') && !e.target.closest('button[onclick*="openCommentPicker"]')) {
        picker.classList.add('hidden');
    }
});
