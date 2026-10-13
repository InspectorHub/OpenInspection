// @vitest-environment happy-dom
/**
 * Two logo files chosen in ONE frame reach the upload action once: every upload writes a new
 * random-keyed R2 object, so a repeat before `uploading` renders would orphan the first. A later
 * choice, after the action settles, must go through.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { LogoField } from "./LogoField";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
afterEach(cleanup);

function mount(action: () => unknown) {
    const Stub = createRoutesStub([{ path: "/", Component: () => <LogoField initialUrl={null} />, action: action as never }]);
    return render(<Stub initialEntries={["/"]} />);
}

/** A native change event with a file attached; fireEvent would flush between the two. */
function chooseFile(input: HTMLInputElement) {
    const file = new File(["x"], "logo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("logo upload latch", () => {
    it("uploads ONCE for two same-frame file choices", async () => {
        const action = vi.fn(async () => ({ success: true, intent: "logo-upload", logoUrl: "/l.png" }));
        const { container } = mount(action);
        await settle();
        const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
        act(() => { chooseFile(input); chooseFile(input); });
        await settle();
        expect(action).toHaveBeenCalledTimes(1);
    });

    it("CONTROL - a later file choice goes through after the first settles", async () => {
        const action = vi.fn(async () => ({ success: true, intent: "logo-upload", logoUrl: "/l.png" }));
        const { container } = mount(action);
        await settle();
        const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
        act(() => { chooseFile(input); });
        await settle();
        act(() => { chooseFile(input); });
        await settle();
        expect(action).toHaveBeenCalledTimes(2);
    });
});
