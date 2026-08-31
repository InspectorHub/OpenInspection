/**
 * SHA-256, lowercase hex. One implementation for the whole worker.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * There were NINE definitions of `sha256Hex` across `server/`, `app/` and
 * `scripts/`, written by different hands: some took a string, some took bytes,
 * one took either, one was an alias for the magic-link token hasher. They were
 * compared before they were merged -- every one of them, against four inputs
 * chosen to separate the ways two hashers usually disagree (a known vector, the
 * empty input, non-ASCII text where UTF-8 and latin1 diverge, and bytes
 * including NUL). All nine produced the same digest for the same input, and the
 * two with published vectors matched them, so consolidating changed no hash
 * anywhere.
 *
 * That they agreed is not the reason to have one. The reason is that a hash is
 * a JOIN: `field-map.ts` refuses a map whose `sourceHash` does not match the
 * bytes, `report-version.service.ts` re-verifies a snapshot against a stored
 * digest, `audit-log.service.ts` chains one row to the previous. Nine spellings
 * of the join is nine chances for the tenth to differ in the one way nobody
 * tests -- upper-case hex, latin1 instead of UTF-8, a separator -- and the
 * failure that produces is a stored record that stops verifying, which reads as
 * tampering rather than as a bug.
 *
 * ── ONE COPY IS DELIBERATELY LEFT ───────────────────────────────────────────
 * `scripts/verify-statutory-render.mjs` keeps its own, over Node's `createHash`.
 * That script exists to check a published field map against the authority's PDF
 * out of band, and one of the things it checks is the very `sourceHash`
 * comparison `field-map.ts` performs with this function. A verifier that
 * imported the implementation it is verifying could not report a fault in it.
 * The comment there says so; do not merge it in.
 *
 * ── WHAT IS FIXED, AND MUST STAY FIXED ──────────────────────────────────────
 * Lowercase hex, no separators, UTF-8 for strings. Every one of those is
 * load-bearing against digests already stored in D1 and in R2 object metadata:
 * change one and every previously written record fails its own verification.
 * `tests/unit/secrets/sha256.spec.ts` pins the output against published
 * SHA-256 vectors rather than against a value produced by this file.
 *
 * No Node APIs -- Web Crypto only, so this runs in the Worker as written.
 */

/**
 * @param input text (hashed as UTF-8) or the exact bytes.
 * @returns the digest as 64 lowercase hex characters.
 */
export async function sha256Hex(
    input: string | ArrayBufferView | ArrayBuffer,
): Promise<string> {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    // ⚠️ THE ASSERTION IS A TYPE ACCOMMODATION, NOT A CLAIM ABOUT THE BYTES.
    // workerd narrows `BufferSource` to ArrayBuffer-backed views, so a
    // `Uint8Array<ArrayBufferLike>` -- which is what `new Uint8Array(n)` is
    // typed as in the tests program -- does not satisfy the declaration even
    // though `digest` reads it perfectly well and retains nothing. The variant
    // this replaced satisfied the same declaration by copying every input into
    // a fresh ArrayBuffer first, which memcpies a whole PDF on every hash to
    // please a `.d.ts`. Widening the parameter and narrowing here says what is
    // actually going on.
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
