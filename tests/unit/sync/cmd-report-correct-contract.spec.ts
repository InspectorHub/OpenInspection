/**
 * The wire contract for `cmd.report.correct` and its reply, on the consumer side.
 *
 * The two halves of a correction live in different repositories and deploy
 * independently, so the only thing holding them together is that both sides
 * parse the same shapes. This file asserts what THIS side will accept and what
 * it will emit; the sending side has the mirror of it.
 *
 * Two properties are load-bearing here and neither is obvious:
 *
 *   The command schema is `.strict()`. A correction names a natural person's
 *   data, so a field this side does not recognise means the sender believes
 *   something happens that does not. Accepted-and-dropped is the failure mode
 *   the DSAR commands already refuse, and it is worse here: the sender would
 *   record a correction covering a field nothing ever wrote.
 *
 *   The reply's `outcome` is the discriminant a reader consults before writing
 *   "done", so a REFUSED reply must be unable to carry the numbers a carried-out
 *   one does. Asserting the accepting direction alone would pass against a
 *   schema that accepted everything, so every rejection is paired with the
 *   acceptance it is the negative of.
 */
import { describe, it, expect } from 'vitest';
import {
    cmdReportCorrectDataSchema,
    isKnownCmd,
    parseCmdEnvelope,
} from '../../../server/lib/sync-events/cmd-envelope';
import { SCHEMAS, DATA_SCHEMAS } from '../../../server/lib/sync-events/envelope';
import { replyTypeFor } from '../../../server/portal/cmd-reply';
import correctFixture from '../../fixtures/cmd-events/cmd-report-correct-v1.json';

const VALID = {
    tenantId: 't1',
    inspectionId: 'i1',
    field: 'propertyAddress',
    to: '1 Main Street',
    reason: 'The address on the delivered report is not the property inspected.',
};

describe('cmd.report.correct — the command shape this side accepts', () => {
    it('accepts the command the sender actually builds', () => {
        expect(cmdReportCorrectDataSchema.parse(VALID)).toEqual(VALID);
    });

    it('accepts every field the correction service can act on, and only those', () => {
        // Read off the service's own list rather than restated here: two
        // hand-written copies of the enum is how the boundary starts accepting a
        // field nothing downstream can write.
        for (const field of ['addressStreet', 'addressCity', 'addressState', 'addressZip']) {
            expect(cmdReportCorrectDataSchema.parse({ ...VALID, field })).toBeTruthy();
        }
        expect(() => cmdReportCorrectDataSchema.parse({ ...VALID, field: 'clientName' })).toThrow();
        expect(() => cmdReportCorrectDataSchema.parse({ ...VALID, field: 'price' })).toThrow();
    });

    it('REFUSES a deferral request rather than accepting and ignoring it', () => {
        // The service takes `deferKeys` precisely so that asking can be refused.
        // Over this seam the request cannot even be expressed: a sender that
        // adds the field fails at the boundary instead of having it stripped and
        // then being told the correction completed in full.
        expect(() => cmdReportCorrectDataSchema.parse({ ...VALID, deferKeys: ['x'] })).toThrow();
    });

    it('REFUSES a correctedBy on the wire — authorisation is not a payload field', () => {
        // Whoever authorised the correction is the command's reply handle, not
        // something the sender may name: a payload field here would let an
        // amendment be attributed to an identifier this side cannot resolve.
        expect(() => cmdReportCorrectDataSchema.parse({ ...VALID, correctedBy: 'someone' })).toThrow();
    });

    it('requires a reason — an amendment nobody can account for is not a correction', () => {
        expect(() => cmdReportCorrectDataSchema.parse({ ...VALID, reason: '' })).toThrow();
        const { reason: _drop, ...noReason } = VALID;
        expect(() => cmdReportCorrectDataSchema.parse(noReason)).toThrow();
    });

    it('is a known command at v1, and unknown at a version this build cannot apply', () => {
        expect(isKnownCmd('io.inspectorhub.cmd.report.correct', 'cmd-report-correct/v1')).toBe(true);
        expect(isKnownCmd('io.inspectorhub.cmd.report.correct', 'cmd-report-correct/v2')).toBe(false);
    });
});

describe('the golden fixture is a command this build can actually apply', () => {
    it('parses as an envelope, is known, and its data validates', () => {
        const env = parseCmdEnvelope(correctFixture);
        expect(env).not.toBeNull();
        expect(isKnownCmd(env!.type, env!.dataschema)).toBe(true);
        expect(cmdReportCorrectDataSchema.parse(env!.data)).toBeTruthy();
        // The fixture MUST carry a replyto: without one the applier refuses to
        // publish, so a fixture missing it would model a command that can never
        // succeed while looking like the canonical example.
        expect(env!.replyto).toMatch(/^dsar:/);
    });
});

describe('reply.report.corrected — the shape this side emits', () => {
    it('is the reply a correction command earns', () => {
        expect(replyTypeFor('io.inspectorhub.cmd.report.correct')).toBe('reply.report.corrected');
    });

    it('is registered at v1 with a validator, like every other reply', () => {
        expect(SCHEMAS['reply.report.corrected']).toEqual(['v1']);
        expect(DATA_SCHEMAS['reply.report.corrected']).toBeTruthy();
    });

    const base = { tenantId: 't1', correlationId: 'c1', replyto: 'dsar:r1', inspectionId: 'i1', field: 'propertyAddress' };
    const schema = () => DATA_SCHEMAS['reply.report.corrected'];

    it('accepts a carried-out reply carrying both version numbers', () => {
        expect(schema().parse({ ...base, outcome: 'corrected', versionNumber: 2, supersedes: 1 })).toBeTruthy();
    });

    it('accepts a refusal carrying its reason', () => {
        expect(schema().parse({ ...base, outcome: 'refused', reason: 'Inspection not found' })).toBeTruthy();
    });

    it('REFUSES a carried-out reply with no version to name', () => {
        // The positive case above is what makes this meaningful: without it,
        // a schema that rejected everything would satisfy this assertion.
        expect(() => schema().parse({ ...base, outcome: 'corrected' })).toThrow();
    });

    it('REFUSES a refusal that carries no reason', () => {
        expect(() => schema().parse({ ...base, outcome: 'refused' })).toThrow();
    });

    it('REFUSES an outcome it does not recognise, rather than storing it verbatim', () => {
        // A third value would be read by the receiver as neither done nor
        // refused, and its request would sit unanswered with no trace of why.
        expect(() => schema().parse({ ...base, outcome: 'partly', versionNumber: 2, supersedes: 1 })).toThrow();
    });
});
