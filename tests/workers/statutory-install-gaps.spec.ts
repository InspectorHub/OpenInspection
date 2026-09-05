/**
 * "Installed but unusable" — the half that lives on a profile, not in R2.
 *
 * ── THE BAR THIS PINS, AND WHY IT IS THE ONE IT IS ──────────────────────────
 * NOBODY, never EVERYBODY. `statutory-import.ts` already refuses an install
 * when the authority's PDF is absent, on the stated grounds that an unchecked
 * install produces a template that can never render. This applies the SAME bar
 * to the profile-level facts the form requires.
 *
 * Both directions are asserted because both are real faults with opposite
 * costs. Too strict — refusing while one inspector CAN produce the form — gates
 * work somebody is already able to do, and nothing in the product tells them
 * why. Too loose — installing when nobody can — reproduces the production
 * failure of 2026-09-05, where the first person to learn was an inspector who
 * had already published a report to a client.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { applyMigrations as replayMigrations } from './migration-replay';
import { unsuppliableRequiredFields } from '../../server/services/statutory/install-gaps';
import { fieldMap as trecMap } from '../../server/lib/statutory/forms/tx-trec-rei-7-6';
import trecTemplate from '../../server/data/seed-templates/trec-rei-7-6.json';
import type { StatutoryFormDeclaration } from '../../server/types/template-schema';

const b = env as unknown as { DB: D1Database };
const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const TENANT = 'tenant-install-gaps';
const declaration = (trecTemplate as { schema: { statutoryForm: StatutoryFormDeclaration } })
    .schema.statutoryForm;

async function addMember(id: string, opts: { name?: string | null; licence?: string | null; role?: string } = {}) {
    const now = Date.now();
    // Columns read off `schema/tenant/user.ts`, not remembered: `users` has
    // created_at and no updated_at, which a guessed INSERT gets wrong.
    await b.DB.prepare(
        'INSERT INTO users (id, tenant_id, email, password_hash, name, role, created_at) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, TENANT, `${id}@example.test`, 'x', opts.name ?? null, opts.role ?? 'inspector', now).run();
    if (opts.licence) {
        await b.DB.prepare(
            'INSERT INTO inspector_credentials (id, tenant_id, user_id, label, member_number, '
            + 'image_r2_key, sort_order, is_active, created_at, updated_at) '
            + 'VALUES (?, ?, ?, ?, ?, NULL, -1, 1, ?, ?)',
        ).bind(`cred-${id}`, TENANT, id, 'State licence', opts.licence, now, now).run();
    }
}

describe('who can supply what a statutory form requires', () => {
    beforeAll(async () => {
        await replayMigrations(b.DB, migrationSql);
        // `users.tenant_id` is a real foreign key, so the workspace has to exist
        // before anybody can be in it.
        await b.DB.prepare(
            'INSERT INTO tenants (id, slug, status, tier, deployment_mode, created_at) '
            + 'VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(TENANT, 'install-gaps-co', 'active', 'pro', 'shared', Date.now()).run();
    });
    beforeEach(async () => {
        await b.DB.prepare('DELETE FROM inspector_credentials WHERE tenant_id = ?').bind(TENANT).run();
        await b.DB.prepare('DELETE FROM users WHERE tenant_id = ?').bind(TENANT).run();
    });

    it('names the two fields nobody can supply, and only those', async () => {
        // The production shape: a member exists, with neither a name nor a
        // licence. TREC also requires client_name, inspection_date and
        // property_address -- none of which is a profile fact, and a check that
        // named them would refuse every install forever.
        await addMember('u1');
        const gaps = await unsuppliableRequiredFields(drizzle(b.DB), TENANT, trecMap, declaration);
        expect(gaps.map((g) => g.field).sort())
            .toEqual(['inspector_license_number', 'inspector_name']);
    });

    it('does NOT refuse when one member can, even if three cannot', async () => {
        // The bar is NOBODY. Blocking a workspace where somebody is already
        // able to produce the form gates work that is not blocked.
        await addMember('u1');
        await addMember('u2');
        await addMember('u3');
        await addMember('u4', { name: 'Dana Reyes', licence: 'TREC-21234' });
        const gaps = await unsuppliableRequiredFields(drizzle(b.DB), TENANT, trecMap, declaration);
        expect(gaps).toEqual([]);
    });

    it('counts the two facts separately', async () => {
        // One member with a name and no licence, another with a licence and no
        // name: between them every required fact is supplied by SOMEBODY, which
        // is what the bar asks. A check that demanded one person hold both
        // would refuse this and be wrong.
        await addMember('u1', { name: 'Dana Reyes' });
        await addMember('u2', { licence: 'TREC-21234' });
        const gaps = await unsuppliableRequiredFields(drizzle(b.DB), TENANT, trecMap, declaration);
        expect(gaps).toEqual([]);
    });

    it('ignores agents, who do not sign inspections', async () => {
        // An agent holding a name would otherwise make a workspace look staffed
        // for a form none of them can produce.
        await addMember('agent1', { name: 'Robin Vale', licence: 'X-1', role: 'agent' });
        await addMember('u1');
        const gaps = await unsuppliableRequiredFields(drizzle(b.DB), TENANT, trecMap, declaration);
        expect(gaps.map((g) => g.field).sort())
            .toEqual(['inspector_license_number', 'inspector_name']);
    });

    it('treats a blank licence number as no licence', async () => {
        // A credential row exists but carries whitespace. Counting the ROW
        // rather than its content is the easy bug, and it prints a blank box on
        // an authority's page.
        await addMember('u1', { name: 'Dana Reyes', licence: '   ' });
        const gaps = await unsuppliableRequiredFields(drizzle(b.DB), TENANT, trecMap, declaration);
        expect(gaps.map((g) => g.field)).toEqual(['inspector_license_number']);
    });

    it('says nothing when the workspace has no members at all', async () => {
        // A different fault, and not this one's to report. Refusing here would
        // block the very first install a new workspace makes.
        const gaps = await unsuppliableRequiredFields(drizzle(b.DB), TENANT, trecMap, declaration);
        expect(gaps).toEqual([]);
    });
});
