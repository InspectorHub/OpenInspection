export interface DecodeImageOptions {
  /** Longest edge the caller will keep; the decoder SHOULD NOT return more pixels than this. Omitted: full size. */
  maxLongEdge?: number;
  /**
   * Present when the person keeps original quality. Return the image at full size and the highest JPEG quality that
   * keeps the result within `maxBytes`.
   */
  keepOriginal?: { maxBytes: number };
}

export interface DecodedImage {
  /** A browser-decodable image (image/jpeg). Orientation already applied; no metadata is required. */
  blob: Blob;
}

/** A file the host recognised but could not decode. `message` is shown to the person, so the host words it. */
export class DecodeImageError extends Error {
  readonly code: 'UNSUPPORTED' | 'TOO_LARGE_PIXELS' | 'CORRUPT' | 'TIMEOUT';
  constructor(code: DecodeImageError['code'], message: string) {
    super(message);
    this.name = 'DecodeImageError';
    this.code = code;
  }
}

/** Matched by name rather than by class, so an error from a second copy of this package in the host still counts. */
export function isDecodeImageError(e: unknown): e is DecodeImageError {
  return e instanceof Error && e.name === 'DecodeImageError';
}

/** The optional `media.decodeImage` capability of a data source. */
export type DecodeImage = (file: Blob, opts: DecodeImageOptions) => Promise<DecodedImage | null>;
