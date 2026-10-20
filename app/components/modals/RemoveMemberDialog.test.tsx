// @vitest-environment happy-dom
/**
 * The removal dialog's contract: it names the member, carries the full
 * unsynced-data warning, and hands the SAME target back on confirm.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { RemoveMemberDialog } from "./RemoveMemberDialog";

const TARGET = { id: "m-1", name: "Dana Reyes" };

const WARNING =
    "Their devices may still hold inspection data that has not been uploaded. Once removed, that data can no longer be uploaded. Ask them to connect and sync first. If that is not possible, they can export the data from the app and give it to another team member to import.";

afterEach(cleanup);

describe("RemoveMemberDialog", () => {
    it("renders nothing when there is no target", () => {
        render(<RemoveMemberDialog target={null} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("names the member and shows the whole warning as a warning banner", () => {
        render(<RemoveMemberDialog target={TARGET} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
        const dialog = screen.getByRole("dialog");
        expect(dialog.textContent).toContain("Remove Dana Reyes?");
        // role=alert is the Banner's warn/danger tone; plain text would pass
        // the text assertion alone while losing the emphasis.
        const alert = within(dialog).getByRole("alert");
        expect(alert.textContent).toBe(WARNING);
    });

    it("links the hand-over sentence to the offline package import page", () => {
        render(<RemoveMemberDialog target={TARGET} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
        const link = within(screen.getByRole("dialog")).getByRole("link", { name: "Import an offline package" });
        expect(link.getAttribute("href")).toBe("/settings/offline-packages");
    });

    it("inside a router the link navigates client-side instead of reloading the page", () => {
        const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
        render(
            <MemoryRouter initialEntries={["/team"]}>
                <Routes>
                    <Route path="/team" element={<RemoveMemberDialog target={TARGET} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />} />
                    <Route path="/settings/offline-packages" element={<Where />} />
                </Routes>
            </MemoryRouter>,
        );
        const link = within(screen.getByRole("dialog")).getByRole("link", { name: "Import an offline package" });
        expect(link.getAttribute("href")).toBe("/settings/offline-packages");
        const proceeded = fireEvent.click(link);
        // A router Link cancels the browser's own navigation; a plain anchor would not.
        expect(proceeded).toBe(false);
        expect(screen.getByTestId("where").textContent).toBe("/settings/offline-packages");
    });

    it("outside a router the link is a plain anchor the browser follows (positive control)", () => {
        render(<RemoveMemberDialog target={TARGET} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
        const link = within(screen.getByRole("dialog")).getByRole("link", { name: "Import an offline package" });
        expect(fireEvent.click(link)).toBe(true);
    });

    it("offers no link while the dialog is closed (positive control)", () => {
        render(<RemoveMemberDialog target={null} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
        expect(screen.queryByRole("link", { name: "Import an offline package" })).toBeNull();
    });

    it("hands the same target back on confirm", () => {
        const onConfirm = vi.fn();
        render(<RemoveMemberDialog target={TARGET} busy={false} error={null} onConfirm={onConfirm} onCancel={() => {}} />);
        fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm.mock.calls[0]?.[0]).toBe(TARGET);
    });

    it("does not confirm while busy", () => {
        const onConfirm = vi.fn();
        render(<RemoveMemberDialog target={TARGET} busy onConfirm={onConfirm} onCancel={() => {}} error={null} />);
        fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("shows a server refusal inside the dialog and keeps it open", () => {
        render(<RemoveMemberDialog target={TARGET} busy={false} error="Cannot remove the last owner" onConfirm={() => {}} onCancel={() => {}} />);
        const dialog = screen.getByRole("dialog");
        expect(dialog.textContent).toContain("Cannot remove the last owner");
        expect(within(dialog).getAllByRole("alert")).toHaveLength(2);
    });
});
