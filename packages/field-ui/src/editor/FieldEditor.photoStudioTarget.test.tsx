// @vitest-environment happy-dom
/**
 * The Photo Studio's toolbar entry at the FieldEditor call-site: the studio must open on, and save onto, the photo
 * entry it was given, addressed by its 0-based position in the item's photos array, even with a clip ahead of it.
 * Only the studio's own canvas is replaced (by a stand-in that records what it was given and hands back a blob).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { m } from "../i18n";
import { appendPhoto } from "../shared/results-doc";
import type { PhotoAnnotateMeta } from "../media-types";
import { mountForRatings } from "./FieldEditor.rating.fixtures";

const seen = vi.hoisted(() => ({ props: null as null | { open: boolean; photoUrl: string | null; photoIndex?: number; totalPhotos?: number } }));

type StudioProps = { open: boolean; photoUrl: string | null; photoIndex?: number; totalPhotos?: number; isCover?: boolean; onSetCover?: () => void; onSave: (d: { blob: Blob; nodesJson: string; caption: string }) => void };

vi.mock("../components/media-studio/PhotoAnnotator", () => ({
  PhotoAnnotator: (props: StudioProps) => {
    seen.props = props;
    return (
      <div data-testid="annotator" data-open={String(props.open)}>
        {props.onSetCover && <button type="button" data-testid="studio-cover" data-cover={String(!!props.isCover)} onClick={props.onSetCover}>cover</button>}
        <button type="button" data-testid="anno-save" onClick={() => props.onSave({ blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), nodesJson: "[]", caption: "" })}>save</button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  seen.props = null;
});

const FK = "_default:s1:i1";
const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function openWith(photos: Parameters<typeof appendPhoto>[2][]) {
  const h = mountForRatings(1280);
  await screen.findByRole("button", { name: m.editor_header_publish() });
  fireEvent.click((await screen.findAllByText("Flashing condition"))[0]!);
  await waitFor(() => expect(() => h.doc()).not.toThrow());
  for (const p of photos) appendPhoto(h.doc(), FK, p);
  await tick();
  fireEvent.click(screen.getByRole("button", { name: m.editor_dock_open() }));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(m.editor_dock_photo_studio()) }));
  await tick();
  return h;
}

describe("Photo Studio toolbar entry", () => {
  it("opens the first photo by its key string (never ?key=[object Object]) at array index 0", async () => {
    await openWith([{ key: "t/i/a.jpg", mediaType: "photo" }, { key: "t/i/b.jpg", mediaType: "photo" }]);
    expect(seen.props?.open).toBe(true);
    expect(seen.props?.photoUrl).toContain("t/i/a.jpg");
    expect(seen.props?.photoUrl).not.toContain("object");
    // The annotator label is 1-based over the item's media: photo 1 of 2.
    expect(seen.props?.photoIndex).toBe(1);
    expect(seen.props?.totalPhotos).toBe(2);
  });

  it("with a clip first, opens the photo after it and saves the annotation onto that photo, not onto the clip's slot", async () => {
    const h = await openWith([{ key: "", mediaType: "video" }, { key: "after-clip.jpg", mediaType: "photo", croppedKey: "after-clip-crop.jpg" }]);
    expect(seen.props?.photoUrl).toContain("after-clip-crop.jpg");
    expect(seen.props?.photoIndex).toBe(2); // 1-based label of array index 1
    await act(async () => { fireEvent.click(screen.getByTestId("anno-save")); });
    await tick(120);
    const rec = h.fake.uploads.at(-1)?.rec;
    expect(rec?.kind).toBe("annotate");
    const meta = rec?.meta as PhotoAnnotateMeta | undefined;
    expect(meta?.photoIndex).toBe(1);
    expect(meta?.sectionId).toBe("s1");
    expect(meta?.photoKey).toBe("after-clip.jpg");
  });

  // The studio's cover button follows the inspection's cover live: it used to keep its old label until a reload,
  // because it compared against the cover the page was loaded with.
  it("the cover button follows the cover as it is set and cleared, without a reload", async () => {
    const h = await openWith([{ key: "t/i/a.jpg", mediaType: "photo" }]);
    expect(screen.getByTestId("studio-cover").getAttribute("data-cover")).toBe("false");
    fireEvent.click(screen.getByTestId("studio-cover"));
    await tick();
    expect(screen.getByTestId("studio-cover").getAttribute("data-cover")).toBe("true");
    expect(h.fake.commands.some((c) => c.cmd.type === "set-cover" && c.cmd.coverPhotoId === "t/i/a.jpg")).toBe(true);
    fireEvent.click(screen.getByTestId("studio-cover"));
    await tick();
    expect(screen.getByTestId("studio-cover").getAttribute("data-cover")).toBe("false");
    expect(h.fake.commands.some((c) => c.cmd.type === "set-cover" && c.cmd.coverPhotoId === "")).toBe(true);
  });

  // Re-annotating the cover photo gives it a new image key. The page's cover follows, so the reopened studio still calls
  // it the cover and the next press clears it (it used to offer "set" again, because the page held the old key).
  it("the cover follows its photo through a re-annotation in the same session", async () => {
    const h = await openWith([{ key: "t/i/a.jpg", mediaType: "photo" }]);
    fireEvent.click(screen.getByTestId("studio-cover"));
    await tick();
    await act(async () => { fireEvent.click(screen.getByTestId("anno-save")); });
    await tick(120);
    fireEvent.click(screen.getByRole("button", { name: m.editor_dock_open() }));
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(m.editor_dock_photo_studio()) }));
    await tick();
    expect(screen.getByTestId("studio-cover").getAttribute("data-cover")).toBe("true");
    const before = h.fake.commands.filter((c) => c.cmd.type === "set-cover").length;
    fireEvent.click(screen.getByTestId("studio-cover"));
    await tick();
    expect(h.fake.commands.filter((c) => c.cmd.type === "set-cover").length).toBe(before + 1);
    expect(h.fake.commands.filter((c) => c.cmd.type === "set-cover").at(-1)?.cmd).toMatchObject({ coverPhotoId: "" });
    expect(screen.getByTestId("studio-cover").getAttribute("data-cover")).toBe("false");
  });
});
