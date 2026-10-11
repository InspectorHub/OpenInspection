/**
 * Harness for the "which tenant does this email speak for" specs.
 *
 * It drives the REAL application (`server/index.ts`'s `app`, so the real
 * middleware chain in its real order: contextBootstrap -> tenantRouter -> ... ->
 * jwtAuth -> ... -> integrationSecrets -> di) over an in-memory SQLite database
 * presented as a D1 binding (`toD1Binding`, so production code builds its own
 * drizzle handle exactly as it does on D1). Nothing in the email pipeline is
 * stubbed: the only thing intercepted is the provider's outbound HTTP call,
 * through a global `fetch` double, so the assertions read the request body the
 * provider would actually have received.
 *
 * The seeded tenant carries a DISTINCT identity (display name, Reply-To, brand
 * name, brand colour) and the deployment carries a distinct PLATFORM identity,
 * so any send can be classified by reading its `from` / `reply_to` / HTML.
 */
import { vi } from 'vitest';
import { drizzle as sqliteDrizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { MockKV } from '../mocks';
import { toD1Binding } from './d1-binding';
import { asD1Db } from './test-db';
import * as schema from '../../../server/lib/db/schema';
import { MeteringService } from '../../../server/services/metering.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { HonoConfig } from '../../../server/types/hono';

export type HarnessMode = 'saas' | 'standalone';

export const TENANT_ID = '11111111-0000-4000-8000-000000000001';
export const TENANT_SLUG = 'acme-email';
export const OWNER_ID = '22222222-0000-4000-8000-000000000001';
export const INSPECTOR_ID = '22222222-0000-4000-8000-000000000002';

/** The tenant's own identity: every value differs from the platform's. */
export const TENANT_IDENTITY = {
    companyName: 'Harbor Light Home Inspections',
    senderDisplayName: 'Harbor Light Office',
    replyTo: 'office@harbor-light.test',
    primaryColor: '#0b7a75',
} as const;

/** The deployment's own identity. */
export const PLATFORM_IDENTITY = {
    senderEmail: 'noreply@platform.test',
    appName: 'PlatformMailName',
    resendKey: 're_platform_test_key',
} as const;

export interface CapturedEmail {
    from: string;
    to: string[];
    subject: string;
    html: string;
    reply_to?: string;
    /** The credential the request was sent with (a header, copied here). */
    authorization: string;
}

export interface Harness {
    sqlite: SqliteDatabase;
    db: BetterSQLite3Database<typeof schema>;
    env: HonoConfig['Bindings'];
    /** Every body POSTed to the Resend send endpoint, in order. */
    sent: CapturedEmail[];
    /** Tenant ids the usage meter was asked to count an email for. */
    meteredTenants: () => string[];
    close: () => void;
}

const RESEND_SEND_URL = 'https://api.resend.com/emails';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function toPem(label: string, der: ArrayBuffer): string {
    const b64 = Buffer.from(der).toString('base64');
    const lines = b64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

let keyPairPems: { privatePem: string; publicPem: string } | null = null;

/** One ES256 pair per spec file — generating is cheap but not free. */
async function jwtKeyPems(): Promise<{ privatePem: string; publicPem: string }> {
    if (keyPairPems) return keyPairPems;
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    keyPairPems = { privatePem: toPem('PRIVATE KEY', pkcs8), publicPem: toPem('PUBLIC KEY', spki) };
    return keyPairPems;
}

function bodyText(init: RequestInit | undefined): string {
    const body = init?.body;
    return typeof body === 'string' ? body : '';
}

/**
 * Stub the outbound network: the email provider (recorded), Turnstile
 * verification (always passes — the deployment's own policy decides whether
 * it is asked at all), and nothing else. Any other host answers 404 so a send
 * that leaks somewhere unexpected fails loudly rather than silently passing.
 */
function stubNetwork(sent: CapturedEmail[]): void {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === RESEND_SEND_URL) {
            const authorization = new Headers(init?.headers).get('authorization') ?? '';
            sent.push({ ...(JSON.parse(bodyText(init)) as Omit<CapturedEmail, 'authorization'>), authorization });
            return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200 });
        }
        if (url === TURNSTILE_VERIFY_URL) {
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response('not stubbed', { status: 404 });
    }));
}

/**
 * `toD1Binding` binds positionally, which better-sqlite3 refuses for D1's
 * numbered `?N` placeholders (the plan-quota guard uses them, and a saas
 * booking reaches it). Rewrite each `?N` to a plain `?` and reorder the bound
 * values to match — the same values in the same slots D1 would use.
 */
function withNumberedParams(binding: D1Database): D1Database {
    return new Proxy(binding, {
        get(target, prop, receiver) {
            if (prop !== 'prepare') return Reflect.get(target, prop, receiver) as unknown;
            return (sql: string) => {
                const order = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
                if (order.length === 0) return target.prepare(sql);
                const statement = target.prepare(sql.replace(/\?\d+/g, '?'));
                return new Proxy(statement, {
                    get(stmt, key, r) {
                        if (key !== 'bind') return Reflect.get(stmt, key, r) as unknown;
                        return (...values: unknown[]) => stmt.bind(...order.map((n) => values[n - 1]));
                    },
                });
            };
        },
    });
}

