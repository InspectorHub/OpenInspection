// @vitest-environment happy-dom
/**
 * "Mark fieldwork complete" on the inspection hub asks before it sends, like the editor's "Finish fieldwork".
 * Nothing is requested on open or cancel, and two presses of the confirm button in one frame send one request.
 */
import { afterEach, describe, it, expect } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { LifecycleCard } from "~/components/inspector-portal/LifecycleCard";
import { INSPECTION_STATUS } from "~/lib/status";
import { m } from "~/paraglide/messages";

afterEach(cleanup);

function renderCard(gate?: Promise<void>) {
    const submitted: Record<string, string>[] = [];
    function Host() {
        return <LifecycleCard status={INSPECTION_STATUS.SCHEDULED} inspectionId="insp-1" />;
    }
    const Stub = createRoutesStub([
        {
            path: "/hub",
            Component: Host,
            action: async ({ request }) => {
                submitted.push(Object.fromEntries(await request.formData()) as Record<string, string>);
                await gate;
                return { ok: true, intent: "complete" };
            },
        },
    ]);
    render(<Stub initialEntries={["/hub"]} />);
    return submitted;
}

const dialogName = () => m.editor_finish_fieldwork_confirm_title();

describe("LifecycleCard - mark fieldwork complete confirmation", () => {
    it("opens a dialog and sends nothing until it is confirmed", async () => {
        const submitted = renderCard();
        fireEvent.click(await screen.findByRole("button", { name: m.inspections_hub_lifecycle_mark_complete() }));
        await screen.findByRole("dialog", { name: dialogName() });
        expect(submitted).toEqual([]);
    });

    it("sends nothing when the dialog is cancelled", async () => {
        const submitted = renderCard();
        fireEvent.click(await screen.findByRole("button", { name: m.inspections_hub_lifecycle_mark_complete() }));
        const dialog = await screen.findByRole("dialog", { name: dialogName() });
        fireEvent.click(within(dialog).getByRole("button", { name: m.common_cancel() }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(submitted).toEqual([]);
    });

    it("sends one complete request for two presses of the confirm button in one frame", async () => {
        const submitted = renderCard();
        fireEvent.click(await screen.findByRole("button", { name: m.inspections_hub_lifecycle_mark_complete() }));
        const dialog = await screen.findByRole("dialog", { name: dialogName() });
        const confirm = within(dialog).getByRole("button", { name: m.inspections_hub_lifecycle_mark_complete() });
        act(() => {
            confirm.click();
            confirm.click();
        });
        await waitFor(() => expect(submitted).toHaveLength(1));
        expect(submitted[0]).toMatchObject({ intent: "complete" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("closes the dialog on confirm, keeps the page button disabled while marking, and stays closed once settled", async () => {
        let release: () => void = () => undefined;
        const submitted = renderCard(new Promise<void>((resolve) => { release = resolve; }));
        const pageButton = await screen.findByRole("button", { name: m.inspections_hub_lifecycle_mark_complete() });
        fireEvent.click(pageButton);
        const dialog = await screen.findByRole("dialog", { name: dialogName() });
        fireEvent.click(within(dialog).getByRole("button", { name: m.inspections_hub_lifecycle_mark_complete() }));
        await waitFor(() => expect(submitted).toHaveLength(1));
        // In flight: the dialog is gone and the page button shows the marking state, disabled.
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        const marking = await screen.findByRole("button", { name: m.inspections_hub_lifecycle_marking() });
        expect((marking as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { release(); });
        await waitFor(() => expect(screen.queryByRole("button", { name: m.inspections_hub_lifecycle_marking() })).toBeNull());
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
