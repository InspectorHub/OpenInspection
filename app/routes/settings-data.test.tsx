// @vitest-environment happy-dom
/**
 * Settings → Data, and the three export buttons that did not export.
 *
 * All three linked at `/api/admin/export` with a `format=` and a `type=` query
 * parameter. That route declares no query parameters and reads none, so every
 * one of the three returned the same whole-tenant JSON blob — the CSV buttons
 * were labelled for files they never produced, and `/api/data/export/contacts`
 * had no consumer in `app/` at all. A round trip nobody can start is not a
 * round trip.
 *
 * So the assertions are about WHERE each button points and about the query
 * string NOT being there, each with a control in the same result: the full-JSON
 * link still points at the admin route, so "no format parameter" cannot pass on
 * a page that rendered no links, and the three CSV destinations are asserted as
 * a SET of distinct paths rather than three separate "a link exists" checks —
 * three buttons pointing at one address is exactly the bug this replaces.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import SettingsData from "~/routes/settings-data";

function renderPage(forbidden = false) {
    const Stub = createRoutesStub([
        {
            id: "routes/auth-layout",
            path: "/",
            loader: () => ({ context: {} }),
            Component: () => <Outlet />,
            children: [
                {
                    path: "settings/data",
                    Component: SettingsData,
                    loader: () => ({ forbidden }),
                },
            ],
        },
    ]);
    return render(<Stub initialEntries={["/settings/data"]} />);
}

/** The href of a link by its visible label. */
async function hrefOf(name: string): Promise<string> {
    return (await screen.findByRole("link", { name })).getAttribute("href") ?? "";
}

describe("settings → data: the export buttons point at routes that exist", () => {
    it("sends each CSV button to its own export route", async () => {
        renderPage();
        expect(await hrefOf("Inspections CSV")).toBe("/api/data/export/inspections");
        expect(await hrefOf("Contacts CSV")).toBe("/api/data/export/contacts");
        expect(await hrefOf("Team members CSV")).toBe("/api/data/export/members");
    });

    it("sends the three of them to three DIFFERENT places", async () => {
        // The bug this replaces was not a wrong address. It was one address
        // wearing three labels, which every single-link assertion above would
        // still pass.
        renderPage();
        const destinations = new Set([
            await hrefOf("Inspections CSV"),
            await hrefOf("Contacts CSV"),
            await hrefOf("Team members CSV"),
        ]);
        expect(destinations.size).toBe(3);
    });

    it("carries no query parameter any of those routes would ignore", async () => {
        renderPage();
        for (const label of ["Inspections CSV", "Contacts CSV", "Team members CSV"]) {
            const href = await hrefOf(label);
            expect(href).not.toContain("format=");
            expect(href).not.toContain("type=");
            expect(href).not.toContain("?");
        }
        // POSITIVE CONTROL — the whole-tenant download still goes to the admin
        // route WITH its parameter, so "no query string" is a fact about the
        // three CSV links and not about a page that rendered nothing.
        expect(await hrefOf("Full JSON")).toBe("/api/admin/export?format=json");
    });

    it("asks the browser to save each one rather than to display it", async () => {
        renderPage();
        for (const label of ["Inspections CSV", "Contacts CSV", "Team members CSV"]) {
            const link = await screen.findByRole("link", { name: label });
            expect(link.hasAttribute("download")).toBe(true);
        }
    });
});
