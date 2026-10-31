// @vitest-environment happy-dom
/**
 * The lightbox crop dialog and the Photo Studio, with the REAL photo saves behind them (only the dialogs' own
 * canvases are replaced by buttons that hand back a blob). What a refused image, a cancel, a second press, a throwing
 * check and a reopened dialog do to the dialog and to what is written.
 */
import { useEffect, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { m } from "../i18n";
import { MAX_PHOTO_BYTES } from "../shared/photo-limits";
import { appendPhoto } from "../shared/results-doc";
import { mountForRatings } from "./FieldEditor.rating.fixtures";

const ctl = vi.hoisted(() => ({
  crop: null as null | { open: boolean; target: Record<string, unknown> },
  studio: false,
  blob: "good" as "good" | "huge" | "broken" | "slow",
  fallback: false,
}));

vi.mock("../hooks/usePhotoOps", async (importOriginal) => {
  const real = await importOriginal<typeof import("../hooks/usePhotoOps")>();
  return {
    ...real,
    usePhotoOps: (args: Parameters<typeof real.usePhotoOps>[0]) => {
      const ops = real.usePhotoOps(args);
      const [, bump] = useState(0);
      useEffect(() => {
        if (!ctl.studio) return;
        args.setPhotoStudioIndex(0);
        args.setPhotoStudioOpen(true);
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      if (!ctl.crop) return ctl.fallback ? { ...ops, performPhotoAnnotationSave: () => false } : ops;
      const state = ctl.crop;
      return {
        ...ops,
        photoCropTarget: (state.open ? state.target : null) as typeof ops.photoCropTarget,
        // The forced dialog follows the setter the editor uses, including the functional form.
        setPhotoCropTarget: (v: Parameters<typeof ops.setPhotoCropTarget>[0]) => {
          const next = typeof v === "function" ? (v as (cur: unknown) => unknown)(state.open ? state.target : null) : v;
          if (next === null) state.open = false;
          else { state.target = next as Record<string, unknown>; state.open = true; }
          bump((n) => n + 1);
        },
        performPhotoAnnotationSave: ctl.fallback ? () => false : ops.performPhotoAnnotationSave,
      };
    },
  };
});
const blobFor = () => {
  if (ctl.blob === "huge") return new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1).fill(1)]);
  // An admissible image whose bytes take a while to read: the check is still out when the second press arrives.
  if (ctl.blob === "slow") return { size: 4, type: "image/jpeg", slice() { return { arrayBuffer: () => new Promise((r) => setTimeout(() => r(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer), 40)) }; } } as unknown as Blob;
  if (ctl.blob === "broken") return { size: 4, type: "image/jpeg", arrayBuffer: () => Promise.reject(new Error("unreadable")), slice() { return this; } } as unknown as Blob;
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
};
vi.mock("../components/media-studio/PhotoCropper", () => ({
  PhotoCropper: ({ onSave, onCancel }: { onSave: (b: Blob, c: unknown) => void; onCancel: () => void }) => (
    <div data-testid="cropper">
      <button type="button" data-testid="crop-save" onClick={() => onSave(blobFor(), { aspect: "1:1", orientation: "landscape", pixels: { x: 0, y: 0, width: 1, height: 1 } })}>save</button>
      <button type="button" data-testid="crop-cancel" onClick={onCancel}>cancel</button>
    </div>
  ),
}));
vi.mock("../components/media-studio/PhotoAnnotator", () => ({
  PhotoAnnotator: ({ open, onSave }: { open: boolean; onSave: (d: { blob: Blob; nodesJson: string; caption: string }) => void }) => (
    <div data-testid="annotator" data-open={String(open)}>
      <button type="button" data-testid="anno-save" onClick={() => onSave({ blob: blobFor(), nodesJson: "[]", caption: "" })}>save</button>
    </div>
  ),
}));
vi.mock("../components/editor/RecropWarningModal", () => ({
  RecropWarningModal: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => (open ? <button type="button" data-testid="recrop-confirm" onClick={onConfirm}>confirm</button> : null),
}));

afterEach(() => {
  cleanup();
  ctl.crop = null; ctl.studio = false; ctl.blob = "good"; ctl.fallback = false;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const FK = "_default:s1:i1";
const target = (over: Record<string, unknown> = {}) => ({ itemId: "i1", photoIndex: 0, sectionId: "s1", sourceUrl: "https://example.test/p.jpg", hasAnnotation: false, ...over });
const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = (id: string) => act(async () => { fireEvent.click(screen.getByTestId(id)); });
type Harness = ReturnType<typeof mountForRatings>;
const uploads = (h: Harness) => h.fake.uploads.length;
const sentences = (h: Harness) => h.fake.notifications.map((n) => n.message);

async function open(opts: { crop?: Record<string, unknown>; studio?: boolean; fallback?: boolean } = {}) {
  if (opts.crop) ctl.crop = { open: true, target: target(opts.crop) };
  ctl.studio = !!opts.studio;
  ctl.fallback = !!opts.fallback;
  const h = mountForRatings(1280);
  await screen.findByRole("button", { name: m.editor_header_publish() });
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]!);
  await waitFor(() => expect(() => h.doc()).not.toThrow());
  appendPhoto(h.doc(), FK, { key: "base.jpg", mediaType: "photo" });
  await tick();
  return h;
}