export interface HarnessOptions {
    /** How long ago the tenant signed up. Default: a month, i.e. past any new-company window. */
    tenantAgeMs?: number;
}

export async function createHarness(mode: HarnessMode, options: HarnessOptions = {}): Promise<Harness> {
    const { sqlite } = createTestDb();
    await setupSchema(sqlite);
    const db = sqliteDrizzle(sqlite, { schema });
    const pems = await jwtKeyPems();

    const env = {
        APP_MODE: mode,
        ...(mode === 'standalone' ? { SINGLE_TENANT_ID: TENANT_ID } : {}),
        DB: withNumberedParams(toD1Binding(sqlite)),
        TENANT_CACHE: new MockKV() as unknown as KVNamespace,
        JWT_SECRET: 'j'.repeat(32),
        KEY_ENCRYPTION_SECRET: 'k'.repeat(32),
        JWT_CURRENT_KID: 'v1',
        JWT_PRIVATE_KEY_V1: pems.privatePem,
        JWT_PUBLIC_KEY_V1: pems.publicPem,
        RESEND_API_KEY: PLATFORM_IDENTITY.resendKey,
        SENDER_EMAIL: PLATFORM_IDENTITY.senderEmail,
        APP_NAME: PLATFORM_IDENTITY.appName,
        APP_BASE_URL: 'https://app.platform.test',
        // Cloudflare's documented always-pass test secret.
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    } as unknown as HonoConfig['Bindings'];

    const sent: CapturedEmail[] = [];
    stubNetwork(sent);
    const recordSpy = vi.spyOn(MeteringService.prototype, 'record');

    await seedTenant(db, options.tenantAgeMs ?? 30 * 24 * 60 * 60 * 1000);

    return {
        sqlite,
        db,
        env,
        sent,
        meteredTenants: () => recordSpy.mock.calls
            .filter((call) => call[1] === 'email' || call[1] === 'email_byo')
            .map((call) => call[0]),
        close: () => {
            recordSpy.mockRestore();
            vi.unstubAllGlobals();
            sqlite.close();
        },
    };
}

/** A tenant that signed up `ageMs` ago, with its own identity. */
async function seedTenant(db: BetterSQLite3Database<typeof schema>, ageMs: number): Promise<void> {
    const monthAgo = new Date(Date.now() - ageMs);
    await db.insert(schema.tenants).values({
        id: TENANT_ID, slug: TENANT_SLUG, status: 'active', tier: 'free',
        maxUsers: 5, deploymentMode: 'shared', createdAt: monthAgo,
    });
    await db.insert(schema.users).values([
        { id: OWNER_ID, tenantId: TENANT_ID, email: 'owner@harbor-light.test', passwordHash: 'h', role: 'owner', name: 'Olive Owner', createdAt: monthAgo },
        { id: INSPECTOR_ID, tenantId: TENANT_ID, email: 'ivan@harbor-light.test', passwordHash: 'h', role: 'inspector', name: 'Ivan Inspector', createdAt: monthAgo },
    ]);
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID,
        companyName: TENANT_IDENTITY.companyName,
        senderDisplayName: TENANT_IDENTITY.senderDisplayName,
        replyTo: TENANT_IDENTITY.replyTo,
        primaryColor: TENANT_IDENTITY.primaryColor,
        emailMode: 'platform',
        defaultTimezone: 'America/New_York',
        enableCustomerRepairExport: true,
        updatedAt: monthAgo,
    });
    await seedRoleProfiles(asD1Db(db), TENANT_ID, monthAgo);
}

/** Sign a token the way the agent sign-in routes do: global, no tenant claim. */
export async function mintAgentToken(env: HonoConfig['Bindings'], agentUserId: string): Promise<string> {
    const { buildKeyring, signJwt } = await import('../../../server/lib/jwt-keyring');
    const keyring = await buildKeyring(env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    return signJwt({ sub: agentUserId, role: 'agent', 'custom:userRole': 'agent', iat: now, exp: now + 3600 }, keyring);
}

export interface ObservedIdentity {
    from: string;
    replyTo: string | null;
    tenantBrandInHtml: boolean;
    meteredToTenant: boolean;
}

/**
 * The four facts that say whose voice a send used, read off what the provider
 * received. Compared as ONE object so a red run prints every fact at once.
 */
export function observeIdentity(h: Harness, mail: CapturedEmail | undefined): ObservedIdentity {
    return {
        from: mail?.from ?? '<no email sent>',
        replyTo: mail?.reply_to ?? null,
        tenantBrandInHtml: (mail?.html ?? '').includes(TENANT_IDENTITY.companyName),
        meteredToTenant: h.meteredTenants().includes(TENANT_ID),
    };
}

/** What a send in the tenant's voice looks like (platform transport, tenant identity). */
export const TENANT_VOICE: ObservedIdentity = {
    from: `${TENANT_IDENTITY.senderDisplayName} <${PLATFORM_IDENTITY.senderEmail}>`,
    replyTo: TENANT_IDENTITY.replyTo,
    tenantBrandInHtml: true,
    meteredToTenant: true,
};
