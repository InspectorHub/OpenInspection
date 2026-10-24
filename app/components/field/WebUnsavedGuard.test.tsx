// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Link, createRoutesStub } from "react-router";
import { m } from "@core/field-ui/i18n";
import { WebUnsavedGuard } from "./WebUnsavedGuard";

function mount(atRisk: boolean) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <>
                    <WebUnsavedGuard atRisk={atRisk} />
                    <Link to="/other">go</Link>
                </>
            ),
        },
        { path: "/other", Component: () => <p>other page</p> },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("WebUnsavedGuard", () => {
    it("blocks a navigation while something is at risk, offers stay or leave, and leaving goes on", async () => {
        mount(true);
        act(() => screen.getByText("go").click());
        await screen.findByText(m.editor_unsavedchanges_title());
        expect(screen.queryByText("other page")).toBeNull();
        act(() => screen.getByRole("button", { name: m.editor_unsavedchanges_leave() }).click());
        await screen.findByText("other page");
    });

    it("staying keeps the page and closes the dialog", async () => {
        mount(true);
        act(() => screen.getByText("go").click());
        await screen.findByText(m.editor_unsavedchanges_title());
        act(() => screen.getByRole("button", { name: m.editor_unsavedchanges_stay() }).click());
        await waitFor(() => expect(screen.queryByText(m.editor_unsavedchanges_title())).toBeNull());
        expect(screen.queryByText("other page")).toBeNull();
        expect(screen.getByText("go")).toBeTruthy();
    });

    it("CONTROL - with nothing at risk the navigation just happens and no dialog appears", async () => {
        mount(false);
        act(() => screen.getByText("go").click());
        await screen.findByText("other page");
        expect(screen.queryByText(m.editor_unsavedchanges_title())).toBeNull();
    });
});