describe("lightbox crop dialog (real save)", () => {
  it("a double click on Save sends one save and no save-busy notice; the dialog closes once", async () => {
    ctl.blob = "slow";
    const h = await open({ crop: {} });
    await act(async () => { fireEvent.click(screen.getByTestId("crop-save")); await new Promise((r) => setTimeout(r, 0)); fireEvent.click(screen.getByTestId("crop-save")); });
    await tick(120);
    expect(uploads(h)).toBe(1);
    expect(sentences(h)).not.toContain(m.editor_photo_save_busy());
    expect(screen.queryByTestId("cropper")).toBeNull();
  });

  it("a refused image keeps the dialog open, says why, and a later admissible Save works", async () => {
    ctl.blob = "huge";
    const h = await open({ crop: {} });
    await click("crop-save");
    await tick();
    expect(screen.queryByTestId("cropper")).not.toBeNull();
    expect(sentences(h)).toEqual([m.editor_photo_save_too_large()]);
    ctl.blob = "good";
    await click("crop-save");
    await tick();
    expect(uploads(h)).toBe(1);
    expect(screen.queryByTestId("cropper")).toBeNull();
  });

  it("Cancel while the image is being checked (annotation to discard): no warning, no save", async () => {
    const h = await open({ crop: { hasAnnotation: true } });
    await act(async () => { fireEvent.click(screen.getByTestId("crop-save")); fireEvent.click(screen.getByTestId("crop-cancel")); });
    await tick();
    expect(screen.queryByTestId("recrop-confirm")).toBeNull();
    expect(uploads(h)).toBe(0);
    expect(screen.queryByTestId("cropper")).toBeNull();
  });

  it("Cancel while the image is being checked (no annotation): nothing is saved", async () => {
    const h = await open({ crop: {} });
    await act(async () => { fireEvent.click(screen.getByTestId("crop-save")); fireEvent.click(screen.getByTestId("crop-cancel")); });
    await tick();
    expect(uploads(h)).toBe(0);
    expect(h.fake.notifications).toEqual([]);
  });

  it("a check that throws says the save failed and the dialog stays usable", async () => {
    ctl.blob = "broken";
    const h = await open({ crop: { hasAnnotation: true } });
    await click("crop-save");
    await tick();
    expect(sentences(h)).toEqual([m.editor_photo_save_failed()]);
    expect(screen.queryByTestId("cropper")).not.toBeNull();
    ctl.blob = "good";
    await click("crop-save");
    expect(await screen.findByTestId("recrop-confirm")).toBeTruthy();
  });

  it("an answer that arrives after the dialog was cancelled and another photo's crop opened does not close the new one", async () => {
    const h = await open({ crop: {} });
    await act(async () => {
      fireEvent.click(screen.getByTestId("crop-save"));
      fireEvent.click(screen.getByTestId("crop-cancel"));
      ctl.crop!.target = target({ photoIndex: 1 });
      ctl.crop!.open = true;
    });
    await tick();
    expect(uploads(h)).toBe(0);
    expect(ctl.crop!.open).toBe(true);
  });
});

describe("Photo Studio (real save)", () => {
  it("a refused image keeps the studio open; a double click on Save then sends one save and no save-busy notice", async () => {
    ctl.blob = "huge";
    const h = await open({ studio: true });
    await click("anno-save");
    await tick();
    expect(screen.getByTestId("annotator").getAttribute("data-open")).toBe("true");
    expect(sentences(h)).toEqual([m.editor_photo_save_too_large()]);
    ctl.blob = "slow";
    await act(async () => { fireEvent.click(screen.getByTestId("anno-save")); await new Promise((r) => setTimeout(r, 0)); fireEvent.click(screen.getByTestId("anno-save")); });
    await tick(120);
    expect(uploads(h)).toBe(1);
    expect(sentences(h)).not.toContain(m.editor_photo_save_busy());
    expect(screen.getByTestId("annotator").getAttribute("data-open")).toBe("false");
  });

  it("before the results document is live, a refused annotation keeps the studio open and an admissible one closes it", async () => {
    ctl.blob = "huge";
    const h = await open({ studio: true, fallback: true });
    await click("anno-save");
    await tick();
    expect(screen.getByTestId("annotator").getAttribute("data-open")).toBe("true");
    expect(sentences(h)).toEqual([m.editor_photo_save_too_large()]);
    ctl.blob = "good";
    await click("anno-save");
    await tick();
    expect(screen.getByTestId("annotator").getAttribute("data-open")).toBe("false");
    // It really went by the relay, not the document: nothing was uploaded through the results-document path.
    expect(uploads(h)).toBe(0);
    expect(h.fake.commands.some((c) => c.cmd.type === "annotate")).toBe(true);
  });
});
