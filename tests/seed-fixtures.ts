/**
 * Design System 0520 P10 — E2E seed fixtures.
 *
 * Spawns a fresh standalone workspace + admin + a couple of inspectors +
 * a few inspections so the test.skip E2E specs across C/D/E can be
 * unskipped and run against `npm run dev`.
 *
 * Invoked from tests/global-setup.ts AFTER the table-truncate step.
 * Idempotent — re-running with the same fixture ids is a no-op.
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const ADMIN_EMAIL    = 'admin-seed@seed.test';
const LEAD_EMAIL     = 'inspector-a@seed.test';
const INSPECTOR_B_EMAIL = 'inspector-b@seed.test';
/**
 * The inspector who OWNS `seed-half-done-inspection`.
 *
 * The "half" names the INSPECTION, not a seat/quota allowance — read off the
 * subsystem-E assertions rather than the address of the name: the only spec
 * that logs in as this account immediately opens
 * `/inspections/seed-half-done-inspection/...` and asserts the publish
 * pre-flight gates FAIL. It is the inspector standing in front of a half-filled
 * report, and nothing in any spec touches seats. (The at-cap seat fixture is
 * `admin-full@seed.test`, which is a separate tenant with max_users = 1.)
 */
const INSPECTOR_HALF_EMAIL = 'inspector-half@seed.test';
const ADMIN_FULL_EMAIL = 'admin-full@seed.test';
const MULTI_EMAIL    = 'multi-tenant-user@seed.test';
const BRANCH_B_EMAIL = 'branch-b@seed.test';

// PBKDF2-SHA256 of 'seedpassword' — pre-computed so this setup script does not
// have to import the password helper.
//
// The format is `pbkdf2:hex(salt):hex(hash)`, exactly what `hashPassword()` in
// server/lib/password.ts emits: a `pbkdf2:` PREFIX, hex (not base64), and no
// iterations field (they are fixed at 100_000 in that module). The prefix is
// load-bearing rather than decorative — `verifyPassword()` branches on it, and
// without it every stored value falls through to the legacy plain-SHA-256
// comparison, which no pbkdf2 digest can ever satisfy. A previous value here
// was base64 with an iterations segment and no prefix, so it took that legacy
// branch and NO seeded account could log in.
//
// The salt is the ASCII string `seedsaltseedsalt` so this stays reproducible:
//   node -e "console.log(require('crypto').pbkdf2Sync('seedpassword',
//     Buffer.from('seedsaltseedsalt'), 100000, 32, 'sha256').toString('hex'))"
const SEED_PASSWORD_HASH =
    'pbkdf2:7365656473616c747365656473616c74:75505a5ed1b1d3f91d138d9a55f63a6a546cff94f02ef47b8cc763009b8cb551';

/**
 * Tenant A IS the standalone workspace, not a workspace beside it.
 *
 * `POST /api/auth/login` in standalone mode looks the user up under
 * `SINGLE_TENANT_ID || '00000000-0000-0000-0000-000000000000'` (server/api/auth.ts)
 * — the tenant is never derived from the submitted email. A fixture user in any
 * other tenant is therefore unloggable by construction, whatever its password
 * hash says. Tenant A used to be `…0aaa`, so even a correct hash could not have
 * produced a session.
 *
 * Tenant B stays a genuinely separate tenant: it exists to give the multi-tenant
 * fixtures a second workspace to be switched INTO, which is a portal/SaaS flow,
 * not a standalone password login.
 */
const TENANT_A_ID = '00000000-0000-0000-0000-000000000000';
const TENANT_B_ID = '00000000-0000-0000-0000-000000000bbb';

/** Tenant A's slug — the public report/booking URLs are keyed by it. */
const TENANT_A_SLUG = 'seed-a';

const LEAD_INSPECTOR_ID = '22222222-2222-2222-2222-222222222aa1';
const HALF_INSPECTOR_ID = '44444444-4444-4444-4444-444444444aa1';

/**
 * Address the DB the way global-setup does: by BINDING (`DB`) against the same
 * wrangler config the worker was built from.
 *
 * Both halves are load-bearing and both were wrong here. `openinspection-standalone-db`
 * is not a database in any config in this repo (the name is `openinspection-db`,
 * the binding is `DB`), and without `-c` wrangler auto-discovers only
 * `wrangler.jsonc` — so a run driven by `WRANGLER_CONFIG` or `wrangler.local.jsonc`
 * would target a different persisted SQLite than the worker reads. This is the
 * identical mistake global-setup.ts documents having made and fixed; the fix was
 * never carried across to this file, so `seedFixtures` threw on its very first
 * statement and global-setup swallowed it as a warning.
 */
