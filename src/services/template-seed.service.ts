import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { templates } from '../lib/db/schema';
import { logger } from '../lib/logger';

import residential          from '../data/seed-templates/residential.json';
import preListing           from '../data/seed-templates/pre-listing.json';
import newConstruction      from '../data/seed-templates/new-construction.json';
import newConstructionFinal from '../data/seed-templates/new-construction-final.json';
import sewerScope           from '../data/seed-templates/sewer-scope.json';
import radon                from '../data/seed-templates/radon.json';
import moldInspection       from '../data/seed-templates/mold-inspection.json';

const SEEDS = [residential, preListing, newConstruction, newConstructionFinal, sewerScope, radon, moldInspection];
export const DEFAULT_AUTO_SEED_NAMES = SEEDS.map(s => s.name);

export class TemplateSeedService {
    constructor(private db: D1Database) {}

    async bulkSeed(tenantId: string): Promise<{ seeded: number; skipped: number }> {
        const d = drizzle(this.db);
        let seeded = 0, skipped = 0;
        for (const seed of SEEDS) {
            const existing = await d.select({ id: templates.id }).from(templates)
                .where(and(eq(templates.tenantId, tenantId), eq(templates.name, seed.name))).get();
            if (existing) { skipped++; continue; }
            await d.insert(templates).values({
                id:        crypto.randomUUID(),
                tenantId,
                name:      seed.name,
                version:   seed.version,
                schema:    JSON.stringify(seed.schema),
                createdAt: new Date(),
            }).run();
            seeded++;
        }
        logger.info('Templates seeded', { tenantId, seeded, skipped });
        return { seeded, skipped };
    }
}
