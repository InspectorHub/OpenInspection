// @vitest-environment happy-dom
/**
 * Two Save clicks dispatched in one frame must bake and save once. `busy` has
 * not rendered when the second click arrives; the guard is a ref that the
 * handler releases in `finally`.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

const bakeCrop = vi.hoisted(() => vi.fn());

vi.mock("./cropImage", async () => {
    const actual = await vi.importActual<typeof import("./cropImage")>("./cropImage");
    return { ...actual, bakeCrop };
});

// The real cropper needs layout; all the component needs from it is the crop rect.
vi.mock("react-easy-crop", async () => {
    const { useEffect, createElement } = await import("react");
    return {
        default: ({ onCropComplete }: { onCropComplete: (a: unknown, p: unknown) => void }) => {
            useEffect(() => { onCropComplete({}, { x: 0, y: 0, width: 10, height: 10 }); }, [onCropComplete]);
            return createElement("div");
        },
    };
});

import { PhotoCropper } from "./PhotoCropper";

let resolveBake: (b: Blob) => void = () => {};
beforeEach(() => {
    bakeCrop.mockReset();
    bakeCrop.mockImplementation(() => new Promise<Blob>((resolve) => { resolveBake = resolve; }));
});
afterEach(cleanup);

function saveButton(): HTMLButtonElement {
    const b = screen.getByRole("button", { name: /^save/i });
    if (!(b instanceof HTMLButtonElement)) throw new Error("save button missing");
    return b;
}

describe("PhotoCropper in-flight latch", () => {
    it("bakes once when two Save clicks land in one frame", async () => {
        const onSave = vi.fn();
        render(<PhotoCropper sourceUrl="/x.jpg" onCancel={() => {}} onSave={onSave} />);
        const b = saveButton();
        act(() => { b.click(); b.click(); });
        expect(bakeCrop).toHaveBeenCalledTimes(1);
        await act(async () => { resolveBake(new Blob(["x"])); });
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("releases after the bake settles so a failed save can be retried", async () => {
        render(<PhotoCropper sourceUrl="/x.jpg" onCancel={() => {}} onSave={() => {}} />);
        act(() => { saveButton().click(); });
        expect(bakeCrop).toHaveBeenCalledTimes(1);
        await act(async () => { resolveBake(new Blob(["x"])); });
        act(() => { saveButton().click(); });
        expect(bakeCrop).toHaveBeenCalledTimes(2);
    });
});
