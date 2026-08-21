/**
 * The app, the bucket and the fixtures the import-run route specs share.
 *
 * Shared rather than copied because the thing under test is spread over four
 * spec files (remap/repair, apply/revert, assistance/abandon) and each of them
 * needs the SAME context shape — a tenant, an actor, a deployment profile, an
 * email provider and an R2 double. A per-file copy of that harness is how one
 * spec ends up asserting against a context the route never actually sees.
 *
 * It does NOT mock `drizzle-orm/d1`. That call has to be hoisted inside the
 * spec file that wants it, and a helper cannot do it on the spec's behalf.
 */
import { vi } from 'vitest';
import { Hono } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { Role } from '../../../server/lib/auth/roles';
import { AppError } from '../../../server/lib/errors';
import migrationIntakeRoutes from '../../../server/api/migration-intake';
import { SAAS_PROFILE, type DeploymentProfile } from '../../../server/lib/deployment-profile';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { r2Keys } from '../../../server/lib/r2-keys';
import type { MigrationIntent } from '../../../server/lib/db/schema';

export const TENANT = '11111111-1111-1111-1111-1111111111a1';
export const OTHER = '33333333-3333-3333-3333-3333333333c3';
export const USER = '22222222-2222-2222-2222-2222222222b2';

/** Two contacts, two columns. Enough for a re-map to visibly change the answer. */
export const CONTACTS_CSV = 'Full Name,Email\nAlice Ng,alice@example.test\nBob Ray,bob@example.test\n';

export const INTAKE_LIMITS = limitsFor(SAAS_PROFILE);

/** An R2 double over a plain Map, so a spec can read what was stored and what went. */
export function intakeBucket(store: Map<string, string>) {
    return {
        put: vi.fn(async (key: string, value: string) => { store.set(key, value); return {} as R2Object; }),
        get: vi.fn(async (key: string) => (store.has(key)
            ? ({ text: async () => store.get(key) as string } as unknown as R2ObjectBody)
            : null)),
        delete: vi.fn(async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        }),
    };
}

export interface IntakeAppOpts {
    /** Role on the context. Defaults to owner — the actor every happy path uses. */
    role?: string;
    /** Tenant on the context. Defaults to the tenant that owns the fixtures. */
    tenantId?: string;
    profile?: DeploymentProfile;
    store: Map<string, string>;
    /** Stand-in for the shared email provider. Throw from it to model a delivery failure. */
    sendInvitation?: (to: string, inviteLink: string) => Promise<void>;
}

/**
 * The routes under a context shaped like the real one.
 *
 * `onError` mirrors what server/index.ts does, so a guard's refusal arrives at
 * the assertions as its status AND its sentence rather than as a 500. Several
 * guards on these routes answer the same code, and the sentence is the only
 * thing that says which one spoke.
 */
export function intakeApp(opts: IntakeAppOpts) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        throw err;
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', opts.tenantId ?? TENANT);
        c.set('user', { sub: USER, role: (opts.role ?? 'owner') as Role });
        c.set('userRole', (opts.role ?? 'owner') as Role);
        c.set('profile', opts.profile ?? SAAS_PROFILE);
        c.set('services', {
            email: { sendInvitation: opts.sendInvitation ?? (async () => undefined) },
        } as never);
        await next();
    });
    app.route('/api/imports', migrationIntakeRoutes);
    return app;
}

export function intakeRequest(opts: IntakeAppOpts, path: string, init?: RequestInit) {
    return intakeApp(opts).request(path, init, { DB: {}, PHOTOS: intakeBucket(opts.store) });
}

/** A JSON request body with the header a zod-openapi route needs to read it. */
export function jsonBody(body: unknown, method: 'POST' | 'PATCH' = 'POST'): RequestInit {
    return {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    };
}

export async function messageOf(res: Response): Promise<string> {
    const body = await res.json() as { error?: { message?: string } };
    return body.error?.message ?? '';
}

type TestDb = BetterSQLite3Database<typeof schema>;

/** A tenant and its owner. `maxUsers` matters only where invitations are staged. */
export async function seedIntakeTenant(db: TestDb, tenantId = TENANT, maxUsers = 12): Promise<void> {
    await db.insert(schema.tenants).values({
        id: tenantId, slug: tenantId.slice(0, 8), status: 'active', deploymentMode: 'shared',
        tier: 'free', maxUsers, createdAt: new Date(),
    });
    await db.insert(schema.users).values({
        id: `${tenantId}-owner`, tenantId, email: `owner@${tenantId.slice(0, 4)}.test`,
        passwordHash: 'x', role: 'owner', createdAt: new Date(),
    });
}

function counts(kind: 'template' | 'contact' | 'member', n: number) {
    return {
        template: { readFromSource: kind === 'template' ? n : 0, emitted: kind === 'template' ? n : 0, dropped: [] },
        contact: { readFromSource: kind === 'contact' ? n : 0, emitted: kind === 'contact' ? n : 0, dropped: [] },
        member: { readFromSource: kind === 'member' ? n : 0, emitted: kind === 'member' ? n : 0, dropped: [] },
    };
}

export function contactsBundle(list: { name: string; email: string }[]) {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: counts('contact', list.length),
            warnings: [],
        },
        templates: [],
        contacts: list.map((c) => ({ ...c, type: 'client' as const })),
        members: [],
    };
}

export function membersBundle(list: { email: string; role: 'owner' | 'manager' | 'inspector' }[]) {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: counts('member', list.length),
            warnings: [],
        },
        templates: [],
        contacts: [],
        members: list,
    };
}

export interface StagedFixture {
    batchId: string;
    rowIds: string[];
    /** The key the source text was filed under, so a spec can assert it went. */
    sourceKey: string;
}

/**
 * A staged run with its file already in the store.
 *
 * The file is written directly rather than through the upload route: this
 * fixture is the STARTING state for every route below the upload, and driving
 * the upload to reach it would make each of those specs fail for reasons that
 * belong to routes-create.spec.ts.
 */
export async function stageIntakeRun(
    db: TestDb,
    store: Map<string, string>,
    params: {
        intent: MigrationIntent;
        bundle: unknown;
        sourceText?: string;
        tenantId?: string;
    },
): Promise<StagedFixture> {
    const tenantId = params.tenantId ?? TENANT;
    const sourceKey = r2Keys.migrationSource(tenantId, 'seed', 'csv');
    store.set(sourceKey, params.sourceText ?? CONTACTS_CSV);
    const staged = await new MigrationStageService({} as D1Database).stage({
        tenantId,
        createdBy: USER,
        intent: params.intent,
        limits: INTAKE_LIMITS,
        sourceKey,
        uploadAuthorizedBy: USER,
        bundle: params.bundle,
    });
    return { batchId: staged.batchId, rowIds: staged.rows.map((r) => r.id), sourceKey };
}
