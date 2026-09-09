// @vitest-environment happy-dom
/**
 * A photo captured on ANOTHER device is not a broken image.
 *
 * `usePhotoOps` marks such an entry `pendingPlaceholder` and — deliberately —
 * gives it an EMPTY `url`, because there is nothing local to point at: no blob
 * on this client and no stored key to fall back on. Its own comment says what
 * should happen next ("placeholder, not a broken image").
 *
 * Nothing acted on it. The viewer mapped every non-video entry to
 * `{ src: fullResUrl(p.url) }`, so the one entry with no source became the one
 * slide that renders a broken-image glyph — and a photo that has not arrived
 * looked like a photo that failed.
 *
 * The strip already handles its own pending case through `pendingId`; the
 * VIEWER never did, which is why the type's promise about "the strip/viewer"
 * was only half true.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { MediaViewer } from "~/components/media-studio/MediaViewer";
import type { GalleryPhoto } from "~/lib/inspection-media";

/** The lightbox is a third-party surface; this suite is about what it is HANDED. */
vi.mock("~/components/media-studio/PhotoLightbox", () => ({
    PhotoLightbox: ({
        slides,
        index,
        renderSlide,
    }: {
        slides: unknown[];
        index: number;
        renderSlide?: (s: unknown) => React.ReactNode;
    }) => <div data-testid="lightbox">{renderSlide?.(slides[index]) ?? null}</div>,
}));

function photo(over: Partial<GalleryPhoto>): GalleryPhoto {
    return {
        key: "k1",
        url: "/api/inspections/i1/photo?key=k1",
        label: "Roof",
        itemId: "roof",
        photoIndex: 0,
        ...over,
    } as GalleryPhoto;
}

function show(p: GalleryPhoto) {
    render(<MediaViewer photos={[p]} index={0} onClose={() => {}} onAction={() => {}} />);
}

describe("MediaViewer, on an entry with nothing local to show", () => {
    it("renders a placeholder for a photo still on another device", () => {
        show(photo({ url: "", pending: true, pendingPlaceholder: true }));
        expect(screen.getByTestId("media-pending-placeholder")).toBeTruthy();
    });

    it("says why, rather than showing an empty frame", () => {
        show(photo({ url: "", pending: true, pendingPlaceholder: true }));
        expect(screen.getByTestId("media-pending-placeholder").textContent ?? "").toMatch(/\w{3}/);
    });

    /**
     * POSITIVE CONTROL. A viewer that rendered the placeholder unconditionally
     * would pass both cases above and would replace every real photo with it.
     */
    it("adds nothing to an ordinary stored photo", () => {
        show(photo({}));
        expect(screen.queryByTestId("media-pending-placeholder")).toBeNull();
    });

    /**
     * SECOND CONTROL, and not a restatement of the first: `pending` alone means
     * "uploading from THIS device", and that entry has a local blob to render.
     * A gate keyed on `pending` rather than on `pendingPlaceholder` would hide a
     * picture the inspector can already see.
     */
    it("still shows a photo that is uploading from this device", () => {
        show(photo({ url: "blob:local-preview", pending: true, pendingPlaceholder: false }));
        expect(screen.queryByTestId("media-pending-placeholder")).toBeNull();
    });
});
