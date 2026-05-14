/**
 * Color scheme toggle — auto / dark / light (3-way cycle).
 * Reads/writes localStorage key 'ih-color-scheme'.
 *   null      → auto  (follow OS prefers-color-scheme)
 *   'dark'    → dark
 *   'light'   → light
 * The html[data-color-scheme] attribute is set by an inline <script> in
 * <head> before stylesheets load to prevent FOUC; this file handles the
 * runtime toggle and icon/label updates.
 */
(function () {
    function isDarkActive() {
        return document.documentElement.getAttribute('data-color-scheme') === 'dark';
    }

    function currentMode() {
        var saved = localStorage.getItem('ih-color-scheme');
        if (saved === 'dark' || saved === 'light') return saved;
        return 'auto';
    }

    function applyMode(mode) {
        if (mode === 'auto') {
            localStorage.removeItem('ih-color-scheme');
            var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-color-scheme', systemDark ? 'dark' : 'light');
        } else {
            localStorage.setItem('ih-color-scheme', mode);
            document.documentElement.setAttribute('data-color-scheme', mode);
        }
    }

    function updateUI() {
        var mode = currentMode();
        var dark = isDarkActive();

        // Desktop icons
        var sun  = document.getElementById('themeSunIcon');
        var moon = document.getElementById('themeMoonIcon');
        var auto = document.getElementById('themeAutoIcon');
        var lbl  = document.getElementById('themeToggleLabel');
        if (sun)  sun.classList.toggle('hidden', mode !== 'dark');
        if (moon) moon.classList.toggle('hidden', mode !== 'light');
        if (auto) auto.classList.toggle('hidden', mode !== 'auto');
        if (lbl)  lbl.textContent = mode === 'auto' ? 'Auto' : (dark ? 'Dark Mode' : 'Light Mode');

        // Mobile icons + label
        var msun  = document.getElementById('mobileThemeSunIcon');
        var mmoon = document.getElementById('mobileThemeMoonIcon');
        var mauto = document.getElementById('mobileThemeAutoIcon');
        var mlbl  = document.getElementById('mobileThemeLabel');
        if (msun)  msun.classList.toggle('hidden', mode !== 'dark');
        if (mmoon) mmoon.classList.toggle('hidden', mode !== 'light');
        if (mauto) mauto.classList.toggle('hidden', mode !== 'auto');
        if (mlbl)  mlbl.textContent = mode === 'auto' ? 'Auto' : (dark ? 'Dark Mode' : 'Light Mode');
    }

    // Cycle: auto → dark → light → auto
    window.toggleColorScheme = function () {
        var mode = currentMode();
        var next = mode === 'auto' ? 'dark' : (mode === 'dark' ? 'light' : 'auto');
        applyMode(next);
        updateUI();
    };

    // Sync UI on first paint (icons may not be in DOM during <head> script)
    document.addEventListener('DOMContentLoaded', updateUI);

    // React to OS-level changes when user is in auto mode
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (currentMode() === 'auto') {
            document.documentElement.setAttribute('data-color-scheme', e.matches ? 'dark' : 'light');
            updateUI();
        }
    });
})();
