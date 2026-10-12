// @vitest-environment happy-dom
/**
 * Two clicks dispatched in one frame must reach the action once: the route
 * navigation is still "idle" when the second one lands, so the guard is the
 * submit latch, and the button turns aria-disabled (never natively disabled)
 * once the navigation is under way.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useForm } from "@conform-to/react";
import { ChangePasswordPanel } from "./ChangePasswordPanel";
import { DataExportPanel } from "./DataExportPanel";
import type { ChangePasswordInput } from "~/lib/forms/settings.schema";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

function PasswordHarness() {
    const [pwForm, pwFields] = useForm<ChangePasswordInput>({});
    return <ChangePasswordPanel pwForm={pwForm} pwFields={pwFields} showPassword={false} setShowPassword={() => {}} />;
}

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

const cases: Array<[string, () => React.ReactElement, RegExp]> = [
    ["ChangePasswordPanel", PasswordHarness, /change password|update password|^save/i],
    ["DataExportPanel", DataExportPanel, /download my data/i],
];

describe.each(cases)("%s - submit busy protection", (_name, Component, label) => {
    it("lets only one of two same-frame clicks reach the action", async () => {
        renderRoute(Component);
        const button = screen.getByRole("button", { name: label });
        act(() => { button.click(); button.click(); });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
    });

    it("goes aria-disabled, not natively disabled, while the action runs", async () => {
        renderRoute(Component);
        const button = screen.getByRole("button", { name: label });
        act(() => { button.click(); });
        await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
        expect((button as HTMLButtonElement).disabled).toBe(false);
        await act(async () => { release(); });
    });
});
