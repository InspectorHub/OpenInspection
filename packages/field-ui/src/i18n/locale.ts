// The locale half of the package's i18n: pick or bind the locale. It imports only the
// compiled RUNTIME, never the message catalogue, so a host entry point can call it on
// every page without pulling the catalogue into that chunk. `./index` adds `m`.
import { baseLocale, getLocale, isLocale, overwriteGetLocale, setLocale } from './generated/runtime.js';

// `getLocale` is a live `let` binding that overwriteGetLocale replaces, so the
// package's own implementation has to be captured before anything can overwrite it.
const defaultGetLocale = getLocale;

/**
 * Pin the package to one locale, explicitly.
 *
 * Use this from a host that has no per-request locale scope: a native shell, a
 * test, a single-user browser app. An unknown tag falls back to the base locale
 * rather than throwing, because a locale the catalogue does not carry is a
 * configuration gap and must not blank the editor. Calling this also detaches
 * any source installed with `bindFieldLocaleSource`.
 *
 * On a server that renders several requests at once, do NOT use this: it writes
 * a module-level variable that every in-flight render reads. Bind a
 * request-scoped source instead.
 */
export function setFieldLocale(locale: string): void {
    overwriteGetLocale(defaultGetLocale);
    // reload:false - the default would reload the page on a client when the locale changes.
    void setLocale(isLocale(locale) ? locale : baseLocale, { reload: false });
}

/**
 * Make the package read its locale from the host on every message call.
 *
 * The host passes the same function its own messages use (on the web, the app
 * runtime's `getLocale`, which reads the request-scoped store on the server and
 * `<html lang>` or the cookie in the browser). The package then agrees with the
 * app by construction, with no copy to go stale and no shared mutable variable
 * between concurrent server renders. `null` restores the package's own variable.
 */
export function bindFieldLocaleSource(read: (() => string) | null): void {
    if (read === null) {
        overwriteGetLocale(defaultGetLocale);
        return;
    }
    overwriteGetLocale(() => {
        const locale = read();
        return isLocale(locale) ? locale : baseLocale;
    });
}