function d1Command(cwd: string): (sql: string) => string {
    const cfg =
        process.env.WRANGLER_CONFIG ||
        (existsSync(path.join(cwd, 'wrangler.local.jsonc')) ? 'wrangler.local.jsonc' : 'wrangler.jsonc');
    // Collapse the whitespace of these multi-line template literals: on Windows
    // execSync spawns through cmd.exe, where an embedded newline ends the command.
    return (sql: string) => {
        const flat = sql.replace(/\s+/g, ' ').trim().replaceAll('"', '\\"');
        return `npx wrangler d1 execute DB --local -c ${cfg} --command "${flat}" --yes`;
    };
}

function d1(sql: string, cwd: string): void {
    try {
        execSync(d1Command(cwd)(sql), { cwd, stdio: 'pipe' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Re-raise so the setup fails loudly when a fixture row violates
        // schema invariants — that's a bug worth surfacing.
        throw new Error(`d1() failed: ${sql.slice(0, 120)}…\n  ${msg}`);
    }
}

export function seedFixtures(appDir: string): void {
    const cwd = appDir;
    const now = new Date().toISOString();
    // Epoch-ms form for the timestamp_ms columns (the Schema Rules default for
    // every new table); the older tables above still hold ISO text.
    const nowMs = Date.now();

    // Two tenants — Tenant A is the default; Tenant B backs the branch-B fixture user below.
    d1(`INSERT OR REPLACE INTO tenants (id, name, slug, status, deployment_mode, tier, max_users, created_at)
        VALUES ('${TENANT_A_ID}', 'Seed Tenant A', 'seed-a', 'active', 'shared', 'free', 5, '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO tenants (id, name, slug, status, deployment_mode, tier, max_users, created_at)
        VALUES ('${TENANT_B_ID}', 'Seed Tenant B', 'seed-b', 'active', 'shared', 'free', 5, '${now}')`, cwd);

    // Tenant A users.
    //
    // Roles come from ROLES in server/lib/auth/roles.ts — owner / manager /
    // inspector / agent. These rows previously said `admin`, which is not one of
    // them: `requireRole('owner', …)` never matches it and `getCapabilities()`
    // indexes ROLE_DEFAULTS by role, so an `admin` row has NO capability set at
    // all. The drizzle `{ enum: [...] }` is type-layer only and costs no DDL, so
    // SQLite accepted the value and the damage only showed up as authorization
    // failures far from here.
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('11111111-1111-1111-1111-111111111aa1', '${TENANT_A_ID}',
                '${ADMIN_EMAIL}', '${SEED_PASSWORD_HASH}', 'Seed Admin', 'owner', '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('22222222-2222-2222-2222-222222222aa1', '${TENANT_A_ID}',
                '${LEAD_EMAIL}', '${SEED_PASSWORD_HASH}', 'Lead Inspector', 'inspector', '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('33333333-3333-3333-3333-333333333aa1', '${TENANT_A_ID}',
                '${INSPECTOR_B_EMAIL}', '${SEED_PASSWORD_HASH}', 'Seed Inspector B', 'inspector', '${now}')`, cwd);
    // Owner of the half-done inspection below — see the constant's comment.
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('${HALF_INSPECTOR_ID}', '${TENANT_A_ID}',
                '${INSPECTOR_HALF_EMAIL}', '${SEED_PASSWORD_HASH}', 'Half-Done Inspector', 'inspector', '${now}')`, cwd);

    // One credential on the lead inspector so the published report's cover has a
    // badge line to render (subsystem-E P8). Text-only (no image_r2_key): OI
    // ships no association trademark assets, and the report renders
    // "label #member" for a text credential.
    d1(`INSERT OR REPLACE INTO inspector_credentials
         (id, tenant_id, user_id, label, member_number, image_r2_key, sort_order, is_active, created_at, updated_at)
         VALUES ('seed-credential-lead', '${TENANT_A_ID}', '${LEAD_INSPECTOR_ID}',
                 'InterNACHI CPI', 'NACHI-24-0001', NULL, 0, 1, ${nowMs}, ${nowMs})`, cwd);

    // Seat-quota / at-cap admin for the over-quota E2E.
    d1(`INSERT OR REPLACE INTO tenants (id, name, slug, status, deployment_mode, tier, max_users, created_at)
        VALUES ('00000000-0000-0000-0000-000000000cc1', 'Seed Full Tenant', 'seed-full',
                'active', 'shared', 'free', 1, '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('55555555-5555-5555-5555-555555555cc1', '00000000-0000-0000-0000-000000000cc1',
                '${ADMIN_FULL_EMAIL}', '${SEED_PASSWORD_HASH}', 'At-Cap Admin', 'owner', '${now}')`, cwd);

    // Multi-tenant fixture users (tenant A primary + tenant B branch).
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('66666666-6666-6666-6666-666666666aa1', '${TENANT_A_ID}',
                '${MULTI_EMAIL}', '${SEED_PASSWORD_HASH}', 'Multi-Tenant Primary', 'owner', '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('77777777-7777-7777-7777-777777777bb1', '${TENANT_B_ID}',
                '${BRANCH_B_EMAIL}', '${SEED_PASSWORD_HASH}', 'Branch B Identity', 'owner', '${now}')`, cwd);

    // Inspections — empty / half-done / team / published / delivered / republished
    // referenced by the E2E spec stubs. Templates intentionally NULL so
    // the editor falls back to the seed template path.
    //
    // Column names and status values are BOTH the current ones. This row used to
    // name `price` / `payment_required` / `agreement_required` (now `price_cents`
    // / `is_payment_required` / `is_agreement_required`) and to pass `draft` and
    // `delivered` as the order status — neither is in INSPECTION_STATUS
    // (requested / scheduled / confirmed / completed / cancelled); "published" is
    // a REPORT status, which is the separate column set alongside it here.
    //
    // `propertyType` is load-bearing, not decoration: the editor only renders the
    // units surface (scope breadcrumb + Units drawer) when it is exactly
    // 'commercial' (`showUnitsSurface` in app/routes/inspection-edit.tsx), so the
    // subsystem-D unit flows have nothing to drive without it.
    const inspectionRow = (
        id: string,
        addr: string,
        status: string,
        reportStatus: string,
        opts: { tenantId?: string; inspectorId?: string; propertyType?: string } = {},
    ) => {
        const tenantId     = opts.tenantId ?? TENANT_A_ID;
        const inspectorId  = opts.inspectorId ?? LEAD_INSPECTOR_ID;
        const propertyType = opts.propertyType ?? 'residential';
        return `INSERT OR REPLACE INTO inspections
         (id, tenant_id, inspector_id, property_address, property_type, date, status, report_status, payment_status,
          price_cents, is_payment_required, is_agreement_required, created_at)
         VALUES ('${id}', '${tenantId}',
                 '${inspectorId}', '${addr}', '${propertyType}',
                 '2026-06-01', '${status}', '${reportStatus}', 'unpaid', 0, 0, 0, '${now}')`;
    };
    d1(inspectionRow('seed-empty-inspection',        '1 Empty St',        'scheduled', 'in_progress',
        { propertyType: 'commercial' }), cwd);
    d1(inspectionRow('seed-half-done-inspection',    '2 Half Done Ave',   'scheduled', 'in_progress',
        { inspectorId: HALF_INSPECTOR_ID }), cwd);
    d1(inspectionRow('seed-team-inspection',         '3 Team Mode Rd',    'scheduled', 'in_progress'), cwd);
    d1(inspectionRow('seed-published-inspection',    '4 Published Way',   'completed', 'published'), cwd);
    d1(inspectionRow('seed-delivered-inspection',    '5 Delivered Ln',    'completed', 'published'), cwd);
    d1(inspectionRow('seed-republished-inspection',  '6 Republished Ct',  'completed', 'published',
        { propertyType: 'commercial' }), cwd);

    console.info('[seed-fixtures] Seeded tenants + 8 users + 6 inspections.');
}

export const SEED_PASSWORD = 'seedpassword';
export const SEED_EMAILS = {
    admin:         ADMIN_EMAIL,
    lead:          LEAD_EMAIL,
    inspectorB:    INSPECTOR_B_EMAIL,
    inspectorHalf: INSPECTOR_HALF_EMAIL,
    adminAtCap:    ADMIN_FULL_EMAIL,
    multiTenant:   MULTI_EMAIL,
    branchB:       BRANCH_B_EMAIL,
};
export const SEED_TENANT_SLUG = TENANT_A_SLUG;
/** Fixture inspection ids the subsystem-D/E specs address by name. */
export const SEED_INSPECTIONS = {
    /** Commercial → the editor renders the units surface. */
    empty:       'seed-empty-inspection',
    /** Owned by `inspector-half@seed.test`; fails every publish pre-flight gate. */
    halfDone:    'seed-half-done-inspection',
    published:   'seed-published-inspection',
    delivered:   'seed-delivered-inspection',
    /** Commercial, so a unit can be added between two publishes to make a diff. */
    republished: 'seed-republished-inspection',
};
