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

function mount(action: (a: { request: Request }) => unknown, extraRows = false) {
    const Stub = createRoutesStub([{
        path: "/",
        Component: SettingsProfilePage as never,
        loader: () => ({
            profile: {},
            credentials: [
                { id: "c1", label: "ASHI", memberNumber: null, imageUrl: null, sortOrder: 0 },
                ...(extraRows ? [{ id: "c2", label: "InterNACHI", memberNumber: null, imageUrl: null, sortOrder: 1 }] : []),
            ],
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

/** A native change event with a file attached; fireEvent would flush between the two. */
function chooseFile(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("credential badge upload latch", () => {
    const badge = () => new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "badge.svg", { type: "image/svg+xml" });
    const imageActionOf = () => vi.fn(async ({ request }: { request: Request }) => ({ success: true, error: null, intent: await intentOf(request) }));
    const imageCalls = (action: ReturnType<typeof imageActionOf>) =>
        action.mock.calls.filter((c) => (c[0] as { request: Request }).request.headers.get("content-type")?.includes("multipart/form-data")).length;

    // Two DIFFERENT rows: the row's own `uploading` prop only blocks a repeat on the same row, so
    // this is the case only the page-level latch can stop (one image fetcher serves every row).
    it("uploads ONCE for two same-frame file choices on different rows", async () => {
        const action = imageActionOf();
        const { container } = mount(action, true);
        await settle();
        const inputs = container.querySelectorAll<HTMLInputElement>("#credentials input[type=file]");
        expect(inputs.length).toBe(2);
        act(() => { chooseFile(inputs[0], badge()); chooseFile(inputs[1], badge()); });
        await settle();
        expect(imageCalls(action)).toBe(1);
    });

    it("CONTROL - a later file choice goes through after the first settles", async () => {
        const action = imageActionOf();
        const { container } = mount(action);
        await settle();
        const input = container.querySelector<HTMLInputElement>("#credentials input[type=file]")!;
        act(() => { chooseFile(input, badge()); });
        await settle();
        act(() => { chooseFile(input, badge()); });
        await settle();
        expect(imageCalls(action)).toBe(2);
    });
});

