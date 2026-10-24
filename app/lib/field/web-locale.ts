import { bindFieldLocaleSource } from "@core/field-ui/i18n/locale";
import { getLocale } from "~/paraglide/runtime";

/**
 * Keep the field editor package's messages in the app's locale.
 *
 * The package compiles its own paraglide runtime (`packages/field-ui/src/i18n`),
 * so it has its own locale variable. This hands it the app runtime's
 * `getLocale` to read on every message call instead of copying a value once:
 *
 * - On the server that function reads the request-scoped store that
 *   `paraglideMiddleware` opens around the whole render, so two requests in
 *   different locales rendering at once each get their own answer. A
 *   `setFieldLocale(getLocale())` from a loader would write one module-level
 *   variable that every in-flight render shares.
 * - In the browser `entry.client.tsx` has already made `getLocale` pure (it reads
 *   `<html lang>` and the cookie). The package therefore resolves the same
 *   locale the server rendered, so hydration cannot disagree.
 *
 * The thunk is deliberate: `getLocale` is a `let` binding that `entry.client`
 * replaces with `overwriteGetLocale`, and a thunk always calls the current one.
 *
 * Idempotent, and cheap. It imports only the package's locale half (no
 * catalogue), and it is called from BOTH host entry points - `entry.client.tsx` and
 * `entry.server.tsx` - so the package reads the app's locale on every page, not only
 * after the editor's lazy chunk has loaded. A component moved into the package can then
 * render on any route without server and client disagreeing during hydration.
 */
export function bindFieldUiLocale(): void {
    bindFieldLocaleSource(() => getLocale());
}
