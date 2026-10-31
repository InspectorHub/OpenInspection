// @vitest-environment happy-dom
/**
 * The lightbox crop dialog and the Photo Studio annotator close only when the save tells them they may: a refused
 * image leaves the dialog open with the person's work in it. The save itself is replaced by a stand-in that answers
 * when the test says so; how the real one decides is in `usePhotoOps.checked.test.tsx`.
 */
import { useEffect, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { m } from "../i18n";
import { mount } from "./FieldEditor.capabilities.fixtures";

const ctl = vi.hoisted(() => ({
  force: false,
  hasAnnotation: false,
  cropClosed: false,
  forced: null as null | Record<string, unknown>,
  oversize: false,
  answers: [] as Array<(mayClose: boolean) => void>,
  crops: 0,
  annotations: 0,
}));

vi.mock("../hooks/usePhotoOps", async (importOriginal) => {
  const real = await importOriginal<typeof import("../hooks/usePhotoOps")>();
  return {
    ...real,
    usePhotoOps: (args: Parameters<typeof real.usePhotoOps>[0]) => {
      const ops = real.usePhotoOps(args);
      const [, bump] = useState(0);
      useEffect(() => {
        if (!ctl.force) return;
        args.setPhotoStudioIndex(0);
        args.setPhotoStudioOpen(true);
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      if (!ctl.force) return ops;
      return {
        ...ops,
        setPhotoCropTarget: (v: Parameters<typeof ops.setPhotoCropTarget>[0]) => {
          const next = typeof v === "function" ? (v as (cur: unknown) => unknown)(ctl.cropClosed ? null : ctl.forced) : v;
          if (next === null) ctl.cropClosed = true;
          ops.setPhotoCropTarget(next as never);
          bump((n) => n + 1);
        },
        photoCropTarget: ctl.cropClosed ? null : (ctl.forced = ctl.forced ?? { itemId: "i1", photoIndex: 0, sourceUrl: "https://example.test/p.jpg", hasAnnotation: ctl.hasAnnotation }),
        performPhotoCropSave: (_t: unknown, _b: Blob, _c: unknown, cb?: (ok: boolean) => void) => { ctl.crops += 1; if (cb) ctl.answers.push(cb); },
        performPhotoAnnotationSave: (_t: unknown, _b: Blob, _n: string, cb?: (ok: boolean) => void) => { ctl.annotations += 1; if (cb) ctl.answers.push(cb); return true; },
      };
    },
  };
});
vi.mock("../components/media-studio/PhotoCropper", () => ({
  PhotoCropper: ({ onSave }: { onSave: (b: Blob, c: unknown) => void }) => (
    <button type="button" data-testid="cropper" onClick={() => onSave(ctl.oversize ? new Blob([new Uint8Array(30 * 1024 * 1024)]) : new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]), { aspect: "1:1", orientation: "landscape", pixels: { x: 0, y: 0, width: 1, height: 1 } })}>save crop</button>
  ),
}));
vi.mock("../components/media-studio/PhotoAnnotator", () => ({
  PhotoAnnotator: ({ open, onSave }: { open: boolean; onSave: (d: { blob: Blob; nodesJson: string; caption: string }) => void }) => (
    <button type="button" data-testid="annotator" data-open={String(open)} onClick={() => onSave({ blob: new Blob(["x"]), nodesJson: "[]", caption: "" })}>save strokes</button>
  ),
}));
vi.mock("../components/editor/RecropWarningModal", () => ({
  RecropWarningModal: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => (open ? <button type="button" data-testid="recrop-confirm" onClick={onConfirm}>confirm</button> : null),
}));

afterEach(() => {
  cleanup();
  ctl.force = false;
  ctl.hasAnnotation = false;
  ctl.oversize = false;
  ctl.cropClosed = false;
  ctl.forced = null;
  ctl.answers = [];
  ctl.crops = 0;
  ctl.annotations = 0;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const ready = () => screen.findByRole("button", { name: m.editor_header_publish() });
const cropper = () => screen.queryByTestId("cropper");
const annotatorOpen = () => screen.getByTestId("annotator").getAttribute("data-open");

describe("lightbox crop dialog", () => {
  it("stays open while the save is being checked and after a refusal, and closes when the image is admitted", async () => {
    ctl.force = true;
    mount(null, false);
    await ready();
    fireEvent.click(cropper()!);
    expect(ctl.crops).toBe(1);
    expect(cropper()).not.toBeNull();
    await act(async () => { ctl.answers.shift()!(false); });
    expect(cropper()).not.toBeNull();
    // A second Save after the refusal reaches the save again, and an admitted image closes the dialog.
    fireEvent.click(cropper()!);
    expect(ctl.crops).toBe(2);
    await act(async () => { ctl.answers.shift()!(true); });
    expect(cropper()).toBeNull();
  });

  it("with an annotation to discard: the image is checked first, the warning is asked, then the save runs", async () => {
    ctl.force = true;
    ctl.hasAnnotation = true;
    mount(null, false);
    await ready();
    fireEvent.click(cropper()!);
    fireEvent.click(await screen.findByTestId("recrop-confirm"));
    expect(ctl.crops).toBe(1);
  });

  it("with an annotation to discard: a refused image keeps the dialog open and asks nothing", async () => {
    ctl.force = true;
    ctl.hasAnnotation = true;
    ctl.oversize = true;
    mount(null, false);
    await ready();
    fireEvent.click(cropper()!);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(cropper()).not.toBeNull();
    expect(screen.queryByTestId("recrop-confirm")).toBeNull();
    expect(ctl.crops).toBe(0);
  });
});

describe("Photo Studio annotator", () => {
  it("stays open after a refusal and closes when the image is admitted", async () => {
    ctl.force = true;
    mount(null, false);
    await ready();
    // Select the item so the annotator has one to save to.
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]!);
    expect(annotatorOpen()).toBe("true");
    fireEvent.click(screen.getByTestId("annotator"));
    expect(ctl.annotations).toBe(1);
    expect(annotatorOpen()).toBe("true");
    await act(async () => { ctl.answers.shift()!(false); });
    expect(annotatorOpen()).toBe("true");
    fireEvent.click(screen.getByTestId("annotator"));
    expect(ctl.annotations).toBe(2);
    await act(async () => { ctl.answers.shift()!(true); });
    expect(annotatorOpen()).toBe("false");
  });
});
