import { describe, it, expect } from "vitest";
import { coverCropFor } from "./CoverCropper";

/**
 * The cover cropper re-opens on the crop the cover was saved with. The rect is
 * in the SOURCE image's pixel space, so the only thing that makes restoring it
 * correct is that the image being cropped is the image it was measured against.
 *
 * These specs are mostly about the cases where it must NOT restore. A restore
 * that fires on the wrong source does not throw and does not look broken — it
 * frames a plausible region of the wrong picture, and the reader has no way to
 * tell that the frame was not theirs.
 */
const CROP = { aspect: "16:9", orientation: "portrait", x: 10, y: 20, width: 300, height: 400 };

describe("coverCropFor", () => {
    it("restores the saved crop when the source is the one it was measured on", () => {
        expect(coverCropFor({ coverPhotoId: "k1", coverCrop: CROP }, "k1")).toEqual({
            aspect: "16:9", orientation: "portrait", x: 10, y: 20, width: 300, height: 400,
        });
    });

    it("restores NOTHING for a different source — the rect belongs to another image", () => {
        expect(coverCropFor({ coverPhotoId: "k1", coverCrop: CROP }, "k2")).toBeNull();
    });

    it("restores nothing when no cover has been chosen yet", () => {
        expect(coverCropFor({ coverPhotoId: null, coverCrop: null }, "k1")).toBeNull();
        expect(coverCropFor(null, "k1")).toBeNull();
        expect(coverCropFor(undefined, "k1")).toBeNull();
    });

    it("restores nothing for a cover set without a crop", () => {
        // Picking a cover from the gallery writes `cover_photo_id` and leaves
        // `cover_crop` NULL. That is uncropped, not "crop unknown".
        expect(coverCropFor({ coverPhotoId: "k1", coverCrop: null }, "k1")).toBeNull();
    });

    it("rejects a degenerate or half-written rect rather than framing on zero", () => {
        for (const bad of [
            { ...CROP, width: 0 },
            { ...CROP, height: 0 },
            { ...CROP, x: undefined },
            { aspect: "3:2", orientation: "landscape" },
            "not-an-object",
        ]) {
            expect(coverCropFor({ coverPhotoId: "k1", coverCrop: bad }, "k1")).toBeNull();
        }
    });

    it("falls back to a landscape 3:2 frame when only the ratio fields are missing", () => {
        // The rect is what cannot be guessed; the ratio can, and defaulting it
        // beats discarding a usable crop.
        const out = coverCropFor({ coverPhotoId: "k1", coverCrop: { x: 1, y: 2, width: 3, height: 4 } }, "k1");
        expect(out).toEqual({ aspect: "3:2", orientation: "landscape", x: 1, y: 2, width: 3, height: 4 });
    });
});
