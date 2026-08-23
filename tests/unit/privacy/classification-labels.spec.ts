/**
 * The compliance labels that answer a legal question we are not asking.
 *
 * The same finding landed twice: an INTERNAL label gets read downstream as a
 * legal determination. Two labels in this engine were doing it.
 *
 *  - `anonymize` as an erasure/retention action. What the code does is write a
 *    sentinel over identifier columns in a row that survives. That is not CCPA
 *    deidentification, which carries substantive conditions we do not meet, and
 *    it is not GDPR anonymisation either. The name invited a future reader to
 *    claim we had produced legally deidentified data. It is `erase_in_place`.
 *  - `user.biometric.signature` as a data category. Two US statutes define
 *    "biometric" in a way that EXCLUDES a drawn signature image, and
 *    `scripts/check-signature-dynamics.mjs` exists to enforce that the image
 *    never becomes a reusable template. Asserting the characterisation in a
 *    label contradicted the invariant the gate protects. It is
 *    `user.signature.rendered_image`, and the rule carries a status marker
 *    saying the question was NOT ASSESSED rather than answered `false` — a
 *    `false` here would be the same mistake in the other direction.
 *
 * Every negative assertion below is paired with a positive control, because a
 * walk that visited nothing, or a manifest that parsed to nothing, prints green
 * on a "no bad string survives" check.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ERASURE_MANIFEST } from '../../../server/lib/compliance/erasure-manifest';
import { EraseDataResponseSchema } from '../../../server/lib/validations/admin/compliance';
import { RETENTION_MANIFEST } from '../../../server/lib/compliance/retention-manifest';

const COMPLIANCE_DIR = path.resolve(__dirname, '../../../server/lib/compliance');
const MANIFEST = path.join(COMPLIANCE_DIR, 'erasure-manifest.ts');

/** Every .ts file under `dir`, recursively. */
function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

const COMPLIANCE_FILES = walk(COMPLIANCE_DIR);

describe('the biometric characterisation we do not make', () => {
    it('the manifest names no biometric data category', () => {
        const src = fs.readFileSync(MANIFEST, 'utf8');
        expect(src).not.toMatch(/user\.biometric\./);
    });

    it('the manifest never answers the biometric question with a boolean', () => {
        // `biometric: false` is itself a legal conclusion, and the conclusion is
        // the thing being removed. Only a status marker is acceptable.
        const src = fs.readFileSync(MANIFEST, 'utf8');
        expect(src).not.toMatch(/\bbiometric:\s*(true|false)\b/);
    });

    it('the signature column is classified and carries its non-conclusion marker', () => {
        const rule = ERASURE_MANIFEST.find((r) => r.column === 'signature_base64');
        expect(rule, 'no rule for agreement_signers.signature_base64').toBeDefined();
        expect(rule?.category).toBe('user.signature.rendered_image');
        expect(rule?.biometricStatus).toBe('not_assessed_as_biometric');
    });

    it('exactly one rule carries the signature-image category', () => {
        // The doc comment used to say "the two signature columns". It was wrong:
        // `esign_audit_logs.signature` is a detached-signature seal over the
        // audit chain and carries `system.integrity`. A count fixes the prose in
        // place, so the next person to add a signature column has to decide
        // which of the two it is instead of inheriting a sentence.
        const carriers = ERASURE_MANIFEST.filter(
            (r) => r.category === 'user.signature.rendered_image',
        ).map((r) => `${r.table}.${r.column}`);
        expect(carriers).toEqual(['agreement_signers.signature_base64']);

        const seal = ERASURE_MANIFEST.find(
            (r) => r.table === 'esign_audit_logs' && r.column === 'signature',
        );
        expect(seal?.category).toBe('system.integrity');
    });
});

describe('the deidentification claim we do not make', () => {
    it('walks a non-empty set of compliance sources', () => {
        // Positive control for the scan below: an empty walk cannot fail it.
        expect(COMPLIANCE_FILES.length).toBeGreaterThan(10);
    });

    it('no action is named anonymize anywhere in the compliance directory', () => {
        const offenders: string[] = [];
        for (const file of COMPLIANCE_FILES) {
            if (/['"]anonymize['"]/.test(fs.readFileSync(file, 'utf8'))) {
                offenders.push(path.relative(COMPLIANCE_DIR, file));
            }
        }
        expect(
            offenders,
            `scanned ${COMPLIANCE_FILES.length} files; quoted 'anonymize' survives in: ${offenders.join(', ')}`,
        ).toEqual([]);
    });

    it('both manifests carry the replacement action, so the scan above is not vacuous', () => {
        const erasure = ERASURE_MANIFEST.filter((r) => r.action === 'erase_in_place');
        expect(erasure.length).toBeGreaterThan(0);

        const retention = RETENTION_MANIFEST.filter((r) => r.action === 'erase_in_place');
        expect(retention.length).toBeGreaterThan(0);
    });
});

describe('the rename stops at the wire, deliberately', () => {
    it('the response schema still accepts the OLD action value', () => {
        // Narrowing this to the new value alone would do two things a rename
        // must not: break `reply.subject.erased.v1`, a versioned cross-repo
        // event whose consumer validates the enum, and make every
        // `erasure_log.decisions_json` row written before 2026-08-17
        // unreadable against its own schema. An accountability record that
        // cannot be parsed is worse than one carrying an unfashionable word.
        const decision = {
            table: 'agreement_signers', action: 'anonymize', count: 1,
            legalBasis: 'art_17_3_e' as const, retentionExpiry: 1893456000000,
        };
        const parsed = EraseDataResponseSchema.safeParse({
            success: true,
            data: { message: 'done', status: 'completed', decisions: [decision] },
        });
        expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    });

    it('and the NEW action value, which is what new writes emit', () => {
        const parsed = EraseDataResponseSchema.safeParse({
            success: true,
            data: {
                message: 'done', status: 'completed',
                decisions: [{ table: 'agreement_signers', action: 'erase_in_place', count: 1, legalBasis: 'art_17_3_e' as const }],
            },
        });
        expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    });

    it('still refuses an action neither vocabulary contains', () => {
        // The widening is two named values, not a free-text field. A schema that
        // accepted anything would make the compatibility argument unfalsifiable.
        const parsed = EraseDataResponseSchema.safeParse({
            success: true,
            data: {
                message: 'done', status: 'completed',
                decisions: [{ table: 'agreement_signers', action: 'deidentified', count: 1 }],
            },
        });
        expect(parsed.success).toBe(false);
    });
});
