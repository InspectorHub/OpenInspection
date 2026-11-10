// @vitest-environment happy-dom
/**
 * The viewer's toolbar belongs to the slide ON SCREEN, not to the photo the viewer was opened on. It used to read the
 * `index` prop, which never follows the lightbox's own Next/Prev (or a swipe or an arrow key), so Annotate, Crop, Cover,
 * Revert and even Delete acted on the first photo while another was shown. The lightbox is replaced by a stand-in that
 * emits slide changes the way the real one does; what is under test is what the viewer does with them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { m } from "../../i18n";
import type { GalleryPhoto } from "../../shared/inspection-media";
import { MediaViewer, type MediaAction } from "./MediaViewer";

vi.mock("./PhotoLightbox", () => ({
  PhotoLightbox: ({ index, open, toolbarButtons, onView }: { index: number; open: boolean; toolbarButtons?: React.ReactNode[]; onView?: (i: number) => void }) => (
    open ? (
      <div data-testid="lightbox" data-index={index}>
        {toolbarButtons}
        <button type="button" data-testid="next" onClick={() => onView?.(index + 1)}>next</button>
        <button type="button" data-testid="prev" onClick={() => onView?.(index - 1)}>prev</button>
      </div>
    ) : null
  ),
}));

afterEach(cleanup);

const photo = (key: string, over: Partial<GalleryPhoto> = {}): GalleryPhoto => ({ key, url: `/p/${key}`, label: key, itemId: "i1", photoIndex: 0, originalKey: key, annotated: true, ...over });
const K0 = photo("k0"), K1 = photo("k1"), K2 = photo("k2");

function open(photos: GalleryPhoto[], index: number, coverKey: string | null = null) {
  const onAction = vi.fn<(a: MediaAction, p: GalleryPhoto) => void>();
  const onClose = vi.fn();
  const view = render(<MediaViewer photos={photos} index={index} onClose={onClose} onAction={onAction} coverKey={coverKey} />);
  const again = (next: { photos?: GalleryPhoto[]; index?: number }) =>
    view.rerender(<MediaViewer photos={next.photos ?? photos} index={next.index ?? index} onClose={onClose} onAction={onAction} coverKey={coverKey} />);
  return { onAction, onClose, again };
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const go = (id: "next" | "prev") => fireEvent.click(screen.getByTestId(id));

const ACTIONS: Array<[MediaAction, () => string]> = [
  ["crop", () => m.media_viewer_crop()],
  ["annotate", () => m.media_viewer_annotate()],
  ["rotate", () => m.media_viewer_rotate()],
  ["caption", () => m.media_viewer_caption()],
  ["revert", () => m.media_viewer_revert()],
  ["delete", () => m.common_delete()],
];

describe("the toolbar follows the slide on screen", () => {
  it("the cover label follows Next and Prev", () => {
    open([K0, K1, K2], 0, "k0");
    expect(screen.queryByRole("button", { name: m.media_viewer_cover_adjust() })).not.toBeNull();
    go("next");
    expect(screen.queryByRole("button", { name: m.media_viewer_cover() })).not.toBeNull();
    expect(screen.queryByRole("button", { name: m.media_viewer_cover_adjust() })).toBeNull();
    go("prev");
    expect(screen.queryByRole("button", { name: m.media_viewer_cover_adjust() })).not.toBeNull();
  });

  it.each(ACTIONS)("%s acts on the photo shown after Next, not on the one the viewer was opened on", (action, label) => {
    const { onAction } = open([K0, K1, K2], 0);
    go("next");
    click(label());
    expect(onAction).toHaveBeenCalledWith(action, K1);
  });

  it("cover acts on the photo shown, and Prev goes back to the first", () => {
    const { onAction } = open([K0, K1, K2], 1);
    go("next");
    click(m.media_viewer_cover());
    expect(onAction).toHaveBeenLastCalledWith("cover", K2);
    go("prev");
    go("prev");
    click(m.media_viewer_cover());
    expect(onAction).toHaveBeenLastCalledWith("cover", K0);
  });

  it("opening the viewer on another photo (the index prop changes) shows that photo", () => {
    const { onAction, again } = open([K0, K1, K2], 0);
    go("next");
    again({ index: 2 });
    click(m.media_viewer_annotate());
    expect(onAction).toHaveBeenCalledWith("annotate", K2);
  });
});

describe("the list changes while the viewer is open", () => {
  it("the photo on screen is deleted: the neighbour that takes its place is shown, and acted on", () => {
    const { onAction, again } = open([K0, K1, K2], 0);
    go("next"); // on k1
    again({ photos: [K0, K2] });
    expect(screen.getByTestId("lightbox").getAttribute("data-index")).toBe("1");
    click(m.common_delete());
    expect(onAction).toHaveBeenCalledWith("delete", K2);
  });

  it("the last photo on screen is deleted: the one before it is shown", () => {
    const { onAction, again } = open([K0, K1, K2], 2);
    again({ photos: [K0, K1] });
    click(m.common_delete());
    expect(onAction).toHaveBeenCalledWith("delete", K1);
  });

  it("the list is reordered: the viewer stays on the same photo, wherever it moved", () => {
    const { onAction, again } = open([K0, K1, K2], 0);
    go("next"); // on k1
    again({ photos: [K1, K0, K2] });
    expect(screen.getByTestId("lightbox").getAttribute("data-index")).toBe("0");
    click(m.media_viewer_annotate());
    expect(onAction).toHaveBeenCalledWith("annotate", K1);
  });

  it("several clips share the empty key: removing a photo before them keeps the viewer on the same clip", () => {
    const clip = (mediaId: string) => photo("", { mediaType: "video", provider: "r2", mediaId, originalKey: "", annotated: false });
    const [V1, V2] = [clip("m1"), clip("m2")];
    const { onAction, again } = open([K0, V1, V2], 2);
    again({ photos: [V1, V2] });
    expect(screen.getByTestId("lightbox").getAttribute("data-index")).toBe("1");
    click(m.common_delete());
    expect(onAction).toHaveBeenCalledWith("delete", V2);
  });

  it("the list empties: the viewer closes", () => {
    const { onClose, again } = open([K0], 0);
    again({ photos: [] });
    expect(onClose).toHaveBeenCalled();
  });
});
