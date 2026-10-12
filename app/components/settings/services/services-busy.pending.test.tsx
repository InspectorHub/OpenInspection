// @vitest-environment happy-dom
/**
 * Two clicks dispatched in one frame must reach the action once: the navigation
 * (or fetcher) is still "idle" when the second one lands, so the guard is the
 * submit latch, and the button goes aria-disabled rather than natively disabled.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ServiceEditForm } from "./ServiceEditForm";
import { ServicesCatalogPanel } from "./ServicesCatalogPanel";
import { PayRuleWidget } from "./PayRuleWidget";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

function renderRoute(Component: () => React.ReactElement) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component,
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return null;
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

const SERVICE = {
    id: "svc-1", name: "Roof inspection", description: null, price: 35000,
    active: true, durationMinutes: 60, templateId: "tpl-1",
};

const cases: Array<[string, () => React.ReactElement, () => HTMLElement]> = [
    [
        "ServiceEditForm",
        () => <ServiceEditForm service={SERVICE} templates={[{ id: "tpl-1", name: "Standard" }]} onCancel={() => {}} />,
        () => screen.getByRole("button", { name: "Save" }),
    ],
    [
        "ServicesCatalogPanel toggle",
        () => (
            <ServicesCatalogPanel
                services={[SERVICE]} restrictionMap={{}} payRuleMap={{}} members={[]}
                templateNames={{ "tpl-1": "Standard" }}
            />
        ),
        () => screen.getByRole("button", { name: /deactivate/i }),
    ],
    [
        "PayRuleWidget remove",
        () => (
            <PayRuleWidget
                serviceId="svc-1"
                members={[{ id: "u1", email: "dana@example.com", role: "inspector" }]}
                rules={[{ id: "pr-1", userId: "u1", type: "percent", percentBps: 6000, amountCents: null, deductionCents: null }]}
            />
        ),
        () => {
            const open = screen.queryByRole("button", { name: /remove/i });
            if (!open) fireEvent.click(screen.getByRole("button", { name: /change/i }));
            return screen.getByRole("button", { name: /remove/i });
        },
    ],
];

describe.each(cases)("%s - submit busy protection", (_name, Component, find) => {
    it("lets only one of two same-frame clicks reach the action", async () => {
        renderRoute(Component);
        const button = find();
        act(() => { button.click(); button.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });

    it("goes aria-disabled, not natively disabled, while the action runs", async () => {
        renderRoute(Component);
        const button = find();
        act(() => { button.click(); });
        await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
        expect((button as HTMLButtonElement).disabled).toBe(false);
        await act(async () => { release(); });
    });
});
