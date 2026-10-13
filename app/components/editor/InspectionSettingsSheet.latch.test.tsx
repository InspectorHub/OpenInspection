// @vitest-environment happy-dom
// Two file picks dispatched in ONE act() upload one cover photo. The pending button only goes
// inert after a render, which is too late for the second event (a duplicate photo in the pool).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { InspectionSettingsSheet } from "./InspectionSettingsSheet";

// The real cropper needs canvas; a stub that just exposes onSave is enough to reach the submit.
vi.mock("~/components/media-studio/CoverCropper", () => ({
  coverCropFor: () => null,
  CoverCropper: ({ onSave }: { onSave: (b: Blob, c: unknown) => void }) => (
    <button type="button" data-testid="crop-save" onClick={() => onSave(new Blob(["x"]), { aspect: "1:1", orientation: "landscape", pixels: { x: 0, y: 0, width: 1, height: 1 } })}>save crop</button>
  ),
}));

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("InspectionSettingsSheet cover upload latch", () => {
  it("uploads ONCE for two same-frame picks, and again after the first upload settles", async () => {
    const action = vi.fn(async () => ({ ok: false, intent: "upload-cover" }));
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <InspectionSettingsSheet open onClose={() => {}} inspectionId="insp-1" />,
        action,
      },
      {
        path: "/resources/inspection-settings-sheet",
        loader: () => ({ inspection: {}, templates: [], members: [], photos: [] }),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    // Raw dispatch: fireEvent wraps each call in its own act(), which would flush between the two.
    const pick = (name: string) => {
      Object.defineProperty(input, "files", { value: [new File(["x"], name, { type: "image/png" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    act(() => { pick("a.png"); pick("b.png"); });
    await settle();
    expect(action).toHaveBeenCalledTimes(1);

    act(() => { pick("c.png"); });
    await settle();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("saves the crop ONCE for two same-frame saves, and again after the first settles", async () => {
    const action = vi.fn(async () => ({ ok: false, intent: "crop-cover" }));
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <InspectionSettingsSheet open onClose={() => {}} inspectionId="insp-1" />,
        action,
      },
      {
        path: "/resources/inspection-settings-sheet",
        loader: () => ({ inspection: {}, templates: [], members: [], photos: [{ key: "k1", url: "/p/k1.jpg", label: "front" }] }),
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    const openCropper = async () => {
      await waitFor(() => expect(document.querySelector('img[alt="front"]')).not.toBeNull());
      act(() => { (document.querySelector('img[alt="front"]')!.closest("button") as HTMLButtonElement).click(); });
      await waitFor(() => expect(document.querySelector('[data-testid="crop-save"]')).not.toBeNull());
      return document.querySelector('[data-testid="crop-save"]') as HTMLButtonElement;
    };
    const save1 = await openCropper();
    act(() => { save1.click(); save1.click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(1);

    const save2 = await openCropper();
    act(() => { save2.click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(2);
  });
});
