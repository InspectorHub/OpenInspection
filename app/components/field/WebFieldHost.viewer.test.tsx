// @vitest-environment happy-dom
/**
 * The editor routes sit outside `routes/auth-layout`, so the host has no session context of its own. The
 * editor's loader reads the viewer's display values and the host serves them, so the package shows dates
 * in the viewer's own zone and shape and names the viewer, instead of the en-US / UTC / us / 12h fallbacks.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useFieldDataSource } from "@core/field-ui/context";
import type { FieldDataSource } from "@core/field-ui/data-source";
import { formatShapedDateTime } from "@core/field-ui/shared/format-date";
import { loaderPayload } from "~/lib/field/web-editor-data.fixtures";
import type { EditorLoaderData } from "~/lib/field/web-editor-data";
import { viewerFromSessionContext } from "~/lib/field/web-session";
import { WebFieldHost } from "./WebFieldHost";

function Probe({ onSeen }: { onSeen: (ds: FieldDataSource) => void }) {
    onSeen(useFieldDataSource());
    return <p>probe</p>;
}

function mount(editor: EditorLoaderData, onSeen: (ds: FieldDataSource) => void) {
    const Stub = createRoutesStub([{ path: "/", Component: () => <WebFieldHost editor={editor}><Probe onSeen={onSeen} /></WebFieldHost> }]);
    return render(<Stub initialEntries={["/"]} />);
}

const SESSION_CONTEXT = {
    user: { sessionMarker: "marker-1", role: "inspector", timezone: "America/Chicago", locale: "es-MX", dateFormat: "eu", timeFormat: "24h", name: "Pat", capabilities: {} },
    branding: { defaultTimezone: "Asia/Tokyo", defaultLocale: "en-GB", dateFormat: "iso", timeFormat: "12h", tenantSlug: "acme" },
};

describe("WebFieldHost serves the editor loader's viewer", () => {
    it("session() carries the viewer's marker, role, locale, zone and formats, and a date renders in that zone", async () => {
        let ds: FieldDataSource | null = null;
        mount(loaderPayload({ viewer: viewerFromSessionContext(SESSION_CONTEXT) }), (d) => { ds = d; });
        await screen.findByText("probe");
        const session = ds!.session();
        expect(session).toMatchObject({
            userId: "marker-1", role: "inspector", locale: "es-MX", timeZone: "America/Chicago",
            dateFormat: "eu", timeFormat: "24h", tenantDateFormat: "iso", tenantTimeFormat: "12h",
        });
        // 2026-10-22 03:30 UTC is 22:30 on the 21st in Chicago (UTC-5).
        const at = Date.UTC(2026, 9, 22, 3, 30);
        const viewerShape = { locale: session.locale, dateFormat: session.dateFormat, timeFormat: session.timeFormat };
        const inChicago = formatShapedDateTime(at, session.timeZone ?? "UTC", viewerShape);
        expect(inChicago).toContain("21");
        expect(inChicago).toContain("22:30");
        expect(inChicago).not.toBe(formatShapedDateTime(at, "UTC", { locale: "en-US", dateFormat: "us", timeFormat: "12h" }));
    });

    it("falls back to the tenant for what the viewer did not set", async () => {
        let ds: FieldDataSource | null = null;
        const ctx = { ...SESSION_CONTEXT, user: { ...SESSION_CONTEXT.user, timezone: null, locale: null, dateFormat: null } };
        mount(loaderPayload({ viewer: viewerFromSessionContext(ctx) }), (d) => { ds = d; });
        await screen.findByText("probe");
        expect(ds!.session()).toMatchObject({ locale: "en-GB", timeZone: "Asia/Tokyo", dateFormat: "iso", timeFormat: "24h" });
    });

    it("keeps today's fallbacks when the loader read no viewer", async () => {
        let ds: FieldDataSource | null = null;
        mount(loaderPayload({ viewer: null }), (d) => { ds = d; });
        await screen.findByText("probe");
        expect(ds!.session()).toMatchObject({ locale: "en-US", timeZone: "UTC", dateFormat: "us", timeFormat: "12h", userId: "current-user", role: "" });
    });
});

describe("viewerFromSessionContext", () => {
    it("is null unless the answer carries both the user and the branding", () => {
        expect(viewerFromSessionContext(null)).toBeNull();
        expect(viewerFromSessionContext({ user: {} })).toBeNull();
        expect(viewerFromSessionContext({ branding: {} })).toBeNull();
        expect(viewerFromSessionContext("x")).toBeNull();
    });

    it("keeps only recognised formats and non-empty strings, and never carries the viewer's name or email", () => {
        const viewer = viewerFromSessionContext({
            user: { sessionMarker: "", role: "owner", timezone: "", locale: 5, dateFormat: "nope", timeFormat: "24h", name: "Pat", email: "p@x.test" },
            branding: { defaultTimezone: "", defaultLocale: null, dateFormat: "eu", timeFormat: "bad" },
        });
        expect(viewer).toEqual({
            user: { role: "owner", timezone: null, locale: null, dateFormat: null, timeFormat: "24h" },
            branding: { defaultTimezone: "UTC", defaultLocale: "en-US", dateFormat: "eu", timeFormat: "12h" },
        });
    });
});
