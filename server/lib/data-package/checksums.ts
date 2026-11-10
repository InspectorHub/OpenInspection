import { toBytes } from './bytes';
import { assertNoDuplicateEntryNames, assertNoPrefixCollisions } from './entry-name';
import { DataPackageFormatError } from './errors';
import { Sha256Js } from './sha256-js';
import { classifyPackageEntry } from './volume';

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------- hashing

/**
 * An incremental hasher: feed chunks, then ask for the lowercase hex digest. `digestHex()` is idempotent
 * (every call returns the same digest), `update()` after it throws `hasher_finished`, and `abort()` releases
 * the hasher without producing a digest. Both implementations (native and pure JS) behave the same.
 */
export interface Sha256Hasher {
  update(chunk: Uint8Array): Promise<void>;
  digestHex(): Promise<string>;
  abort(): Promise<void>;
}

/** The shape of the Workers-only `crypto.DigestStream` (a WritableStream with a `digest` promise). */
interface DigestStreamLike extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>;
}
export type DigestStreamCtor = new (algorithm: 'SHA-256') => DigestStreamLike;

function toHex(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function nativeDigestStream(): DigestStreamCtor | null {
  const ctor = (typeof crypto === 'undefined' ? undefined : (crypto as { DigestStream?: DigestStreamCtor }).DigestStream);
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Prefers the native `crypto.DigestStream` (Workers: hashing costs no JS CPU) and falls back to the
 * pure-JS hasher elsewhere. `digestStream` is injectable so both branches can be exercised in tests.
 */
export function createSha256Hasher(digestStream: DigestStreamCtor | null = nativeDigestStream()): Sha256Hasher {
  let finished: Promise<string> | null = null;
  let aborted = false;
  const closed = (): Promise<never> => Promise.reject(new DataPackageFormatError('hasher_finished', 'the hasher is already finished'));
  if (digestStream) {
    const stream = new digestStream('SHA-256');
    stream.digest.catch(() => undefined); // a rejected digest must never surface as an unhandled rejection
    const writer = stream.getWriter();
    return {
      update: (chunk) => (finished || aborted ? closed() : writer.write(chunk)),
      digestHex: () => {
        if (aborted) return closed();
        finished ??= writer.close().then(() => stream.digest).then(toHex);
        return finished;
      },
      abort: async () => {
        if (finished || aborted) return;
        aborted = true;
        await writer.abort(new Error('aborted')).catch(() => undefined);
      },
    };
  }
  const js = new Sha256Js();
  return {
    update: (chunk) => {
      if (finished || aborted) return closed();
      js.update(chunk);
      return Promise.resolve();
    },
    digestHex: () => {
      if (aborted) return closed();
      finished ??= Promise.resolve(js.digestHex());
      return finished;
    },
    abort: () => {
      if (!finished) aborted = true;
      return Promise.resolve();
    },
  };
}

/** One-shot digest of bytes already in memory (small inputs only). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

export interface StreamDigest {
  readonly sha256: string;
  readonly bytes: number;
}

function checkMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new DataPackageFormatError('limit_invalid', 'maxBytes must be a non-negative safe integer');
}

/** Hash a stream with a bounded buffer. Throws `stream_too_large` as soon as more than `maxBytes` arrive. */
export async function sha256OfStream(stream: ReadableStream<Uint8Array>, maxBytes: number, hasher: Sha256Hasher = createSha256Hasher()): Promise<StreamDigest> {
  checkMaxBytes(maxBytes);
  const reader = stream.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = toBytes(value);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new DataPackageFormatError('stream_too_large', 'stream exceeds its byte limit');
      await hasher.update(chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await hasher.abort();
    throw error;
  }
  return { sha256: await hasher.digestHex(), bytes };
}

/**
 * A pass-through that counts and hashes what flows by, so the same bytes can be parsed and verified in one
 * pass. `result()` is valid only after the source ended normally (the transform's `flush` ran): a source
 * that errored, a consumer that cancelled, or a read that stopped early leaves it incomplete, and
 * `result()` then throws `stream_incomplete` rather than returning the digest of a prefix. Exceeding
 * `maxBytes` errors the stream.
 */
export function createDigestTap(maxBytes: number, hasher: Sha256Hasher = createSha256Hasher()): { stream: TransformStream<Uint8Array, Uint8Array>; result: () => Promise<StreamDigest>; abort: () => Promise<void> } {
  checkMaxBytes(maxBytes);
  let bytes = 0;
  let complete = false;
  let failed = false;
  const fail = (): void => {
    failed = true;
    void hasher.abort();
  };
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    async transform(raw, controller) {
      try {
        const chunk = toBytes(raw);
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new DataPackageFormatError('stream_too_large', 'stream exceeds its byte limit');
        await hasher.update(chunk);
        controller.enqueue(chunk);
      } catch (error) {
        fail();
        throw error;
      }
    },
    flush() {
      complete = !failed;
    },
    cancel() {
      fail();
    },
  });
  return {
    stream,
    /**
     * Release the hasher. The transformer's `cancel` hook is not called by every runtime when the source errors
     * (the writable side aborts), so a caller that sees the pipe fail must call this; it is harmless after `result()`.
     */
    abort: () => hasher.abort(),
    result: async () => {
      if (!complete || failed) throw new DataPackageFormatError('stream_incomplete', 'the stream did not end normally');
      return { sha256: await hasher.digestHex(), bytes };
    },
  };
}

