/**
 * Seed the service catalogue — what a new tenant can actually sell.
 *
 * Extracted from `starter-content.service.ts` because it is the one block that
 * has to read another block's output: each entry resolves its template by NAME,
 * so it must run after templates are seeded. Event types are referenced by slug
 * and so do not care about ordering, which is half the reason slugs were chosen
 * over ids.
 */
import { eq } from 'drizzle-orm';
import { services, templates } from '../../lib/db/schema';
import { STARTER_SERVICES } from './fixtures/services';
import { batchInsert } from './batch-insert';

/**
 * Idempotent on `(tenantId, name)`, matching every other block in starter
 * content. A tenant who renamed a seeded service keeps their name — re-running
 * must not hand them a second copy under the original one.
 *
 * @returns the number of NEW rows inserted (zero on an idempotent re-run).
 */
export async function seedServices(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: any,
    tenantId: string,
): Promise<number> {
    const existingServices = await d.select({ name: services.name }).from(services)
        .where(eq(services.tenantId, tenantId)).all();
    const existingNames = new Set(existingServices.map((r: { name: string }) => r.name));

    const templateRows = await d.select({ id: templates.id, name: templates.name })
        .from(templates).where(eq(templates.tenantId, tenantId)).all();
    const templateIdByName = new Map<string, string>(
        templateRows.map((r: { id: string; name: string }) => [r.name, r.id]),
    );

    const rows = STARTER_SERVICES
        .filter(s => !existingNames.has(s.name))
        .map(s => ({
            id:          crypto.randomUUID(),
            tenantId,
            name:        s.name,
            description: s.description,
            price:       s.priceCents,
            durationMinutes: s.durationMinutes,
            // A tenant who already had a template of this name keeps THEIR
            // template, and a missing one leaves the link null rather than
            // failing the whole provisioning run.
            templateId:  templateIdByName.get(s.templateName) ?? null,
            agreementId: null,
            active:      true,
            sortOrder:   s.sortOrder,
            createdAt:   new Date(),
            defaultEventTypeSlugs: s.defaultEventTypeSlugs,
        }));

    await batchInsert(d, services, rows);
    return rows.length;
}
