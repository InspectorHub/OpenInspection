// @vitest-environment happy-dom
/**
 * Credential writes on the Profile page: two triggers dispatched in ONE frame reach the action once.
 * The fetcher's pending state only renders afterwards, so a double click on Add used to create two
 * blank rows and a double click on Remove wrote two audit entries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import SettingsProfilePage from "./settings-profile";
import { m } from "~/paraglide/messages";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
afterEach(() => { cleanup(); });

function mount(action: (a: { request: Request }) => unknown) {
    const Stub = createRoutesStub([{
        path: "/",
        Component: SettingsProfilePage as never,
        loader: () => ({
            profile: {},
            credentials: [{ id: "c1", label: "ASHI", memberNumber: null, imageUrl: null, sortOrder: 0 }],
            notifications: { alwaysSent: [], youChoose: [], error: null, smsConsent: null },
        }),
        action: action as never,
    }]);
    return render(<Stub initialEntries={["/"]} />);
}

const intentOf = async (req: Request) => (await req.formData()).get("intent");

describe("credential write latch", () => {
    it("adds ONE credential for two same-frame clicks", async () => {
        const action = vi.fn(async ({ request }: { request: Request }) => ({ success: true, error: null, intent: await intentOf(request) }));
        mount(action);
        await settle();
        const add = screen.getByRole("button", { name: m.settings_profile_credentials_add() });
        act(() => { add.click(); add.click(); });
        await settle();
        expect(action).toHaveBeenCalledTimes(1);
    });

    it("deletes ONCE for two same-frame clicks on Remove", async () => {
        const action = vi.fn(async ({ request }: { request: Request }) => ({ success: true, error: null, intent: await intentOf(request) }));
        mount(action);
        await settle();
        const remove = screen.getByRole("button", { name: m.settings_profile_credentials_remove() });
        act(() => { remove.click(); remove.click(); });
        await settle();
        expect(action).toHaveBeenCalledTimes(1);
    });

    it("CONTROL - a later click goes through after the first settles", async () => {
        const action = vi.fn(async ({ request }: { request: Request }) => ({ success: true, error: null, intent: await intentOf(request) }));
        mount(action);
        await settle();
        const add = screen.getByRole("button", { name: m.settings_profile_credentials_add() });
        act(() => { add.click(); });
        await settle();
        act(() => { add.click(); });
        await settle();
        expect(action).toHaveBeenCalledTimes(2);
    });
});
