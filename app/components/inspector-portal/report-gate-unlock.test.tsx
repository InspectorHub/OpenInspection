// @vitest-environment happy-dom
/**
 * The order-wide gate's release control.
 *
 * Two things are being pinned. First, a reason cannot be skipped — the whole
 * value of the record is that somebody later reads why this happened, and an
 * override with no stated reason is indistinguishable from a mistake. Second,
 * once unlocked the component stops being an ACTION and becomes a RECORD: who
 * released it, when, and their words. A control that quietly forgot the reason
 * after the fact would satisfy the API and defeat the point.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { ReportGateUnlock } from "~/components/inspector-portal/ReportGateUnlock";

const fmt = (iso: string) => `on ${iso.slice(0, 10)}`;

function renderControl(props: Partial<Parameters<typeof ReportGateUnlock>[0]> = {}) {
    const calls: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/hub",
            Component: () => (
                <ReportGateUnlock
                    unlockedAt={null}
                    unlockedByName={null}
                    unlockReason={null}
                    formatDate={fmt}
                    {...props}
                />
            ),
            action: async ({ request }) => {
                const form = await request.formData();
                calls.push(Object.fromEntries(form) as Record<string, string>);
                return { ok: true };
            },
        },
    ]);
    render(<Stub initialEntries={["/hub"]} />);
    return { calls };
}

describe("ReportGateUnlock", () => {
    it("is a quiet control, not a switch", async () => {
        // GateToggle's rule is "a switch, nothing to confirm". This one confirms,
        // so it must not present as a switch that flips on click.
        const { calls } = renderControl();
        expect(screen.queryByRole("checkbox")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /unlock reports for this inspection/i }));
        expect(calls).toHaveLength(0);
    });

    it("will not submit without a reason", async () => {
        renderControl();
        fireEvent.click(screen.getByRole("button", { name: /unlock reports for this inspection/i }));

        const dialog = await screen.findByRole("dialog");
        const confirm = within(dialog).getByRole("button", { name: /^unlock reports$/i });
        expect(confirm).toBeDisabled();
    });

    it("submits the reason once one is given", async () => {
        const { calls } = renderControl();
        fireEvent.click(screen.getByRole("button", { name: /unlock reports for this inspection/i }));

        const dialog = await screen.findByRole("dialog");
        fireEvent.change(within(dialog).getByLabelText(/why/i), {
            target: { value: "Client at closing; radon addendum still out." },
        });
        fireEvent.click(within(dialog).getByRole("button", { name: /^unlock reports$/i }));

        await waitFor(() => expect(calls).toEqual([
            { intent: "unlock-report", reason: "Client at closing; radon addendum still out." },
        ]));
    });

    it("trims a reason that is only whitespace", async () => {
        renderControl();
        fireEvent.click(screen.getByRole("button", { name: /unlock reports for this inspection/i }));

        const dialog = await screen.findByRole("dialog");
        fireEvent.change(within(dialog).getByLabelText(/why/i), { target: { value: "    " } });

        expect(within(dialog).getByRole("button", { name: /^unlock reports$/i })).toBeDisabled();
    });

    it("becomes a record once unlocked, quoting the reason", async () => {
        renderControl({
            unlockedAt: "2026-08-03T10:00:00.000Z",
            unlockedByName: "Dana Okoye",
            unlockReason: "Client at closing; radon addendum still out.",
        });

        expect(screen.getByText(/reports unlocked/i)).toBeTruthy();
        expect(screen.getByText(/Dana Okoye/)).toBeTruthy();
        expect(screen.getByText(/Client at closing/)).toBeTruthy();
        // No longer offers to unlock — it is already open.
        expect(screen.queryByRole("button", { name: /unlock reports for this inspection/i })).toBeNull();
    });

    it("names someone even when the person is unknown", async () => {
        // A backfilled or deleted user must not render "Released by  on ...".
        renderControl({
            unlockedAt: "2026-08-03T10:00:00.000Z",
            unlockedByName: null,
            unlockReason: "x",
        });
        expect(screen.getByText(/released by a teammate/i)).toBeTruthy();
    });

    it("offers to put the gate back", async () => {
        const { calls } = renderControl({
            unlockedAt: "2026-08-03T10:00:00.000Z",
            unlockedByName: "Dana Okoye",
            unlockReason: "x",
        });

        fireEvent.click(screen.getByRole("button", { name: /put the gate back/i }));
        await waitFor(() => expect(calls).toEqual([{ intent: "relock-report" }]));
    });
});
