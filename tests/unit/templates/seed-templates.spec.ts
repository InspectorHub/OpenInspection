import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TemplateSchemaV2Schema } from '../../../server/lib/validations/template.schema';

/**
 * Spec 5B — every seed JSON must be a valid v2 template document.
 * If this fails, a hand-edited or auto-converted seed file does not
 * conform to the new structural rules. Fix the JSON, not the schema.
 */
describe('Spec 5B — seed templates conform to v2 schema', () => {
    const seedDir = path.resolve(__dirname, '../../../server/data/seed-templates');
    const files = fs.readdirSync(seedDir).filter(f => f.endsWith('.json'));

    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
        it(`seed template ${f} validates as v2`, () => {
            const raw = fs.readFileSync(path.join(seedDir, f), 'utf8');
            const doc = JSON.parse(raw);
            const result = TemplateSchemaV2Schema.safeParse(doc.schema);
            if (!result.success) {
                // Surface the first issue with full path for fast diagnosis.
                const first = result.error.issues[0];
                throw new Error(
                    `Seed ${f} failed v2 validation at ${first?.path?.join('.')}: ${first?.message}`
                );
            }
            expect(result.success).toBe(true);
        });
    }
});
