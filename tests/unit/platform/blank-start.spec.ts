/**
 * Starting a workspace with no bundled content.
 *
 * First-run setup normally gives a new workspace the starter library. An
 * operator who is about to load their own data wants the opposite: an owner
 * account and nothing else. Two things have to hold for that to be true past
 * the first minute, and both are asserted against a real database here:
 *
 *  1. Setup itself writes no templates, comments, agreements or services.
 *  2. The bundled-content sweep, which hands content to every workspace whose
 *     stamp is not the current release, does not put it back the next time the
 *     release number moves.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import {
    tenants, users, templates, comments, agreements, contactRoleProfiles,
} from '../../../server/lib/db/schema';
import { StandaloneProvider } from '../../../server/lib/integration/standalone';
import { contentSeedSweepJob } from '../../../server/cron/jobs/content';
import { NO_STARTER_CONTENT } from '../../../server/services/starter-content/content-version';
import type { ScheduledEnv } from '../../../server/scheduled';

// A release number that differs from the real one, to stand in for "the next
// release shipped more bundled content".
vi.mock('../../../server/services/starter-content/content-version', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../server/services/starter-content/content-version')>();
    return { ...real, STARTER_CONTENT_VERSION: 'c-next-release' };
});

const TENANT = '00000000-0000-0000-0000-0000000000c1';

let db: BetterSQLite3Database<typeof schema>;
let binding: D1Database;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    binding = toD1Binding(fix.sqlite);
    await setupSchema(fix.sqlite);
});

const setup = (startEmpty?: boolean) => new StandaloneProvider(binding).handleTenantUpdate({
    id: TENANT, slug: 'acme', status: 'active', name: 'Acme',
    adminEmail: 'owner@example.com', adminPasswordHash: 'pbkdf2:x:y', adminName: 'Owner',
    ...(startEmpty === undefined ? {} : { startEmpty }),
});
const rows = (table: typeof templates | typeof comments | typeof agreements | typeof contactRoleProfiles) =>
    db.select().from(table).all().length;
const env = () => ({ DB: binding }) as unknown as ScheduledEnv;

describe('setup with startEmpty', () => {
    it('creates the owner and writes no templates, comments or agreements', async () => {
        await setup(true);
        expect(db.select().from(users).all()).toHaveLength(1);
        expect(rows(templates)).toBe(0);
        expect(rows(comments)).toBe(0);
        expect(rows(agreements)).toBe(0);
    });

    it('still seeds the role profiles the People section needs', async () => {
        await setup(true);
        expect(rows(contactRoleProfiles)).toBeGreaterThan(0);
    });

    it('CONTROL - the default path still writes the starter library', async () => {
        await setup();
        expect(rows(templates)).toBeGreaterThan(0);
        expect(rows(comments)).toBeGreaterThan(0);
        expect(rows(agreements)).toBeGreaterThan(0);
    });
});

describe('the bundled-content sweep after a blank start', () => {
    const stampBlank = () => db.update(tenants).set({ contentVersion: NO_STARTER_CONTENT })
        .where(eq(tenants.id, TENANT)).run();

    it('does not offer a blank-start workspace content, and writes none, when the release number moves', async () => {
        await setup(true);
        await stampBlank();
        expect(await contentSeedSweepJob.probe(env())).toBe(0);
        const result = await contentSeedSweepJob.run(env(), null);
        expect(result.processed).toBe(0);
        expect(rows(templates)).toBe(0);
        expect(rows(comments)).toBe(0);
        const [row] = db.select().from(tenants).where(eq(tenants.id, TENANT)).all();
        expect(row?.contentVersion).toBe(NO_STARTER_CONTENT);
    });

    it('POSITIVE CONTROL - a default workspace on an older stamp IS swept under the same release number', async () => {
        await setup();
        expect(await contentSeedSweepJob.probe(env())).toBe(1);
        const result = await contentSeedSweepJob.run(env(), null);
        expect(result.processed).toBe(1);
        const [row] = db.select().from(tenants).where(eq(tenants.id, TENANT)).all();
        expect(row?.contentVersion).toBe('c-next-release');
    });
});
