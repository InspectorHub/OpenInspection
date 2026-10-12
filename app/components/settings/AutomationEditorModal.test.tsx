// @vitest-environment happy-dom
/** Two same-frame submits of the save form must reach the action once; the latch then releases. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { AutomationEditorModal } from "./AutomationEditorModal";

afterEach(cleanup);

let calls = 0;
let release: () => void = () => {};
beforeEach(() => {
    calls = 0;
    release = () => {};
});

function renderModal() {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <AutomationEditorModal
                    rule={null}
                    services={[]}
                    emailTemplates={[]}
                    smsTemplates={[]}
                    roleProfiles={[]}
                    onClose={() => {}}
                />
            ),
            action: async () => {
                calls += 1;
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: false, error: "nope" };
            },
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("AutomationEditorModal save latch", () => {
    it("lets only one of two same-frame submits through, then releases", async () => {
        renderModal();
        const form = await waitFor(() => {
            const el = document.getElementById("automation-editor-form");
            expect(el).not.toBeNull();
            return el!;
        });
        act(() => {
            fireEvent.submit(form);
            fireEvent.submit(form);
        });
        await waitFor(() => expect(calls).toBe(1));
        expect(calls).toBe(1);
        await act(async () => { release(); });
        await waitFor(() => {
            fireEvent.submit(form);
            expect(calls).toBe(2);
        });
        await act(async () => { release(); });
    });
});
