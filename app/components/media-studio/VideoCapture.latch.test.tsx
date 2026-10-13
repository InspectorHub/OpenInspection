// @vitest-environment happy-dom
/**
 * VideoCapture same-frame latch: every accepted pick mints an upload (a stored object plus a media-pool row),
 * so two change events dispatched in ONE frame must reach create-upload once. The busy phase only lands
 * after a render, which is too late for the second event.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { VideoCapture } from "~/components/media-studio/VideoCapture";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const file = new File(["x"], "clip.mp4", { type: "video/mp4" });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    // create-upload refuses, so the component returns to the pick phase and the control can pick again.
    fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function mount() {
    const view = render(<VideoCapture inspectionId="insp-1" provider="stream" onClose={() => {}} onUploaded={() => {}} />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    return input;
}
const pick = (input: HTMLInputElement) => input.dispatchEvent(new Event("change", { bubbles: true }));

describe("VideoCapture latch", () => {
    it("starts ONE upload for two same-frame picks", async () => {
        const input = mount();
        act(() => { pick(input); pick(input); });
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("CONTROL - a later pick, after the first attempt failed, starts another", async () => {
        const input = mount();
        act(() => { pick(input); });
        await settle();
        act(() => { pick(input); });
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
