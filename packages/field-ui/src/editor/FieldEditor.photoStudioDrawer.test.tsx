// @vitest-environment happy-dom
/**
 * Annotating from the drawer's Photos tab: the studio opens on, and saves onto, the photo that was clicked, in the
 * item that owns it, while a DIFFERENT item is active. The drawer's grid and lightbox are replaced by a list of
 * buttons (they need layout); what is under test is what the editor does with the row handed to `onAnnotate`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { m } from "../i18n";
import { appendPhoto, removePhoto } from "../shared/results-doc";
import type { GalleryPhoto } from "../shared/inspection-media";
import { createFakeMediaPool } from "../testing/fake-panel-resources";
import { createEmptyEditorData } from "../testing/fake-data-source";
import { mountForRatings, RATING_DATA } from "./FieldEditor.rating.fixtures";

// Item i1 (Flashing condition) is active. These rows belong to i2 (Gutter condition), whose array is
// [clip, b1, b2 (cropped + annotated)], and to i1 (a1).
const ROWS = vi.hoisted((): GalleryPhoto[] => [
  { key: "b1.jpg", url: "/t/b1", label: "Gutter", itemId: "i2", sectionId: "s1", photoIndex: 1, originalKey: "b1.jpg" },
  { key: "b2-ann.png", url: "/t/b2", label: "Gutter", itemId: "i2", sectionId: "s1", photoIndex: 2, originalKey: "b2.jpg", annotated: true },
  { key: "a1.jpg", url: "/t/a1", label: "Flashing", itemId: "i1", sectionId: "s1", photoIndex: 1, originalKey: "a1.jpg" },
]);

vi.mock("../components/media-studio/PhotoGallery", () => ({
  PhotoGallery: ({ onAnnotate, onSetCover, liveRow, coverKey }: { onAnnotate: (p: GalleryPhoto) => void; onSetCover: (p: { key: string; url: string }) => void; liveRow?: (p: GalleryPhoto) => GalleryPhoto; coverKey?: string | null }) => (
    <div>{ROWS.map((r) => (
      <span key={r.key}>
        <button type="button" data-testid={`annotate-${r.key}`} data-shown={(liveRow ? liveRow(r) : r).key} onClick={() => onAnnotate(r)}>annotate</button>
        <button type="button" data-testid={`cover-${r.key}`} data-is-cover={String(coverKey === r.key)} onClick={() => onSetCover({ key: r.key, url: r.url })}>cover</button>
      </span>
    ))}</div>
  ),
}));
vi.mock("../components/media-studio/CoverCropper", async (importOriginal) => {
  const real = await importOriginal<typeof import("../components/media-studio/CoverCropper")>();
  return {
    ...real,
    CoverCropper: ({ onSave }: { onSave: (b: Blob, c: { aspect: "3:2"; orientation: "landscape"; pixels: { x: number; y: number; width: number; height: number } }) => void }) => (
      <button type="button" data-testid="cover-save" onClick={() => onSave(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), { aspect: "3:2", orientation: "landscape", pixels: { x: 1, y: 2, width: 30, height: 20 } })}>save cover</button>
    ),
  };
});
vi.mock("../components/media-studio/PhotoAnnotator", () => ({
  PhotoAnnotator: (props: { open: boolean; photoUrl: string | null; sectionName?: string; onSave: (d: { blob: Blob; nodesJson: string; caption: string }) => void }) => (
    <div data-testid="annotator" data-open={String(props.open)} data-url={props.photoUrl ?? ""} data-section={props.sectionName ?? ""}>
      <button type="button" data-testid="anno-save" onClick={() => props.onSave({ blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), nodesJson: "[]", caption: "" })}>save</button>
    </div>
  ),
}));

afterEach(cleanup);

const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mount() {
  const h = mountForRatings(1280, { resources: { mediaPool: createFakeMediaPool() } });
  await screen.findByRole("button", { name: m.editor_header_publish() });
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]!);
  await waitFor(() => expect(() => h.doc()).not.toThrow());
  appendPhoto(h.doc(), "_default:s1:i1", { key: "a0.jpg", mediaType: "photo" });
  appendPhoto(h.doc(), "_default:s1:i1", { key: "a1.jpg", mediaType: "photo" });
  appendPhoto(h.doc(), "_default:s1:i2", { key: "", mediaType: "video" });
  appendPhoto(h.doc(), "_default:s1:i2", { key: "b1.jpg", mediaType: "photo" });
  appendPhoto(h.doc(), "_default:s1:i2", { key: "b2.jpg", mediaType: "photo", croppedKey: "b2-crop.jpg", annotatedKey: "b2-ann.png" });
  await tick();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(m.editor_siderail_tab_photos()) }));
  return h;
}

async function openStudio(key: string) {
  fireEvent.click(await screen.findByTestId(`annotate-${key}`));
  await tick();
  expect(screen.getByTestId("annotator").getAttribute("data-open")).toBe("true");
}
const save = async () => { await act(async () => { fireEvent.click(screen.getByTestId("anno-save")); }); await tick(120); };

describe("drawer Photos tab, Annotate", () => {
  it("a photo after a clip in ANOTHER item is saved onto that item's photo, not onto photo 0 of the active item", async () => {
    const h = await mount();
    await openStudio("b1.jpg");
    await save();
    const rec = h.fake.uploads.at(-1)?.rec;
    expect(rec?.kind).toBe("annotate");
    expect(rec?.meta).toMatchObject({ itemId: "i2", photoIndex: 1, photoKey: "b1.jpg", findingKey: "_default:s1:i2" });
  });

  it("an annotated and cropped photo draws on its crop and saves onto its own entry", async () => {
    const h = await mount();
    await openStudio("b2-ann.png");
    const url = screen.getByTestId("annotator").getAttribute("data-url") ?? "";
    expect(url).toContain("b2-crop.jpg");
    expect(url).not.toContain("b2-ann");
    await save();
    expect(h.fake.uploads.at(-1)?.rec.meta).toMatchObject({ itemId: "i2", photoIndex: 2, photoKey: "b2.jpg" });
  });

  it("the list changes while the studio is open: the save still lands on the photo it was opened on", async () => {
    const h = await mount();
    await openStudio("a1.jpg"); // index 1 of i1
    removePhoto(h.doc(), "_default:s1:i1", "a0.jpg"); // another device deletes the photo before it
    await tick();
    await save();
    expect(h.fake.uploads.at(-1)?.rec.meta).toMatchObject({ itemId: "i1", photoIndex: 0, photoKey: "a1.jpg" });
  });

  it("a row with an empty section id (a legacy bare key) falls back to the open section, never an empty one", async () => {
    const h = await mount();
    ROWS[0]!.sectionId = "";
    try {
      await openStudio("b1.jpg");
      await save();
    } finally {
      ROWS[0]!.sectionId = "s1";
    }
    expect(h.fake.uploads.at(-1)?.rec.meta).toMatchObject({ itemId: "i2", sectionId: "s1", findingKey: "_default:s1:i2", photoKey: "b1.jpg" });
  });

  // The drawer's list comes from the server, which can be behind the editor (the results are written late under collab).
  // After a save its row must show the file the editor now has, as the strip does.
  it("after an annotation is saved, the drawer row shows the new image, not the old one", async () => {
    const h = await mount();
    expect(screen.getByTestId("annotate-b1.jpg").getAttribute("data-shown")).toBe("b1.jpg");
    await openStudio("b1.jpg");
    await save();
    const baked = `uploaded/${h.fake.uploads.at(-1)!.rec.pendingId}`;
    await waitFor(() => expect(screen.getByTestId("annotate-b1.jpg").getAttribute("data-shown")).toBe(baked));
  });

  it("a photo of the active item still lands on its own index", async () => {
    const h = await mount();
    await openStudio("a1.jpg");
    await save();
    expect(h.fake.uploads.at(-1)?.rec.meta).toMatchObject({ itemId: "i1", photoIndex: 1, photoKey: "a1.jpg" });
  });
});

describe("drawer Photos tab, a photo in ANOTHER section", () => {
  it("the studio names that photo's section, not the open one, and saves onto its finding", async () => {
    const data = createEmptyEditorData({
      ...RATING_DATA,
      schema: { sections: [
        { id: "s1", title: "Roofing", items: [{ id: "i1", label: "Flashing condition", type: "rich" }] },
        { id: "s2", title: "Plumbing", items: [{ id: "i2", label: "Gutter condition", type: "rich" }] },
      ] },
    });
    ROWS.length = 0;
    ROWS.push({ key: "p1.jpg", url: "/t/p1", label: "Gutter", itemId: "i2", sectionId: "s2", photoIndex: 0, originalKey: "p1.jpg" });
    const h = mountForRatings(1280, { data, resources: { mediaPool: createFakeMediaPool() } });
    await screen.findByRole("button", { name: m.editor_header_publish() });
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]!);
    await waitFor(() => expect(() => h.doc()).not.toThrow());
    appendPhoto(h.doc(), "_default:s2:i2", { key: "p1.jpg", mediaType: "photo" });
    await tick();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(m.editor_siderail_tab_photos()) }));
    await openStudio("p1.jpg");
    expect(screen.getByTestId("annotator").getAttribute("data-section")).toBe("Plumbing");
    await save();
    expect(h.fake.uploads.at(-1)?.rec.meta).toMatchObject({ itemId: "i2", sectionId: "s2", findingKey: "_default:s2:i2", photoKey: "p1.jpg" });
  });
});

// Setting a cover through the cover cropper (the viewer's "Set cover", then "Save cover") moves the cover to ANOTHER photo.
// The page held the cover it was loaded with, so the new cover still said "Set cover" and the old one "Adjust cover"
// until a reload.
describe("the cover moves to another photo through the cover cropper", () => {
  it("the new cover reads as the cover and the old one stops, without a reload", async () => {
    ROWS.length = 0;
    ROWS.push(
      { key: "b1.jpg", url: "/t/b1", label: "Gutter", itemId: "i2", sectionId: "s1", photoIndex: 1, originalKey: "b1.jpg" },
      { key: "a1.jpg", url: "/t/a1", label: "Flashing", itemId: "i1", sectionId: "s1", photoIndex: 1, originalKey: "a1.jpg" },
    );
    const h = await mount();
    const isCover = (key: string) => screen.getByTestId(`cover-${key}`).getAttribute("data-is-cover");
    for (const key of ["b1.jpg", "a1.jpg"]) {
      fireEvent.click(screen.getByTestId(`cover-${key}`));
      fireEvent.click(await screen.findByTestId("cover-save"));
      await tick(80);
    }
    expect(isCover("a1.jpg")).toBe("true");
    expect(isCover("b1.jpg")).toBe("false");
    expect(h.fake.commands.filter((c) => c.cmd.type === "crop-cover").map((c) => (c.cmd.type === "crop-cover" ? c.cmd.sourceKey : ""))).toEqual(["b1.jpg", "a1.jpg"]);
  });
});
