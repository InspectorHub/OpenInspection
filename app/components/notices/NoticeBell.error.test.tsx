// @vitest-environment happy-dom
/**
 * A refused dismiss or mark-all-read must show in the bell's panel, not vanish.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { StaffNoticeBell } from "./StaffNoticeBell";

const NOTICE = { id: "n1", tenantId: "", type: "report.published", title: "Report ready", body: null, inspectionId: null, createdAt: Date.now() - 3600_000, readAt: null, channels: [] };

function mount(writeOk: boolean) {
    const Stub = createRoutesStub([
        { path: "/", Component: StaffNoticeBell },
        {
            path: "/resources/staff-notices",
            loader: () => ({ notices: [NOTICE], unread: 1 }),
            action: async ({ request }) => ({ ok: writeOk, intent: String((await request.formData()).get("intent")) }),
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("staff notice bell write failures", () => {
    it("shows an alert in the open panel when a dismiss is refused", async () => {
        mount(false);
        fireEvent.click(await screen.findByRole("button", { name: /notification|notice/i }));
        await screen.findByText("Your inspection report is ready");
        fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be/i);
    });

    it("CONTROL: no alert when the dismiss goes through", async () => {
        mount(true);
        fireEvent.click(await screen.findByRole("button", { name: /notification|notice/i }));
        await screen.findByText("Your inspection report is ready");
        fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
});
