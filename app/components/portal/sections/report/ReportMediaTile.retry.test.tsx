// @vitest-environment happy-dom
/**
 * A report photo that fails to load gets ONE more try; if that fails too it is reported so the report collapses it.
 *
 * Observed on a client report's first load: one photo rendered as a broken image (naturalWidth 0)
 * although its URL answered 200 with decodable bytes. Two ways that happens, both covered here:
 *  - the `error` event fires and the handler is attached, but nothing retried and the old code
 *    collapsed the tile at once, so a transient failure dropped a photo from the report;
 *  - the image failed while the server-rendered HTML was still being parsed, BEFORE hydration, so
 *    React never saw an `error` event at all and the broken glyph stayed. A mounted image that is
 *    already `complete` with `naturalWidth` 0 is the only trace of that, so mount must look.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ReportMediaTile } from "./ReportMediaTile";

const PHOTO = { key: "photos/roof.jpg", url: "/api/public/report/acme/i1/photo?key=photos%2Froof.jpg&token=t" };

const onPhotoFailed = vi.fn();
function tile() {
  return render(
    <ReportMediaTile photo={PHOTO} alt="Cracked roof tile" idx={0} printMode={false} onOpenLightbox={vi.fn()} onPhotoFailed={onPhotoFailed} />,
  );
}
const img = (c: HTMLElement) => c.querySelector("img");

// happy-dom reports every image as complete with no size, which is exactly the pre-hydration failure the mount
// check looks for. Describe the ordinary in-flight image the way a browser does, and let a test override it.
beforeEach(() => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  onPhotoFailed.mockClear();
  vi.restoreAllMocks();
});

describe("ReportMediaTile image branch", () => {
  it("retries once on error by re-mounting the image, and reports the photo only when the retry also fails", () => {
    const { container } = tile();
    const first = img(container)!;
    fireEvent.error(first);
    const second = img(container);
    // A keyed re-render: a NEW element, same URL (no cache-busting parameter), and nothing reported yet.
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second!.getAttribute("src")).toBe(first.getAttribute("src"));
    expect(onPhotoFailed).not.toHaveBeenCalled();

    fireEvent.error(second!);
    expect(onPhotoFailed).toHaveBeenCalledTimes(1);
    expect(onPhotoFailed).toHaveBeenCalledWith(PHOTO.key);
  });

  it("recovers from a single transient failure without reporting the photo", () => {
    const { container } = tile();
    fireEvent.error(img(container)!);
    fireEvent.load(img(container)!);
    expect(img(container)).not.toBeNull();
    expect(onPhotoFailed).not.toHaveBeenCalled();
  });

  it("treats an image that already failed before hydration as an error on mount", async () => {
    // happy-dom does not load images; describe the pre-hydration failure the way the browser reports it.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue("/photo");
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    tile();
    await act(async () => {});
    // Both mounts report a failed image (the first by the mount check, the retry by the same check), so the
    // retry budget is spent and the photo is reported exactly once.
    expect(onPhotoFailed).toHaveBeenCalledTimes(1);
  });

  it("leaves a healthy, already-loaded image alone", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue("/photo");
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(640);
    const { container } = tile();
    await act(async () => {});
    expect(img(container)).not.toBeNull();
    expect(onPhotoFailed).not.toHaveBeenCalled();
  });
});
