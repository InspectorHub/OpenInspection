/**
 * Color scheme — auto / dark / light.
 * Reads/writes localStorage key 'oi-color-scheme' (per design system).
 *   null / absent → auto  (follow OS prefers-color-scheme)
 *   'dark'        → dark
 *   'light'       → light
 *
 * One-time migration: pre-design-system builds wrote 'ih-color-scheme'.
 * On first read we lift any legacy value over to the new key and drop the
 * old one so the user's preference survives the rename.
 *
 * Public API:
 *   window.setColorScheme(mode)  — set 'auto'|'dark'|'light' explicitly
 *   window.themeMenu()           — Alpine factory for the sidebar dropdown
 *
 * The html[data-color-scheme] attribute is set by an inline <script> in
 * <head> before stylesheets load to prevent FOUC.
 */
(function () {
    var STORAGE_KEY = 'oi-color-scheme';
    var LEGACY_KEY  = 'ih-color-scheme';

    function migrateLegacy() {
        try {
            var legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy && !localStorage.getItem(STORAGE_KEY)) {
                localStorage.setItem(STORAGE_KEY, legacy);
            }
            if (legacy) localStorage.removeItem(LEGACY_KEY);
        } catch (e) { /* private mode etc. */ }
    }
    migrateLegacy();

    function currentMode() {
        var s = localStorage.getItem(STORAGE_KEY);
        return s === 'dark' || s === 'light' ? s : 'auto';
    }

    function isDark() {
        return document.documentElement.getAttribute('data-color-scheme') === 'dark';
    }

    function applyMode(mode) {
        if (mode === 'auto') {
            localStorage.removeItem(STORAGE_KEY);
            var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-color-scheme', sysDark ? 'dark' : 'light');
        } else {
            localStorage.setItem(STORAGE_KEY, mode);
            document.documentElement.setAttribute('data-color-scheme', mode);
        }
    }

    function effectiveLabel() {
        var mode = currentMode();
        var dark = isDark();
        if (mode === 'auto') return 'Auto · ' + (dark ? 'Dark' : 'Light');
        return dark ? 'Dark' : 'Light';
    }

    function updateUI() {
        var mode = currentMode();
        var label = effectiveLabel();

        // Desktop icons
        var moon = document.getElementById('themeMoonIcon');
        var sun  = document.getElementById('themeSunIcon');
        var auto = document.getElementById('themeAutoIcon');
        var lbl  = document.getElementById('themeToggleLabel');
        if (moon) moon.classList.toggle('hidden', mode !== 'dark');
        if (sun)  sun.classList.toggle('hidden', mode !== 'light');
        if (auto) auto.classList.toggle('hidden', mode !== 'auto');
        if (lbl)  lbl.textContent = label;

        // Mobile icons
        var mmoon = document.getElementById('mobileThemeMoonIcon');
        var msun  = document.getElementById('mobileThemeSunIcon');
        var mauto = document.getElementById('mobileThemeAutoIcon');
        var mlbl  = document.getElementById('mobileThemeLabel');
        if (mmoon) mmoon.classList.toggle('hidden', mode !== 'dark');
        if (msun)  msun.classList.toggle('hidden', mode !== 'light');
        if (mauto) mauto.classList.toggle('hidden', mode !== 'auto');
        if (mlbl)  mlbl.textContent = label;
    }

    window.setColorScheme = function (mode) {
        applyMode(mode);
        updateUI();
    };

    // Alpine factory for the sidebar dropdown
    window.themeMenu = function () {
        return {
            open: false,
            get mode() { return currentMode(); },
            set: function (m) {
                this.open = false;
                window.setColorScheme(m);
            },
        };
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
