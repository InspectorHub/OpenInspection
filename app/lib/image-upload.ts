/**
 * The client half of every image a settings page accepts.
 *
 * Three surfaces on Settings → Profile take an image — the profile photo, the
 * signature, and each license or affiliation badge — and until now each did
 * something different with it. The photo went through a cropper; the signature
 * went through a hand-rolled canvas downscale that no other surface knew about;
 * the badge went to the server exactly as it came off disk, up to 2 MB. So the
 * one surface whose output is composited onto a published report was the one
 * with no way to fix a crooked scan or trim the paper around the mark.
 *
 * They share a cropper now. What is left here is the part that happens BEFORE
 * the cropper opens — deciding whether a file is acceptable, and whether it is
 * the kind of image a raster cropper should touch at all.
 */
import { m } from "~/paraglide/messages";

/** Raster + vector formats every one of these surfaces accepts. */
const IMAGE_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;

/** The server refuses above this on both the badge and the photo route. */
export const IMAGE_UPLOAD_MAX_BYTES = 2_000_000;

/**
 * A signature is a wide, thin mark on a line. 600px along its long edge is
 * about four times the size it is ever drawn at, and the value lives in a TEXT
 * column that is read on every report render and every agreement — so this cap
 * is a running cost, not a one-off.
 */
export const SIGNATURE_MAX_LONG_EDGE = 600;

/** A badge prints beside a line of text, and at most fills a report cover chip. */
export const BADGE_MAX_LONG_EDGE = 512;

/**
 * Why this file cannot be used, or null if it can.
 *
 * Returned rather than thrown, and rendered next to the control that produced
 * it: a file the reader just chose and we refused involves no request at all,
 * so a toast would be reporting on something that never left the page.
 */
export function validateImageFile(file: File): string | null {
  if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return m.settings_profile_signature_upload_bad_type();
  }
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
    return m.settings_profile_signature_upload_too_big();
  }
  return null;
}

/**
 * True for images that must NOT go through the raster cropper.
 *
 * An SVG is resolution-independent and usually already trimmed to its mark;
 * drawing it to a canvas to crop it would rasterize it at one fixed size and
 * throw away the only property that made it worth uploading. The same reasoning
 * the logo uploader has always used — vector art keeps its original format.
 */
export function isVectorImage(file: File): boolean {
  return file.type === "image/svg+xml";
}

/** Read a File to a data URI, or null when it cannot be read. */
export function readAsDataUri(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

/** Read a baked Blob to a data URI, or null when it cannot be read. */
export function blobToDataUri(blob: Blob): Promise<string | null> {
  return readAsDataUri(new File([blob], "image", { type: blob.type }));
}
