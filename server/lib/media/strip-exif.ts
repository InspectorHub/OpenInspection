import { logger } from '../logger';

/** The subset of the Cloudflare Images binding we use for ingest re-encode. */
export interface ImagesBinding {
  input(stream: ReadableStream | ArrayBuffer | Uint8Array): {
    transform(opts: Record<string, unknown>): {
      output(opts: { format: string }): Promise<{ response(): Response }>;
    };
  };
}

export interface StrippedImage { bytes: ArrayBuffer | Uint8Array; contentType: string }

/**
 * N2 — strip-on-ingest fallback. Re-encode the bytes through env.IMAGES to
 * drop GPS/EXIF for any path that bypassed the client canvas bake. No resize
 * here (the client already downscaled; this is purely a metadata-stripping
 * re-encode). Fails OPEN: when the binding is absent or errors we return the
 * input bytes unchanged — the client bake is the primary guarantee and a
 * standalone deploy without IMAGES still functions.
 */
export async function stripExifOnIngest(
  images: ImagesBinding | undefined,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<StrippedImage> {
  if (!images) return { bytes, contentType };
  try {
    const out = await images.input(bytes).transform({}).output({ format: 'image/jpeg' });
    const resp = out.response();
    const reencoded = await resp.arrayBuffer();
    return { bytes: reencoded, contentType: 'image/jpeg' };
  } catch (err) {
    logger.warn('[upload] strip-on-ingest re-encode failed — storing bytes as received', { error: String(err) });
    return { bytes, contentType };
  }
}
