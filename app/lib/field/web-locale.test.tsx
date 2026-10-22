// @vitest-environment happy-dom
//
// Review focus: the editor package and the app each compile their OWN paraglide
// runtime, so there are two locale variables. If they ever disagree, one render
// tree shows half Spanish and half English. This renders a package-side element
// and an app-side element in ONE tree and moves the locale back and forth.
//
// How the host keeps the two in step:
//   - web (this app): `bindFieldUiLocale()` hands the package the app runtime's
//     `getLocale`, so the package re-reads the app's answer on every message call.
//     The app's answer is request-scoped on the server and `<html lang>`/cookie in
//     the browser, so server and client agree and hydration cannot mismatch. The
//     call is made by both host entry points (entry.client / entry.server), not by a route.
//   - a host with no per-request scope (native shell, tests): `setFieldLocale()`
//     pins the package to a locale explicitly.
// The package cannot import the app, so this test lives with the web adapter.
import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { m as fieldM } from "@core/field-ui/i18n";
import { setFieldLocale, bindFieldLocaleSource } from "@core/field-ui/i18n/locale";
import { m as appM } from "~/paraglide/messages";
import { setLocale } from "~/paraglide/runtime";
import { bindFieldUiLocale } from "~/lib/field/web-locale";

function Both() {
    return (
        <div>
            <button data-testid="package">{fieldM.nav_item_inspections()}</button>
            <button data-testid="app">{appM.settings_error_save_failed()}</button>
        </div>
    );
}

function texts(view: ReturnType<typeof render>) {
    return [view.getByTestId("package").textContent, view.getByTestId("app").textContent];
}

afterEach(() => {
    cleanup();
    void setLocale("en", { reload: false });
    bindFieldLocaleSource(null);
    setFieldLocale("en");
});

describe("field package locale follows the host", () => {
    it("bound to the app runtime: both sides switch to Spanish and back", () => {
        bindFieldUiLocale();
        void setLocale("en", { reload: false });
        const view = render(<Both />);
        expect(texts(view)).toEqual(["Inspections", "Save failed"]);

        void setLocale("es-419", { reload: false });
        view.rerender(<Both />);
        const [pkgEs, appEs] = texts(view);
        expect(pkgEs).toBe("Inspecciones");
        expect(appEs).toBe("No se pudo guardar");

        void setLocale("en", { reload: false });
        view.rerender(<Both />);
        expect(texts(view)).toEqual(["Inspections", "Save failed"]);
    });

    it("pinned explicitly with setFieldLocale: the package switches without the app", () => {
        const view = render(<Both />);
        setFieldLocale("es-419");
        view.rerender(<Both />);
        expect(view.getByTestId("package").textContent).toBe("Inspecciones");
        // The app side is untouched, which is exactly why a host must call both.
        expect(view.getByTestId("app").textContent).toBe("Save failed");

        setFieldLocale("en");
        view.rerender(<Both />);
        expect(view.getByTestId("package").textContent).toBe("Inspections");
    });

    it("falls back to English for a tag the catalogue does not carry", () => {
        setFieldLocale("xx-YY");
        const view = render(<Both />);
        expect(view.getByTestId("package").textContent).toBe("Inspections");
    });
});

// A binder nothing calls is the failure this guards: the server entry is evaluated for every route,
// but the browser only loads a route's chunk when the user navigates there, so binding from a route
// leaves the client reading the package's own English default on every other page while the server
// rendered Spanish. Both host entry points must make the call themselves.
describe("the host entry points bind the package locale", () => {
    for (const file of ["app/entry.client.tsx", "app/entry.server.tsx"]) {
        it(`${file} calls bindFieldUiLocale() at module level`, () => {
            const source = readFileSync(file, "utf8");
            expect(source).toMatch(/^bindFieldUiLocale\(\);$/m);
            expect(source).toContain('from "~/lib/field/web-locale"');
        });
    }
});
