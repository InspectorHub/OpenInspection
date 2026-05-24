// Shared toast notification utility
function showToast(msg, isError, opts) {
    var el = document.getElementById('statusToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'statusToast';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'fixed bottom-8 right-8 flex items-center gap-3 px-6 py-4 rounded-md shadow-2xl text-sm font-bold text-white z-50 transition-all ' +
        (isError ? 'bg-red-600' : 'bg-emerald-600');
    // If opts.undoFn provided, add an undo button
    if (opts && opts.undoFn) {
        var undoBtn = document.createElement('button');
        undoBtn.textContent = opts.undoLabel || 'Undo';
        undoBtn.style.cssText = 'margin-left:12px;font-weight:700;text-decoration:underline;cursor:pointer;background:none;border:none;color:inherit;font-size:inherit;';
        undoBtn.onclick = function() { opts.undoFn(); el.style.display = 'none'; };
        el.appendChild(undoBtn);
    }
    el.style.display = '';
    clearTimeout(el._timer);
    el._timer = setTimeout(function() { el.style.display = 'none'; }, 3500);
}
