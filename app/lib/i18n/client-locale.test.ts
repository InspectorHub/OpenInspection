// @vitest-environment happy-dom
//
// Guards the hydration seam. The e2e spec that first caught this
// (`locale-activation.spec.ts`, "a Spanish browser with no cookie gets Spanish")
// races hydration and therefore only fails sometimes — it passed against the
// unfixed build on a re-run. These assertions are deterministic.
import { describe, it, expect, afterEach } from "vitest";
import { resolveClientLocale } from "~/lib/i18n/client-locale";

function clearCookie() {
    document.cookie = "PARAGLIDE_LOCALE=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

afterEach(clearCookie);

describe("resolveClientLocale", () => {
    it("takes the server's <html lang> when there is no cookie", () => {
        clearCookie();
        // The regression: this returned 'en' and hydration repainted a
        // Spanish-rendered page in English.
        expect(resolveClientLocale("es-419")).toBe("es-419");
    });

    it("falls back to the base locale when the server said nothing usable", () => {
        clearCookie();
        expect(resolveClientLocale("")).toBe("en");
        expect(resolveClientLocale("not-a-tag")).toBe("en");
    });

    it("lets an explicit cookie beat the server's tag", () => {
        // A viewer who picked English on a Spanish-configured workspace keeps
        // English — the cookie is a stated preference, `<html lang>` is a default.
        document.cookie = "PARAGLIDE_LOCALE=en; path=/";
        expect(resolveClientLocale("es-419")).toBe("en");
    });
});
