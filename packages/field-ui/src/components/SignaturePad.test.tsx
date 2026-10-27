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
    beginPath: () => {}, moveTo: vi.fn(), lineTo: vi.fn(), stroke: () => {}, clearRect: () => {},
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

describe("SignaturePad on a screen narrower than its bitmap", () => {
    it("is as wide as its card up to its own 400px, and keeps the 400x150 bitmap", () => {
        const { container } = render(<SignaturePad onSubmit={vi.fn()} />);
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.className.split(/\s+/)).toEqual(expect.arrayContaining(["block", "w-full", "max-w-[400px]", "touch-none"]));
        expect([canvas.width, canvas.height]).toEqual([400, 150]);
    });

    it("puts ink under the finger when the canvas is drawn smaller than its bitmap", () => {
        const { container } = render(<SignaturePad onSubmit={vi.fn()} />);
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;
        vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 200, height: 75, right: 210, bottom: 95, x: 10, y: 20, toJSON: () => ({}) });
        fireEvent.mouseDown(canvas, { clientX: 110, clientY: 57.5 });
        fireEvent.mouseMove(canvas, { clientX: 210, clientY: 95 });
        expect(ctxStub.moveTo).toHaveBeenLastCalledWith(200, 75);
        expect(ctxStub.lineTo).toHaveBeenLastCalledWith(400, 150);
    });

    it("CONTROL - at its natural size the coordinates are unchanged", () => {
        const { container } = render(<SignaturePad onSubmit={vi.fn()} />);
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;
        vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 150, right: 400, bottom: 150, x: 0, y: 0, toJSON: () => ({}) });
        fireEvent.mouseDown(canvas, { clientX: 30, clientY: 40 });
        expect(ctxStub.moveTo).toHaveBeenLastCalledWith(30, 40);
    });
});

describe("SignaturePad paper", () => {
    it("is white paper in every theme, because the ink is dark", () => {
        const { container } = render(<SignaturePad onSubmit={vi.fn()} />);
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.style.backgroundColor).toBe("#ffffff");
        expect(canvas.className).not.toContain("bg-ih-bg-card");
        expect(ctxStub.strokeStyle).toBe("#0f172a");
    });

    it("CONTROL - the exported image is still the bitmap alone: a PNG, with no paper painted into it", async () => {
        const onSubmit = vi.fn();
        const { container } = render(<SignaturePad onSubmit={onSubmit} label="Sign now" />);
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;
        const fill = vi.fn();
        (ctxStub as unknown as { fillRect: () => void }).fillRect = fill;
        drawInk(container);
        await act(async () => { screen.getByRole("button", { name: "Sign now" }).click(); });
        expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith("image/png");
        expect(onSubmit).toHaveBeenCalledWith("data:image/png;base64,AAAA");
        expect(fill).not.toHaveBeenCalled();
        expect([canvas.width, canvas.height]).toEqual([400, 150]);
    });
});
