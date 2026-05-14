/**
 * Color scheme toggle — dark / light / system.
 * Reads/writes localStorage key 'ih-color-scheme'.
 * The html[data-color-scheme] attribute is set by an inline <script> in
 * <head> before stylesheets load to prevent FOUC; this file handles the
 * runtime toggle and icon/label updates.
 */
(function () {
    function isDarkActive() {
        return document.documentElement.getAttribute('data-color-scheme') === 'dark';
    }

    function updateUI() {
        var dark = isDarkActive();
        // Desktop icons
        var sun  = document.getElementById('themeSunIcon');
        var moon = document.getElementById('themeMoonIcon');
        var lbl  = document.getElementById('themeToggleLabel');
        if (sun)  sun.classList.toggle('hidden', !dark);
        if (moon) moon.classList.toggle('hidden', dark);
        if (lbl)  lbl.textContent = dark ? 'Light Mode' : 'Dark Mode';
        // Mobile label
        var mlbl = document.getElementById('mobileThemeLabel');
        if (mlbl) mlbl.textContent = dark ? 'Light Mode' : 'Dark Mode';
    }

    window.toggleColorScheme = function () {
        var next = isDarkActive() ? 'light' : 'dark';
        document.documentElement.setAttribute('data-color-scheme', next);
        localStorage.setItem('ih-color-scheme', next);
        updateUI();
    };

    // Sync UI on first paint (icons may not be in DOM during <head> script)
    document.addEventListener('DOMContentLoaded', updateUI);

    // React to OS-level changes when user has no saved preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!localStorage.getItem('ih-color-scheme')) {
            document.documentElement.setAttribute('data-color-scheme', e.matches ? 'dark' : 'light');
            updateUI();
        }
    });
})();
