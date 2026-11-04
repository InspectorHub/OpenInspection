// @vitest-environment happy-dom
/**
 * Retract takes a published report back from clients and expires their links, so it asks first in a dialog that says so
 * (never window.confirm), and the confirm writes once.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { m } from "~/paraglide/messages";
import { RetractReportControl } from "./RetractReportControl";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

function mount() {
    const intents: string[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: RetractReportControl,
            action: async ({ request }) => {
                intents.push(String((await request.formData()).get("intent")));
                return { ok: true };
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return intents;
}

describe("RetractReportControl", () => {
    it("writes nothing until the dialog is confirmed, and the dialog says what retracting does", async () => {
        const confirm = vi.fn(() => true);
        vi.stubGlobal("confirm", confirm);
        const intents = mount();
        await settle();
        fireEvent.click(screen.getByRole("button", { name: m.inspections_hub_report_unpublish() }));
        await settle();
        expect(screen.getByText(m.inspections_hub_retract_body())).toBeTruthy();
        expect(intents).toEqual([]);
        fireEvent.click(screen.getByRole("button", { name: m.inspections_hub_retract_confirm() }));
        await settle();
        expect(intents).toEqual(["unpublish"]);
        expect(confirm).not.toHaveBeenCalled();
    });

    it("cancel closes the dialog without writing", async () => {
        const intents = mount();
        await settle();
        fireEvent.click(screen.getByRole("button", { name: m.inspections_hub_report_unpublish() }));
        await settle();
        fireEvent.click(screen.getByRole("button", { name: m.inspections_hub_retract_cancel() }));
        await settle();
        expect(intents).toEqual([]);
        expect(screen.queryByText(m.inspections_hub_retract_body())).toBeNull();
    });

    it("two same-frame submits retract once", async () => {
        const intents = mount();
        await settle();
        fireEvent.click(screen.getByRole("button", { name: m.inspections_hub_report_unpublish() }));
        await settle();
        const form = document.getElementById("retract-report-form") as HTMLFormElement;
        act(() => { fireEvent.submit(form); fireEvent.submit(form); });
        await settle();
        expect(intents).toEqual(["unpublish"]);
    });
});
