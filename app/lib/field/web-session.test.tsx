// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import {
    useChromeDateTimeFormat,
    useDisplayLocale,
    useDisplayTimeZone,
    useInspectionDateTimeFormat,
} from "~/hooks/useSessionContext";
import { webSessionInfo, type SessionContextLike, type SessionLoaderBits } from "./web-session";

/**
 * The AUTHORITY for every display value is the real hooks in
 * `app/hooks/useSessionContext.ts`. Each case renders them under a route with id
 * `routes/auth-layout` (or none, for the editor's null context) and asserts that
 * `webSessionInfo` answers the same.
 */

const BITS: SessionLoaderBits = {
    tenantSlug: "acme",
    videoProvider: "stream",
    streamCustomerSubdomain: "customer-x",
    collabEditing: true,
};

type Ctx = SessionContextLike;

const TENANT = { defaultTimezone: "America/Chicago", defaultLocale: "es-MX", dateFormat: "eu", timeFormat: "24h" } as const;

function ctx(over: { user?: Partial<Ctx["user"]>; branding?: Partial<Ctx["branding"]> }): Ctx {
    return {
        user: { role: "inspector", timezone: null, locale: null, dateFormat: null, timeFormat: null, ...over.user },
        branding: { ...TENANT, ...over.branding },
    };
}

interface FromHooks {
    locale: string;
    timeZone: string;
    chrome: { locale: string; dateFormat: string; timeFormat: string };
    inspection: { locale: string; dateFormat: string; timeFormat: string };
}

async function renderHooks(context: Ctx | null, withLayout: boolean): Promise<FromHooks> {
    let out: FromHooks | null = null;
    function Probe() {
        out = {
            locale: useDisplayLocale(),
            timeZone: useDisplayTimeZone(),
            chrome: useChromeDateTimeFormat(),
            inspection: useInspectionDateTimeFormat(),
        };
        return <span data-testid="probe">ok</span>;
    }
    const Stub = createRoutesStub(
        withLayout
            ? [{ path: "/", id: "routes/auth-layout", loader: () => ({ context }), Component: Probe }]
            : [{ path: "/", Component: Probe }],
    );
    const r = render(<Stub initialEntries={["/"]} />);
    await waitFor(() => expect(r.getByTestId("probe")).toBeTruthy());
    if (!out) throw new Error("probe did not render");
    return out;
}

const CASES: Array<{ name: string; context: Ctx | null; withLayout: boolean }> = [
    { name: "null context, no auth-layout (the editor today)", context: null, withLayout: false },
    { name: "null context under auth-layout", context: null, withLayout: true },
    { name: "tenant defaults only", context: ctx({}), withLayout: true },
    {
        name: "user overrides locale and zone",
        context: ctx({ user: { locale: "fr-CA", timezone: "Europe/Paris" } }),
        withLayout: true,
    },
    {
        name: "mixed: user overrides only the clock",
        context: ctx({ user: { timeFormat: "12h" } }),
        withLayout: true,
    },
    {
        name: "mixed: user overrides only the date order, tenant has neither default set to us",
        context: ctx({ user: { dateFormat: "iso" }, branding: { dateFormat: "us", timeFormat: "24h" } }),
        withLayout: true,
    },
];

describe("webSessionInfo matches the real session hooks", () => {
    for (const c of CASES) {
        it(c.name, async () => {
            const hooks = await renderHooks(c.context, c.withLayout);
            const info = webSessionInfo(c.context, BITS);
            expect(info.locale).toBe(hooks.locale);
            expect(info.timeZone).toBe(hooks.timeZone);
            expect(info.dateFormat).toBe(hooks.chrome.dateFormat);
            expect(info.timeFormat).toBe(hooks.chrome.timeFormat);
            expect(info.tenantDateFormat).toBe(hooks.inspection.dateFormat);
            expect(info.tenantTimeFormat).toBe(hooks.inspection.timeFormat);
            expect(hooks.chrome.locale).toBe(hooks.locale);
            expect(hooks.inspection.locale).toBe(hooks.locale);
        });
    }

    it("null-context fallbacks are en-US / UTC / us / 12h, confirmed against the hooks' own output", async () => {
        const hooks = await renderHooks(null, false);
        const info = webSessionInfo(null, BITS);
        expect(hooks).toEqual({
            locale: "en-US",
            timeZone: "UTC",
            chrome: { locale: "en-US", dateFormat: "us", timeFormat: "12h" },
            inspection: { locale: "en-US", dateFormat: "us", timeFormat: "12h" },
        });
        expect([info.locale, info.timeZone, info.dateFormat, info.timeFormat, info.tenantDateFormat, info.tenantTimeFormat]).toEqual([
            "en-US", "UTC", "us", "12h", "us", "12h",
        ]);
    });

    it("keeps viewer and tenant axes apart when only the viewer overrides", async () => {
        const context = ctx({ user: { dateFormat: "iso" } });
        const hooks = await renderHooks(context, true);
        const info = webSessionInfo(context, BITS);
        expect(hooks.chrome.dateFormat).not.toBe(hooks.inspection.dateFormat);
        expect(info.dateFormat).not.toBe(info.tenantDateFormat);
    });
});

describe("webSessionInfo non-display fields", () => {
    it("passes the loader bits through untouched", () => {
        const info = webSessionInfo(null, BITS);
        expect(info).toMatchObject(BITS);
    });

    it("has no user id and an empty role without a context: there is no shared placeholder identity", () => {
        const info = webSessionInfo(null, BITS);
        expect(info.userId).toBeNull();
        expect(info.role).toBe("");
        expect(JSON.stringify(info)).not.toContain("current-user");
    });

    it("has no user id when the context carries no session marker", () => {
        expect(webSessionInfo(ctx({ user: { role: "owner" } }), BITS).userId).toBeNull();
        expect(webSessionInfo(ctx({ user: { sessionMarker: "" } }), BITS).userId).toBeNull();
    });

    it("prefers the session marker and the context role when present", () => {
        const info = webSessionInfo(ctx({ user: { sessionMarker: "m-123", role: "owner" } }), BITS);
        expect(info.userId).toBe("m-123");
        expect(info.role).toBe("owner");
    });
});
