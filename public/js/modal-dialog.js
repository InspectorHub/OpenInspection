/**
 * Modal dialog helpers — replaces native confirm()/alert() with in-page modals.
 * Include this script before any script that calls modalConfirm() or modalAlert().
 */
(function () {
    function ensureOverlay() {
        if (document.getElementById('_modalOverlay')) return;
        var el = document.createElement('div');
        el.id = '_modalOverlay';
        el.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(4px)';
        el.innerHTML =
            '<div style="background:#fff;border-radius:1rem;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);max-width:28rem;width:calc(100% - 2rem);overflow:hidden">' +
            '<div style="padding:1.5rem 1.5rem 1rem"><h3 id="_modalTitle" style="margin:0 0 .5rem;font-size:1.1rem;font-weight:700;color:#0f172a"></h3>' +
            '<p id="_modalMessage" style="margin:0;font-size:.9rem;color:#475569;line-height:1.6"></p></div>' +
            '<div id="_modalActions" style="display:flex;justify-content:flex-end;gap:.75rem;padding:0 1.5rem 1.5rem"></div></div>';
        document.body.appendChild(el);
    }

    function show(message, opts) {
        opts = opts || {};
        var title = opts.title || 'Confirm';
        var confirmText = opts.confirmText || 'Confirm';
        var cancelText = opts.cancelText || 'Cancel';
        var confirmBg = opts.confirmColor || '#1e293b';
        var showCancel = opts.showCancel !== false;

        ensureOverlay();
        var overlay = document.getElementById('_modalOverlay');
        document.getElementById('_modalTitle').textContent = title;
        document.getElementById('_modalMessage').textContent = message;

        var actions = document.getElementById('_modalActions');
        var btnStyle = 'padding:.625rem 1.25rem;font-size:.875rem;font-weight:700;border:none;border-radius:.75rem;cursor:pointer;transition:opacity .15s';

        return new Promise(function (resolve) {
            var html = '';
            if (showCancel) {
                html += '<button id="_modalCancel" style="' + btnStyle + ';background:#f1f5f9;color:#475569">' + cancelText + '</button>';
            }
            html += '<button id="_modalConfirm" style="' + btnStyle + ';background:' + confirmBg + ';color:#fff">' + confirmText + '</button>';
            actions.innerHTML = html;
            overlay.style.display = 'flex';

            function cleanup(val) { overlay.style.display = 'none'; resolve(val); }
            document.getElementById('_modalConfirm').onclick = function () { cleanup(true); };
            var cb = document.getElementById('_modalCancel');
            if (cb) cb.onclick = function () { cleanup(false); };
        });
    }

    window.modalConfirm = function (message, title) {
        return show(message, { title: title || 'Confirm Action', confirmText: 'Confirm', confirmColor: '#1e293b' });
    };

    window.modalAlert = function (message, title) {
        return show(message, { title: title || 'Notice', confirmText: 'OK', confirmColor: '#1e293b', showCancel: false });
    };
})();
