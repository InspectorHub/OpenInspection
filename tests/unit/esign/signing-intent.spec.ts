/**
 * Intent comes from an act, not from an artefact.
 *
 * The rule: intent must come from a recorded user action, not inferred back
 * from the fact that the user has a signature image. The chain that has to be
 * recorded is three steps — the user was PRESENTED agreement X
 * at version/hash Y, the user TOOK an explicit signing action, the system
 * RECORDED a signature.
 *
 * ── What was actually missing, which is narrower and worse than it sounds ────
 * Step three was recorded. `signer.signed` carries the envelope's content hash
 * and the signature image hash. Step two is the event existing.
 *
 * Step ONE was recorded nowhere. `request.viewed` is declared in the audit
 * event enum and in the service's event union — and has ZERO WRITERS. Nothing
 * has ever appended one. `markViewedBySigner` flips a status column, which is a
 * flag rather than a chained, signed, tamper-evident fact, and it carries no
 * hash at all. So the chain read: "we recorded a signature against this hash",
 * with no record of the signer ever having been shown it.
 *
 * ── Why this is the shape rather than a new table ────────────────────────────
 * Two forms satisfy the rule — a dedicated `signing_intent_event`, OR the
 * existing signing event explicitly recording the three
 * facts. The second is chosen deliberately. `esign_audit_logs` is already
 * hash-chained and signed per append, which is precisely the property an intent
 * record needs; a parallel table would have to earn that property again, and
 * would introduce a second answer to "what happened to this envelope". The
 * signing path is also the most safety-critical path in the product, and adding
 * a hard precondition to it is a change whose failure mode is a customer who
 * cannot sign.
 */
import { describe, it, expect } from 'vitest';
import {
    PRESENTATION_EVENT,
    presentedContentHashes,
    signingIntentProblem,
} from '../../../server/lib/esign/signing-intent';

const SIGNER = 'signer-1';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

const viewed = (over: Record<string, unknown> = {}) => ({
    event: PRESENTATION_EVENT,
    payloadJson: JSON.stringify({ signerId: SIGNER, contentHash: HASH, ...over }),
});

describe('presentedContentHashes', () => {
    it('reads the hash a signer was actually shown', () => {
        expect([...presentedContentHashes([viewed()], SIGNER)]).toEqual([HASH]);
    });

    it('ignores a presentation to a DIFFERENT signer', () => {
        // Two signers on one envelope is the normal case. A co-client's view
        // must never satisfy the primary client's intent chain.
        expect([...presentedContentHashes([viewed({ signerId: 'someone-else' })], SIGNER)])
            .toEqual([]);
    });

    it('ignores events that are not presentations', () => {
        const signed = { event: 'signer.signed', payloadJson: JSON.stringify({ signerId: SIGNER, contentHash: HASH }) };
        expect([...presentedContentHashes([signed], SIGNER)]).toEqual([]);
    });

    it('survives a payload that is not JSON, rather than throwing', () => {
        // These rows are read years later by a verifier. One malformed row must
        // not make the whole chain unreadable.
        expect([...presentedContentHashes([{ event: PRESENTATION_EVENT, payloadJson: '{oops' }], SIGNER)])
            .toEqual([]);
    });

    it('collects every distinct hash when a signer was shown more than one', () => {
        const hashes = presentedContentHashes([viewed(), viewed({ contentHash: OTHER_HASH })], SIGNER);
        expect([...hashes].sort()).toEqual([HASH, OTHER_HASH].sort());
    });
});

describe('signingIntentProblem', () => {
    it('passes when the signer was presented the hash they are signing', () => {
        expect(signingIntentProblem({
            logs: [viewed()], signerId: SIGNER, signedHash: HASH,
        })).toBeNull();
    });

    it('names the missing presentation when the signer was never shown anything', () => {
        const problem = signingIntentProblem({ logs: [], signerId: SIGNER, signedHash: HASH });
        expect(problem).toMatch(/present/i);
    });

    it('names the MISMATCH when the signer was shown a different document', () => {
        // The failure this exists for: a document re-pinned between the view and
        // the signature would leave a chain asserting a signature over text the
        // signer never saw, and every hash in it would be internally consistent.
        const problem = signingIntentProblem({
            logs: [viewed({ contentHash: OTHER_HASH })], signerId: SIGNER, signedHash: HASH,
        });
        expect(problem).toMatch(/differ|mismatch|not the document/i);
    });

    it('does not accept a presentation to another signer as this signer\'s intent', () => {
        const problem = signingIntentProblem({
            logs: [viewed({ signerId: 'someone-else' })], signerId: SIGNER, signedHash: HASH,
        });
        expect(problem).toMatch(/present/i);
    });

    it('passes when the hash is unknown, because an absent hash is not a mismatch', () => {
        // An envelope whose snapshot predates content hashing has no hash to
        // compare. Refusing there would block a signature for a reason that is
        // about our own history rather than about the signer — the honest answer
        // is that the chain cannot be checked, not that it failed.
        expect(signingIntentProblem({
            logs: [viewed({ contentHash: null })], signerId: SIGNER, signedHash: null,
        })).toBeNull();
    });

    it('still requires a presentation even when neither side has a hash', () => {
        // The weaker check does not become no check. A signature with no record
        // of the document ever being shown is the original defect.
        expect(signingIntentProblem({ logs: [], signerId: SIGNER, signedHash: null }))
            .toMatch(/present/i);
    });
});
