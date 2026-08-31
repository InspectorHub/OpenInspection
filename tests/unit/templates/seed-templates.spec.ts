import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TemplateSchemaV2Schema } from '../../../server/lib/validations/template.schema';
import { StatutoryTemplateSchema } from '../../../server/lib/validations/statutory-template.schema';

/**
 * Spec 5B — every seed JSON must be a valid template document.
 * If this fails, a hand-edited or auto-converted seed file does not
 * conform to the structural rules. Fix the JSON, not the schema.
 *
 * ── TWO VALIDATORS, CHOSEN BY THE DOCUMENT ──────────────────────────────────
 * `TemplateSchemaV2Schema` is `.strict()` and knows nothing about
 * `statutoryForm`, which is the closed door that stops a workspace declaring
 * its own official form on a template it authors. A seed that legitimately
 * carries the key — `trec-rei-7-6.json` does, since it exists to render onto
 * the Commission's own PDF — therefore fails it by design, and this file
 * asserted it anyway, so the whole suite went red the moment that template
 * grew its declaration. Reading it as "the seed is malformed" would have led
 * straight to the one repair the header warns against: widening the tenant
 * validator until it accepted the key, which is not a loosened rule but a
 * decision that workspaces may publish statutory forms.
 *
 * So the validator is chosen by what the document declares, and the choice is
 * asserted in both directions below.
 */
describe('Spec 5B — seed templates conform to their schema', () => {
    const seedDir = path.resolve(__dirname, '../../../server/data/seed-templates');
    const files = fs.readdirSync(seedDir).filter(f => f.endsWith('.json'));

    expect(files.length).toBeGreaterThan(0);

    function schemaOf(file: string): unknown {
        return JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8')).schema;
    }

    /** A seed is statutory exactly when its document declares a form. */
    function isStatutory(schema: unknown): boolean {
        return (schema as { statutoryForm?: unknown } | null)?.statutoryForm !== undefined;
    }

    for (const f of files) {
        it(`seed template ${f} validates`, () => {
            const schema = schemaOf(f);
            const validator = isStatutory(schema) ? StatutoryTemplateSchema : TemplateSchemaV2Schema;
            const result = validator.safeParse(schema);
            if (!result.success) {
                // Surface the first issue with full path for fast diagnosis.
                const first = result.error.issues[0];
                throw new Error(
                    `Seed ${f} failed validation at ${first?.path?.join('.')}: ${first?.message}`
                );
            }
            expect(result.success).toBe(true);
        });
    }

    it('the tenant-facing validator still REFUSES a statutory declaration', () => {
        // The control for the branch above, and the more important half of it.
        // Without this, relaxing which validator each seed gets would look
        // identical to relaxing the validator itself — and the second is what
        // opens the door this repository deliberately keeps shut.
        const statutory = files.map(schemaOf).filter(isStatutory);
        expect(statutory.length, 'no statutory seed to test the closed door with').toBeGreaterThan(0);

        for (const schema of statutory) {
            expect(TemplateSchemaV2Schema.safeParse(schema).success).toBe(false);
        }
    });

    it('the statutory validator refuses a document that declares no form', () => {
        // The other direction: the extended schema admits ONE key, it does not
        // turn validation off, and a seed with no declaration must not pass
        // through it as though it had one.
        const ordinary = files.map(schemaOf).filter((s) => !isStatutory(s));
        expect(ordinary.length).toBeGreaterThan(0);

        expect(StatutoryTemplateSchema.safeParse(ordinary[0]).success).toBe(false);
    });
});