// ---------------------------------------------------------------- GNU sha256sum format

export interface ChecksumEntry {
  readonly path: string;
  readonly sha256: string;
}

/** Derived from the manifest's file limit (50,000) plus the two files a volume carries beside its listed ones. `manifest.ts` derives its own limit from this. */
export const MAX_CHECKSUM_ENTRIES = 50_002;
/** A line is 64 hex + 2 spaces + a name of at most 512 characters + LF. */
const MAX_CHECKSUM_LINE_CHARS = 64 + 2 + 512 + 1;
/**
 * Byte cap on a whole checksums file, checked before decoding. A real export line is about 200 bytes (the
 * longest real path is a media key near 135 characters), so 50,002 lines come to about 10 MB; 12 MiB leaves
 * headroom while staying far under the 58 MB that the per-name maximum (512) would allow. A file of shorter
 * lines can hold the full entry count; one of unusually long names hits this cap first.
 */
export const MAX_CHECKSUMS_BYTES = 12 * 1024 * 1024;

/**
 * Names a `checksums.sha256` may list are exactly the names a manifest may list (`classifyPackageEntry`):
 * data shards, media objects, esign files, README files. `manifest.json` and `checksums.sha256` themselves
 * are not covered: the manifest's own digest is shown to the user (and printed by the verifier) instead,
 * because a file cannot carry its own hash.
 */
function assertListable(path: string): void {
  if (classifyPackageEntry(path) === null) throw new DataPackageFormatError('entry_name_invalid', 'entry name rejected: not a permitted package entry');
}

/**
 * `<sha256>  <path>\n` per entry (two spaces = GNU text mode), sorted by path so the output is
 * deterministic. Paths are validated (and must be unique once case-folded), so no name needs the
 * backslash escaping GNU uses for odd file names.
 */
export function generateChecksums(entries: readonly ChecksumEntry[]): string {
  if (entries.length === 0) throw new DataPackageFormatError('checksums_invalid', 'no entries (parseChecksums refuses an empty file)');
  if (entries.length > MAX_CHECKSUM_ENTRIES) throw new DataPackageFormatError('checksums_invalid', 'too many entries');
  for (const entry of entries) {
    assertListable(entry.path);
    if (!SHA256_HEX_RE.test(entry.sha256)) throw new DataPackageFormatError('checksums_invalid', 'digest is not 64 lowercase hex characters');
  }
  const paths = entries.map((entry) => entry.path);
  assertNoDuplicateEntryNames(paths);
  assertNoPrefixCollisions(paths);
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const text = sorted.map((entry) => `${entry.sha256}  ${entry.path}\n`).join('');
  if (text.length > MAX_CHECKSUMS_BYTES) throw new DataPackageFormatError('checksums_invalid', 'file too large');
  return text;
}

const LINE_RE = /^([0-9a-f]{64}) {2}([^\n]+)$/;

/**
 * Strict inverse of `generateChecksums`: LF only, every line terminated, lowercase digests, two-space
 * separator, listable and unique entry names, at least one entry (`generateChecksums` refuses an empty list
 * for the same reason), no BOM. Anything else throws
 * `checksums_invalid` (a truncated file must not parse as a shorter list). Accepts text or bytes; bytes are
 * size-checked before decoding. Lines are cut with `indexOf`
 * one at a time, never `split`, and the size caps are checked before any line is touched.
 */
export function parseChecksums(input: string | Uint8Array): ChecksumEntry[] {
  const fail = (why: string): never => {
    throw new DataPackageFormatError('checksums_invalid', why);
  };
  // Size by bytes, before decoding: the cap bounds the allocation, not just the line loop.
  const size = typeof input === 'string' ? (input.length * 3 > MAX_CHECKSUMS_BYTES ? new TextEncoder().encode(input).byteLength : input.length) : input.byteLength;
  if (size > MAX_CHECKSUMS_BYTES) return fail('file too large');
  let text: string;
  try {
    text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    return fail('not valid UTF-8');
  }
  if (text.length === 0) return fail('empty');
  if (text.charCodeAt(0) === 0xfeff) return fail('byte order mark');
  if (!text.endsWith('\n')) return fail('last line is not terminated');
  const entries: ChecksumEntry[] = [];
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf('\n', start);
    if (end - start > MAX_CHECKSUM_LINE_CHARS) return fail('line too long');
    if (entries.length >= MAX_CHECKSUM_ENTRIES) return fail('too many entries');
    const match = LINE_RE.exec(text.slice(start, end));
    if (!match || match[1] === undefined || match[2] === undefined) return fail('malformed line');
    assertListable(match[2]);
    entries.push({ sha256: match[1], path: match[2] });
    start = end + 1;
  }
  const paths = entries.map((entry) => entry.path);
  assertNoDuplicateEntryNames(paths);
  assertNoPrefixCollisions(paths);
  return entries;
}
