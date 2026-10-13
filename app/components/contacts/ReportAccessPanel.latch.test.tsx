// @vitest-environment happy-dom
/**
 * Two revoke submits dispatched in ONE frame (Revoke all, or any mix of row
 * buttons - they share one fetcher) reach the route action once.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ReportAccessPanel, type AccessRow } from "./ReportAccessPanel";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const ROWS: AccessRow[] = [
    { inspectionId: "insp-a", propertyAddress: "1 Main St", role: "buyer_agent", roleLabel: null, createdAt: 1 },
    { inspectionId: "insp-b", propertyAddress: "2 Oak Ave", role: "buyer_agent", roleLabel: null, createdAt: 2 },
];

function mount() {
    const calls: string[] = [];
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <ReportAccessPanel access={ROWS} accessFailed={false} />,
            action: async ({ request }) => {
                const fd = await request.formData();
                calls.push(`${fd.get("intent")}:${fd.get("inspectionId") ?? "all"}`);
                return { ok: true, revoked: 1 };
            },
        },
    ]);
    const { container } = render(<Stub initialEntries={["/"]} />);
    return { calls, forms: Array.from(container.querySelectorAll("form")) };
}

describe("ReportAccessPanel revoke latch", () => {
    it("Revoke all reaches the action once for two same-frame submits", async () => {
        const { calls, forms } = mount();
        act(() => { fireEvent.submit(forms[0]); fireEvent.submit(forms[0]); });
        await settle();
        expect(calls).toEqual(["revoke-access:all"]);
    });

    it("two different row buttons in one frame revoke once - one fetcher, one request", async () => {
        const { calls, forms } = mount();
        act(() => { fireEvent.submit(forms[1]); fireEvent.submit(forms[2]); });
        await settle();
        expect(calls).toEqual(["revoke-access:insp-a"]);
    });

    it("CONTROL - a later revoke goes through once the first has settled", async () => {
        const { calls, forms } = mount();
        act(() => { fireEvent.submit(forms[1]); });
        await settle();
        act(() => { fireEvent.submit(forms[2]); });
        await settle();
        expect(calls).toEqual(["revoke-access:insp-a", "revoke-access:insp-b"]);
    });
});
