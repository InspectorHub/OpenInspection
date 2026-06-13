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

const ADMIN_EMAIL    = 'admin-seed@seed.test';
const LEAD_EMAIL     = 'inspector-a@seed.test';
const INSPECTOR_B_EMAIL = 'inspector-b@seed.test';
const ADMIN_FULL_EMAIL = 'admin-full@seed.test';
const MULTI_EMAIL    = 'multi-tenant-user@seed.test';
const BRANCH_B_EMAIL = 'branch-b@seed.test';

// PBKDF2-SHA256 of 'seedpassword' with a fixed salt — pre-computed so we
// don't have to import the password helper into a setup script. Format
// matches server/lib/password.ts (salt:iterations:hash all base64).
// Verified manually by hashing 'seedpassword' through the same routine.
const SEED_PASSWORD_HASH =
    'c2VlZHNhbHRzZWVkc2FsdA==:100000:5VlRX7Qd5LRMc+IT5Z3rWUmWzkn29w7Vw31o0kHGymY=';

const TENANT_A_ID = '00000000-0000-0000-0000-000000000aaa';
const TENANT_B_ID = '00000000-0000-0000-0000-000000000bbb';

function d1(sql: string, cwd: string): void {
    const escaped = sql.replaceAll('"', '\\"');
    try {
        execSync(
            `npx wrangler d1 execute openinspection-standalone-db --local --command "${escaped}" --yes`,
            { cwd, stdio: 'pipe' },
        );
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

    // Two tenants so the IdentitySwitcher (E P4) has somewhere to land.
    d1(`INSERT OR REPLACE INTO tenants (id, name, slug, status, deployment_mode, tier, max_users, created_at)
        VALUES ('${TENANT_A_ID}', 'Seed Tenant A', 'seed-a', 'active', 'shared', 'free', 5, '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO tenants (id, name, slug, status, deployment_mode, tier, max_users, created_at)
        VALUES ('${TENANT_B_ID}', 'Seed Tenant B', 'seed-b', 'active', 'shared', 'free', 5, '${now}')`, cwd);

    // Tenant A users.
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('11111111-1111-1111-1111-111111111aa1', '${TENANT_A_ID}',
                '${ADMIN_EMAIL}', '${SEED_PASSWORD_HASH}', 'Seed Admin', 'admin', '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('22222222-2222-2222-2222-222222222aa1', '${TENANT_A_ID}',
                '${LEAD_EMAIL}', '${SEED_PASSWORD_HASH}', 'Lead Inspector', 'inspector', '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('33333333-3333-3333-3333-333333333aa1', '${TENANT_A_ID}',
                '${INSPECTOR_B_EMAIL}', '${SEED_PASSWORD_HASH}', 'Seed Inspector B', 'inspector', '${now}')`, cwd);

    // Seat-quota / at-cap admin for the over-quota E2E.
    d1(`INSERT OR REPLACE INTO tenants (id, name, slug, status, deployment_mode, tier, max_users, created_at)
        VALUES ('00000000-0000-0000-0000-000000000cc1', 'Seed Full Tenant', 'seed-full',
                'active', 'shared', 'free', 1, '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('55555555-5555-5555-5555-555555555cc1', '00000000-0000-0000-0000-000000000cc1',
                '${ADMIN_FULL_EMAIL}', '${SEED_PASSWORD_HASH}', 'At-Cap Admin', 'admin', '${now}')`, cwd);

    // Multi-tenant user for IdentitySwitcher E P4 E2E.
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('66666666-6666-6666-6666-666666666aa1', '${TENANT_A_ID}',
                '${MULTI_EMAIL}', '${SEED_PASSWORD_HASH}', 'Multi-Tenant Primary', 'admin', '${now}')`, cwd);
    d1(`INSERT OR REPLACE INTO users (id, tenant_id, email, password_hash, name, role, created_at)
        VALUES ('77777777-7777-7777-7777-777777777bb1', '${TENANT_B_ID}',
                '${BRANCH_B_EMAIL}', '${SEED_PASSWORD_HASH}', 'Branch B Identity', 'admin', '${now}')`, cwd);

    // Identity link between the two so the switcher dropdown surfaces it.
    d1(`INSERT OR REPLACE INTO user_identity_links
        (id, primary_user_id, linked_user_id, linked_tenant_id, linked_role, linked_display_name, created_at)
        VALUES ('88888888-8888-8888-8888-888888888aa1',
                '66666666-6666-6666-6666-666666666aa1',
                '77777777-7777-7777-7777-777777777bb1',
                '${TENANT_B_ID}', 'admin', 'branch-b@seed.test', '${now}')`, cwd);

    // Inspections — empty / half-done / team / delivered / republished
    // referenced by the E2E spec stubs. Templates intentionally NULL so
    // the editor falls back to the seed template path.
    const inspectionRow = (id: string, addr: string, status: string, tenantId = TENANT_A_ID) =>
        `INSERT OR REPLACE INTO inspections
         (id, tenant_id, inspector_id, property_address, date, status, payment_status,
          price, payment_required, agreement_required, created_at)
         VALUES ('${id}', '${tenantId}',
                 '22222222-2222-2222-2222-222222222aa1', '${addr}',
                 '2026-06-01', '${status}', 'unpaid', 0, 0, 0, '${now}')`;
    d1(inspectionRow('seed-empty-inspection',        '1 Empty St',        'draft'), cwd);
    d1(inspectionRow('seed-half-done-inspection',    '2 Half Done Ave',   'draft'), cwd);
    d1(inspectionRow('seed-team-inspection',         '3 Team Mode Rd',    'draft'), cwd);
    d1(inspectionRow('seed-published-inspection',    '4 Published Way',   'delivered'), cwd);
    d1(inspectionRow('seed-delivered-inspection',    '5 Delivered Ln',    'delivered'), cwd);
    d1(inspectionRow('seed-republished-inspection',  '6 Republished Ct',  'delivered'), cwd);

    console.info('[seed-fixtures] Seeded tenants + 7 users + 6 inspections + 1 identity link.');
}

export const SEED_PASSWORD = 'seedpassword';
export const SEED_EMAILS = {
    admin:        ADMIN_EMAIL,
    lead:         LEAD_EMAIL,
    inspectorB:   INSPECTOR_B_EMAIL,
    adminAtCap:   ADMIN_FULL_EMAIL,
    multiTenant:  MULTI_EMAIL,
    branchB:      BRANCH_B_EMAIL,
};
