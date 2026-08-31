/**
 * The one SHA-256 the worker has, pinned to something outside this repository.
 *
 * ⚠️ NOT A SNAPSHOT, AND NOT A VALUE THIS FILE PRODUCED. The expectations below
 * are the published SHA-256 test vectors. A spec that hashed a string and
 * asserted the answer equalled what the function returned would agree with any
 * implementation, including one that had quietly started emitting upper-case
 * hex or reading the input as latin1 -- and every digest already written to D1
 * and to R2 object metadata is verified against this function, so a change in
 * any of those properties reads as a tampered record rather than as a bug.
 *
 * Filed under `secrets/` with `config-crypto` and `qbo-crypto`: it is a
 * cryptographic primitive rather than a feature, and nothing in `server/api/`
 * owns it.
 */
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../../../server/lib/sha256';
import { hashToken } from '../../../server/lib/token-hash';

/** Published vectors. Neither was produced by the code under test. */
const VECTORS: ReadonlyArray<readonly [string, string]> = [
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    [
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
];

describe('sha256Hex', () => {
    it.each(VECTORS)('matches the published digest of %o', async (input, expected) => {
        expect(await sha256Hex(input)).toBe(expected);
    });

    it('reads the same bytes whether they arrive as text or as a Uint8Array', async () => {
        // Both call shapes exist at real call sites -- a password is a string, a
        // PDF is bytes -- and a form that disagreed with the other would make one
        // half of the codebase unable to verify the other half's records.
        const text = 'abc';
        expect(await sha256Hex(new TextEncoder().encode(text))).toBe(await sha256Hex(text));
    });

    it('encodes a string as UTF-8, not as latin1', async () => {
        // The failure this pins is real in this repository: a PDF text extractor
        // read CP1252 and turned a right single quote into nothing. Two encodings
        // of one sentence are two different digests.
        const utf8 = new TextEncoder().encode('manufacturer’s plate');
        expect(await sha256Hex('manufacturer’s plate')).toBe(await sha256Hex(utf8));
        // And the two spellings of that sentence must NOT collide, or the
        // assertion above would hold for an implementation that dropped the
        // character entirely.
        expect(await sha256Hex('manufacturer’s plate'))
            .not.toBe(await sha256Hex('manufacturers plate'));
    });

    it('is lowercase hex, 64 characters, with no separators', async () => {
        // Each of the three is load-bearing against stored digests. Asserted
        // against the shape rather than against one example, because a single
        // example can be all-numeric by luck.
        for (const [input] of VECTORS) {
            expect(await sha256Hex(input)).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    it('is what hashToken stores, so a token row matches either way round', async () => {
        // `hashToken` used to be a second copy of these six lines, and a
        // `token_hash` column is matched on equality at every lookup.
        expect(await hashToken('abc')).toBe(await sha256Hex('abc'));
    });
});
