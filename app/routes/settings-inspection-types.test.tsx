// @vitest-environment happy-dom
/**
 * The Save button's synchronous latch: two clicks dispatched in one frame must
 * send one request, because `saving` has not rendered when the second arrives.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import SettingsInspectionTypes from "~/routes/settings-inspection-types";

function renderPage() {
    const Stub = createRoutesStub([
        {
            path: "/settings/inspection-types",
            Component: SettingsInspectionTypes,
            loader: () => ({ forbidden: false, orgTypes: [] }),
        },
    ]);
    return render(<Stub initialEntries={["/settings/inspection-types"]} />);
}

describe("settings → inspection types: save latch", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("sends one request for two same-frame Save clicks, and releases after a failure", async () => {
        let resolveFirst: (v: { ok: boolean }) => void = () => {};
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValue({ ok: false });
        vi.stubGlobal("fetch", fetchMock);

        renderPage();
        fireEvent.click(await screen.findByRole("button", { name: /add/i }));
        const name = (await screen.findAllByRole("textbox"))[0]!;
        fireEvent.change(name, { target: { value: "Pool" } });
        const save = await screen.findByRole("button", { name: /^save$/i });

        act(() => { save.click(); save.click(); });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Failure path: the modal stays open and the latch must be released so the user can retry.
        await act(async () => { resolveFirst({ ok: false }); });
        const retry = await screen.findByRole("button", { name: /^save$/i });
        act(() => { retry.click(); });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });
});
