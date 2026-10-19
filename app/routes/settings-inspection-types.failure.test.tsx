// @vitest-environment happy-dom
/**
 * A refused save or enable/disable on Settings -> Inspection types used to do
 * nothing visible: the modal stayed or the button seemed dead. Both now say so.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import SettingsInspectionTypes from "~/routes/settings-inspection-types";

const TYPE = { id: "t1", name: "Pool inspection", basedOn: null, description: null, enabled: true, sortOrder: 0 };

function mount() {
    const Stub = createRoutesStub([
        { path: "/settings/inspection-types", Component: SettingsInspectionTypes, loader: () => ({ forbidden: false, orgTypes: [TYPE] }) },
    ]);
    return render(<Stub initialEntries={["/settings/inspection-types"]} />);
}

describe("settings → inspection types: failures are shown", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("a refused enable/disable shows an alert and leaves the type as it was", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
        mount();
        await screen.findByText("Pool inspection");
        fireEvent.click(screen.getByRole("button", { name: /^disable$/i }));
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be saved/i);
        expect(screen.getByRole("button", { name: /^disable$/i })).toBeTruthy();
    });

    it("a refused save keeps the dialog open with an alert", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
        mount();
        await screen.findByText("Pool inspection");
        fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
        fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be saved/i);
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("CONTROL: a toggle the server accepts shows no alert", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
        mount();
        await screen.findByText("Pool inspection");
        fireEvent.click(screen.getByRole("button", { name: /^disable$/i }));
        await screen.findByRole("button", { name: /^enable$/i });
        expect(screen.queryByRole("alert")).toBeNull();
    });
});
