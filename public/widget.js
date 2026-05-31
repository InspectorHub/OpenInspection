/**
 * OpenInspection Embeddable Booking Widget — loader script.
 *
 * Usage on the inspector's marketing site:
 *
 *   <div data-openinspection-widget></div>
 *   <script src="https://your-instance.workers.dev/widget.js"
 *           data-style="light"
 *           defer></script>
 *
 * The loader finds its own <script> tag, reads `data-style`, then injects
 * a sandboxed iframe pointing to <host>/book?embed=1&style=... into the
 * first <div data-openinspection-widget> it finds (or appends to <body>
 * if no mount point exists).
 *
 * postMessage protocol with the iframe:
 *   - { type: 'oi:widget:height', height: <number> }   -> resize iframe
 *   - { type: 'oi:widget:event', event: 'view'|'submit'|'success', metadata: {...} }
 *     -> propagate to host via window.dispatchEvent for the host to capture in GA/Segment
 */
(function () {
    'use strict';

    var script = document.currentScript ||
        (function () {
            var scripts = document.getElementsByTagName('script');
            return scripts[scripts.length - 1];
        })();

    var src = script.getAttribute('src') || '';
    var origin;
    try { origin = new URL(src, window.location.href).origin; } catch (e) { origin = ''; }
    if (!origin) {
        console.error('[OpenInspection widget] could not determine widget origin from script src');
        return;
    }

    var style = (script.getAttribute('data-style') || 'light').toLowerCase();
    if (['light', 'dark', 'branded'].indexOf(style) === -1) style = 'light';

    var mount = document.querySelector('[data-openinspection-widget]') || document.body;

    var iframe = document.createElement('iframe');
    iframe.src = origin + '/book?embed=1&style=' + encodeURIComponent(style);
    iframe.setAttribute('title', 'Book inspection');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.style.width = '100%';
    iframe.style.minHeight = '600px';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.background = 'transparent';
    mount.appendChild(iframe);

    window.addEventListener('message', function (e) {
        if (e.origin !== origin) return;
        if (!e.data || typeof e.data !== 'object') return;
        if (e.data.type === 'oi:widget:height' && typeof e.data.height === 'number') {
            iframe.style.height = Math.max(600, Math.min(e.data.height, 4000)) + 'px';
        } else if (e.data.type === 'oi:widget:event') {
            try {
                window.dispatchEvent(new CustomEvent('openinspection:widget:' + e.data.event, { detail: e.data.metadata || {} }));
            } catch (_) { /* old browsers — ignore */ }
        }
    });
})();
