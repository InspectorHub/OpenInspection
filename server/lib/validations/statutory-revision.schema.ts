import { z } from '@hono/zod-openapi';

/**
 * How an inspection's date sits against the statutory form revision its template produces.
 *
 * Mirrors `RevisionStatus` in `server/lib/statutory/revision-status.ts` field for field, and the declaration the
 * field editor package carries. `reason` is a plain string here on purpose: the closed set of withdrawal reasons
 * is the server's to extend, and a client must show an unknown one rather than fail to parse the whole response.
 * Unnamed, so the published contract gains no component.
 */
export const RevisionStatusSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('current').describe('The template produces the revision this inspection needs; nothing to say.'),
    }),
    z.object({
        kind: z.literal('superseding_soon').describe('A newer revision becomes mandatory soon; nothing is blocked.'),
        nextVersion: z.string().describe('Label of the revision that becomes mandatory.'),
        from: z.number().describe('When the newer revision becomes mandatory, as Unix milliseconds.'),
    }),
    z.object({
        kind: z.literal('superseded_elsewhere').describe('A newer revision is in force but this inspection predates it, so its form is correct.'),
        nextVersion: z.string().describe('Label of the revision now in force for later inspections.'),
        from: z.number().describe('When the newer revision became mandatory, as Unix milliseconds.'),
    }),
    z.object({
        kind: z.literal('cannot_produce').describe('This inspection falls under a revision the template does not produce.'),
        applicableVersion: z.string().describe('Label of the revision that governs the inspection date.'),
        templateVersion: z.string().describe('Label of the revision the template produces.'),
    }),
    z.object({
        kind: z.literal('withdrawn').describe('The revision the template produces has been taken out of service.'),
        version: z.string().describe('Label of the withdrawn revision.'),
        reason: z.string().describe('Why the revision was withdrawn, as a stable reason code.'),
        withdrawnAt: z.number().describe('When new production stopped, as Unix milliseconds.'),
        replacementVersion: z.string().nullable().describe('Label of the revision that governs this inspection date now, or null when none is published.'),
    }),
]);
