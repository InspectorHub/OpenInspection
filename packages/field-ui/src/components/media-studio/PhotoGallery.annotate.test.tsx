// @vitest-environment happy-dom
/**
 * Annotate is offered only where the editor can save it: a photo attached to an item. A defect's photo is addressed
 * by its index inside the defect, and a loose pool photo has no item, so a studio opened on either could not save.
 * The grid and the viewer are replaced by stand-ins (the real ones need layout); what is under test is what the
 * gallery hands them and what it hands back.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { GalleryPhoto } from "../../shared/inspection-media";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { PhotoGallery } from "./PhotoGallery";

const seen = vi.hoisted(() => ({ hide: undefined as readonly string[] | undefined }));

vi.mock("./PhotoGrid", () => ({
  PhotoGrid: ({ items, onClick }: { items: Array<{ key: string }>; onClick: (i: number) => void }) => (
    <div>{items.map((it, i) => <button key={it.key} type="button" data-testid={`tile-${it.key}`} onClick={() => onClick(i)}>tile</button>)}</div>
  ),
}));
vi.mock("./MediaViewer", async (importOriginal) => {
  const real = await importOriginal<typeof import("./MediaViewer")>();
  return {
    ...real,
    MediaViewer: (p: { hideActions?: readonly string[] | ((shown: GalleryPhoto) => readonly string[] | undefined); index: number | null; photos: GalleryPhoto[]; onAction: (a: "annotate", ph: GalleryPhoto) => void }) => {
      const at = p.index;
      const shown = at === null ? undefined : p.photos[at];
      seen.hide = typeof p.hideActions === "function" ? (shown ? p.hideActions(shown) : undefined) : p.hideActions;
      return at === null ? null : <button type="button" data-testid="viewer-annotate" onClick={() => p.onAction("annotate", p.photos[at]!)}>annotate</button>;
    },
  };
});

afterEach(cleanup);

async function open(photo: GalleryPhoto, annotated: GalleryPhoto[], activeUnitId: string | null = null) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { mediaPool: { list: async () => ({ photos: [photo], answered: true }) } } });
  render(<FieldDataSourceProvider dataSource={fake}><PhotoGallery inspectionId="i1" activeUnitId={activeUnitId} onSetCover={() => {}} onAnnotate={(p) => annotated.push(p)} /></FieldDataSourceProvider>);
  fireEvent.click(await screen.findByTestId(`tile-${photo.key}`));
}

describe("PhotoGallery, Annotate availability", () => {
  it("an attached item photo offers Annotate and hands the whole row (item, section, index) to the editor", async () => {
    const row: GalleryPhoto = { key: "k", url: "/u", label: "L", itemId: "i2", sectionId: "s1", photoIndex: 3, originalKey: "k" };
    const got: GalleryPhoto[] = [];
    await open(row, got);
    expect(seen.hide).not.toContain("annotate");
    fireEvent.click(await screen.findByTestId("viewer-annotate"));
    expect(got).toEqual([row]);
  });

  it("a defect photo does not offer Annotate", async () => {
    await open({ key: "d", url: "/u", label: "L", itemId: "i2", sectionId: "s1", photoIndex: 0, defectId: "d1" }, []);
    expect(seen.hide).toContain("annotate");
  });

  it("a loose pool photo does not offer Annotate", async () => {
    await open({ key: "p", url: "/u", label: "Unattached" }, []);
    expect(seen.hide).toContain("annotate");
  });

  // Results are keyed unit:section:item, and the editor's reader follows the open unit, so a row from another unit
  // would be saved onto the open unit's finding (or nowhere). It is not offered.
  it("a photo from the open unit offers Annotate", async () => {
    await open({ key: "u", url: "/u", label: "L", itemId: "i2", sectionId: "s1", unitId: "u1", photoIndex: 0 }, [], "u1");
    expect(seen.hide).not.toContain("annotate");
  });

  it("a photo from another unit does not offer Annotate", async () => {
    await open({ key: "u", url: "/u", label: "L", itemId: "i2", sectionId: "s1", unitId: "u2", photoIndex: 0 }, [], "u1");
    expect(seen.hide).toContain("annotate");
  });

  it("the common scope: a common-scope photo offers Annotate with no unit open, a unit's photo does not", async () => {
    await open({ key: "c", url: "/u", label: "L", itemId: "i2", sectionId: "s1", unitId: "_default", photoIndex: 0 }, [], null);
    expect(seen.hide).not.toContain("annotate");
    cleanup();
    await open({ key: "d", url: "/u", label: "L", itemId: "i2", sectionId: "s1", unitId: "u2", photoIndex: 0 }, [], null);
    expect(seen.hide).toContain("annotate");
  });

  it("a row from an older server with no unit is treated as the common scope", async () => {
    await open({ key: "o", url: "/u", label: "L", itemId: "i2", sectionId: "s1", photoIndex: 0 }, [], null);
    expect(seen.hide).not.toContain("annotate");
  });
});
