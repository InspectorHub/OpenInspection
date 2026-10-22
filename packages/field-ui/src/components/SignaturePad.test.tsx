// @vitest-environment happy-dom
/**
 * Two clicks on the sign button dispatched in one frame must call `onSubmit`
 * once. The latch is released in `finally`, once the submit promise settles, so
 * a failed submit can be retried.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { SignaturePad } from "./SignaturePad";

const ctxStub = {
    lineWidth: 0, lineCap: "", strokeStyle: "",
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, clearRect: () => {},
};

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        () => ctxStub as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function drawInk(container: HTMLElement) {
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(canvas);
}

describe("SignaturePad in-flight latch", () => {
    it("submits once for two same-frame clicks, and again after the promise settles", async () => {
        let resolve: () => void = () => {};
        const onSubmit = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
        const { container } = render(<SignaturePad onSubmit={onSubmit} label="Sign now" />);
        drawInk(container);
        const btn = screen.getByRole("button", { name: "Sign now" });
        act(() => { btn.click(); btn.click(); });
        expect(onSubmit).toHaveBeenCalledTimes(1);

        await act(async () => { resolve(); });
        act(() => { screen.getByRole("button", { name: "Sign now" }).click(); });
        expect(onSubmit).toHaveBeenCalledTimes(2);
    });
});
