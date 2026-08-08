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
import { createHash } from 'crypto';
import { existsSync, rmSync, writeFileSync } from 'fs';
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

/**
 * The CLIENT the delivered report was delivered TO — a recipient, not a user.
 *
 * There is no `users` row for this address and there must not be one: the client
 * portal is a no-login surface reached with a per-(inspection, recipient) token,
 * so a login account would be a different fixture answering a different
 * question. It is deliberately absent from SEED_EMAILS for the same reason —
 * everything in there is loggable.
 */
const CLIENT_RECIPIENT_EMAIL = 'seed-client@seed.test';

/**
 * The plaintext portal token for that recipient, in the clear ON PURPOSE.
 *
 * Production never stores plaintext (see PortalAccessService: hash to look up,
 * `token_enc` to reconstruct, legacy `token` cleared to a sentinel). A fixture
 * has the opposite requirement — a human has to be able to paste a working URL,
 * and a spec has to be able to build one — and the seed cannot produce a
 * `token_enc` anyway: sealing needs the worker's KEK (HKDF over `JWT_SECRET`),
 * which this Node script does not have.
 *
 * So the row is seeded as a LEGACY-shaped-but-hashed one: `token_hash` set (the
 * column the resolver reads first, so nothing mutates on lookup) AND the
 * plaintext left in `token`. That second half is what keeps re-issue working:
 * `PortalAccessService.reconstruct` prefers a non-sentinel plaintext column and
 * only then opens `token_enc`, so any "resend the report link" path returns THIS
 * token instead of throwing "cannot be reconstructed".
 */
const CLIENT_PORTAL_TOKEN    = 'seed-client-portal-token-delivered';
const CLIENT_ACCESS_TOKEN_ID = 'seed-access-token-delivered-client';

/**
 * `token_hash` is a plain SHA-256 hex digest of the UTF-8 token — the same thing
 * `hashToken()` (server/lib/token-hash.ts) computes with WebCrypto. Derived here
 * rather than pasted so the two can never drift.
 */
const CLIENT_PORTAL_TOKEN_HASH = createHash('sha256').update(CLIENT_PORTAL_TOKEN, 'utf8').digest('hex');

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

/**
 * Run SQL from a temp FILE instead of `--command`.
 *
 * `d1()` above collapses whitespace and backslash-escapes every double quote so
 * the statement survives one line of cmd.exe. That is fine for the rows above,
 * which contain no double quotes at all — and it is exactly wrong for the JSON
 * payloads below (a template snapshot, a results projection), where the quotes
 * ARE the data and the escaping is at the mercy of two shells. A file has no
 * quoting layer, and `--file` is how global-setup already drives its multi-
 * statement wipe locally.
 */
function d1Script(sql: string, cwd: string, label: string): void {
    const cfg =
        process.env.WRANGLER_CONFIG ||
        (existsSync(path.join(cwd, 'wrangler.local.jsonc')) ? 'wrangler.local.jsonc' : 'wrangler.jsonc');
    const file = path.join(cwd, `.seed-${label}.sql`);
    writeFileSync(file, sql, 'utf8');
    try {
        execSync(`npx wrangler d1 execute DB --local -c ${cfg} --file "${file}" --yes`, { cwd, stdio: 'pipe' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`d1Script(${label}) failed:\n  ${msg}`);
    } finally {
        rmSync(file, { force: true });
    }
}

/**
 * The published content of `seed-delivered-inspection` — the ONE fixture that
 * makes the client-facing repair-request builder reachable.
 *
 * It lives on the INSPECTION as `template_snapshot`, not in a `templates` row,
 * because that is the shape every reader prefers: `getReportData` takes
 * `inspections.template_snapshot` over `template.schema` whenever it has
 * sections, and the snapshot is what an inspection actually carries once it has
 * been created. One fixture row instead of two, and it exercises the path
 * production reads.
 *
 * Every defect is `default: true`, which is what puts it in the report with no
 * per-inspection state at all (`resolveTab`: a state row wins, otherwise the
 * template's `default` flag decides). `inspection_results` below then adds
 * ratings and a trade on top — those change how a row LOOKS, never whether it
 * exists, so the builder still has content if that row is ever lost.
 *
 * Shape deliberately: 6 defects over 4 items in 2 SECTIONS. One section would
 * leave the section sort with nothing to sort, and a single defect would hide
 * the two-defects-on-one-item case (`findingKey` collision ordinals) that this
 * page has to render distinguishably.
 */
const DELIVERED_TEMPLATE_SNAPSHOT = {
    schemaVersion: 2,
    // Path 2 of getReportData's rating resolution (the results row leaves
    // `rating_system_snapshot` NULL on purpose). `severity` is the field that
    // decides `severityBucket` — good/marginal/significant map to
    // satisfactory/monitor/defect — so the builder's Severity sort has 3 axes.
    ratingSystem: {
        levels: [
            { id: 'satisfactory', label: 'Satisfactory', abbreviation: 'S', color: '#16a34a', severity: 'good',        isDefect: false },
            { id: 'monitor',      label: 'Monitor',      abbreviation: 'M', color: '#d97706', severity: 'marginal',    isDefect: false },
            { id: 'defect',       label: 'Defect',       abbreviation: 'D', color: '#dc2626', severity: 'significant', isDefect: true  },
        ],
    },
    sections: [
        {
            id: 'roof',
            title: 'Roof',
            items: [
                {
                    id: 'roof-covering',
                    label: 'Roof Covering',
                    type: 'rich',
                    ratingOptions: ['satisfactory', 'monitor', 'defect'],
                    tabs: {
                        information: [],
                        limitations: [],
                        // Two defects on ONE item — the case the row layout
                        // exists to disambiguate (defect title above the item
                        // label). Never reduce this to one.
                        defects: [
                            {
                                id: 'roof-d1',
                                title: 'Cracked shingles at the ridge',
                                category: 'safety',
                                location: 'South slope, near the ridge',
                                comment: 'Several shingles along the ridge line are cracked and lifting. Water entry is likely during wind-driven rain.',
                                photos: [],
                                default: true,
                            },
                            {
                                id: 'roof-d2',
                                title: 'Loose flashing at the chimney',
                                category: 'maintenance',
                                location: 'Chimney base, north side',
                                comment: 'The step flashing at the chimney is loose and the sealant has failed.',
                                photos: [],
                                default: true,
                            },
                        ],
                    },
                },
                {
                    id: 'gutters',
                    label: 'Gutters and Downspouts',
                    type: 'rich',
                    ratingOptions: ['satisfactory', 'monitor', 'defect'],
                    tabs: {
                        information: [],
                        limitations: [],
                        defects: [
                            {
                                id: 'gutters-d1',
                                title: 'Downspout discharges against the foundation',
                                category: 'recommendation',
                                location: 'Northeast corner',
                                comment: 'Extend the downspout so it discharges at least four feet from the foundation wall.',
                                photos: [],
                                default: true,
                            },
                        ],
                    },
                },
            ],
        },
        {
            id: 'electrical',
            title: 'Electrical',
            items: [
                {
                    id: 'service-panel',
                    label: 'Service Panel',
                    type: 'rich',
                    ratingOptions: ['satisfactory', 'monitor', 'defect'],
                    tabs: {
                        information: [],
                        limitations: [],
                        defects: [
                            {
                                id: 'panel-d1',
                                title: 'Double-tapped breaker',
                                category: 'safety',
                                location: 'Main panel, breaker 14',
                                comment: 'Two conductors share a breaker that is rated for one. Separate the circuits.',
                                photos: [],
                                default: true,
                            },
                            {
                                id: 'panel-d2',
                                title: 'Missing panel cover screws',
                                category: 'maintenance',
                                location: 'Main panel cover',
                                comment: 'Two cover screws are missing. Replace with blunt-tip screws.',
                                photos: [],
                                default: true,
                            },
                        ],
                    },
                },
                {
                    id: 'receptacles',
                    label: 'Receptacles and Switches',
                    type: 'rich',
                    ratingOptions: ['satisfactory', 'monitor', 'defect'],
                    tabs: {
                        information: [],
                        limitations: [],
                        defects: [
                            {
                                id: 'recept-d1',
                                title: 'No GFCI protection at the kitchen counter',
                                category: 'safety',
                                location: 'Kitchen, counter run left of the sink',
                                comment: 'Countertop receptacles within six feet of the sink are not GFCI protected.',
                                photos: [],
                                default: true,
                            },
                        ],
                    },
                },
            ],
        },
    ],
};

/**
 * Per-item state for the delivered inspection: ratings (so the Severity sort has
 * three different buckets to order) plus a `trade` on two defects (so the
 * add-item snapshot carries one, as it does in the field).
 *
 * Keys are the composite finding key `_default:{sectionId}:{itemId}` —
 * `findingKey()` in server/lib/finding-key.ts. A bare itemId still resolves
 * (readItemEntry falls back to it) but the composite form is what the editor
 * writes, and a fixture that used the fallback would be testing the fallback.
 *
 * `receptacles` is deliberately absent: an unrated item lands in the `other`
 * bucket, and its defect is still on the list — that is the case a fixture where
 * everything is rated would never show.
 */
const DELIVERED_RESULTS_DATA = {
    '_default:roof:roof-covering': {
        rating: 'defect',
        notes: 'Ridge line examined from a ladder at the eave.',
        tabs: {
            defects: [
                { cannedId: 'roof-d1', included: true, trade: 'licensed-roofer' },
                { cannedId: 'roof-d2', included: true, trade: 'general-contractor' },
            ],
        },
    },
    '_default:roof:gutters': {
        rating: 'monitor',
        tabs: { defects: [{ cannedId: 'gutters-d1', included: true, trade: 'qualified-handyman' }] },
    },
    '_default:electrical:service-panel': {
        rating: 'defect',
        tabs: { defects: [{ cannedId: 'panel-d1', included: true, trade: 'licensed-electrician' }] },
    },
} as const;

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

    // ---------------------------------------------------------------------
    // publish → deliver → client link, for `seed-delivered-inspection`
    //
    // The builder page (`/repair-builder/:tenant/:id?token=`) is gated on
    // exactly three things (runBuilderGate + resolveBuilderAccess), and it was
    // unreachable locally because the seed supplied none of them:
    //   1. inspections.report_status = 'published'   — already true above
    //   2. tenant_configs.is_customer_repair_export_enabled  — added here
    //   3. a live inspection_access_tokens row       — added here
    // Plus content: the gate can pass and still render an empty list, which is
    // why the template snapshot + results go in too.
    //
    // NOT seeded, because nothing on this path reads it: a `reports` row. The
    // publish gate reads `inspections.report_status`, and the share gate
    // (runShareGate) reads the repair request + that same column. `reports` only
    // becomes load-bearing for multi-deliverable publish targeting.
    // ---------------------------------------------------------------------

    // Tenant config — the feature flag is the whole reason this row exists, but
    // company_name is set alongside it so the row is not a half-configured
    // workspace (every reader falls back with `||`, so NULL would also work).
    d1(`INSERT OR REPLACE INTO tenant_configs (tenant_id, company_name, is_customer_repair_export_enabled, updated_at)
        VALUES ('${TENANT_A_ID}', 'Seed Tenant A', 1, ${nowMs})`, cwd);

    // The `client` role profile. `resolveBuilderAccess` maps the token's role KEY
    // to a role-profile KIND (`getRoleKind`) and refuses anything that is not
    // client or agent — so with no profile row the token resolves and is then
    // rejected, which looks exactly like a bad token. Only the one key this path
    // needs is seeded; the other seven come from `seedRoleProfiles` at workspace
    // setup, which the seeded run never performs.
    d1(`INSERT OR REPLACE INTO contact_role_profiles
         (id, tenant_id, key, label, kind, is_system, sort_order, is_active, created_at, updated_at)
         VALUES ('crp_${TENANT_A_ID}_client', '${TENANT_A_ID}', 'client', 'Client', 'client',
                 1, 10, 1, ${nowMs}, ${nowMs})`, cwd);

    // The live client access token. expires_at NULL = open (the order is active);
    // revoked_at NULL = live. Both are read numerically by the guard, and NULL is
    // the only value that means "not set" — a 0 would read as 1970 and revoke it.
    d1(`INSERT OR REPLACE INTO inspection_access_tokens
         (id, tenant_id, inspection_id, recipient_email, role, token, created_at,
          expires_at, revoked_at, token_hash, token_enc, view_tracking_objected_at)
         VALUES ('${CLIENT_ACCESS_TOKEN_ID}', '${TENANT_A_ID}', '${SEED_INSPECTIONS.delivered}',
                 '${CLIENT_RECIPIENT_EMAIL}', 'client', '${CLIENT_PORTAL_TOKEN}', ${nowMs},
                 NULL, NULL, '${CLIENT_PORTAL_TOKEN_HASH}', NULL, NULL)`, cwd);

    // Report content. Both payloads are JSON, so they go through d1Script (see
    // its comment) rather than the single-line --command path.
    d1Script(
        `UPDATE inspections SET template_snapshot = '${JSON.stringify(DELIVERED_TEMPLATE_SNAPSHOT)}'\n` +
        `WHERE id = '${SEED_INSPECTIONS.delivered}' AND tenant_id = '${TENANT_A_ID}';\n`,
        cwd, 'delivered-snapshot',
    );
    d1Script(
        `INSERT OR REPLACE INTO inspection_results\n` +
        `  (id, tenant_id, inspection_id, data, ydoc_state, last_synced_at, rating_system_id, rating_system_snapshot, report_id)\n` +
        `VALUES ('seed-delivered-results', '${TENANT_A_ID}', '${SEED_INSPECTIONS.delivered}',\n` +
        `        '${JSON.stringify(DELIVERED_RESULTS_DATA)}', NULL, ${nowMs}, NULL, NULL, NULL);\n`,
        cwd, 'delivered-results',
    );

    console.info(
        `[seed-fixtures] Seeded tenants + 8 users + ${Object.keys(SEED_INSPECTIONS).length} inspections` +
        ` + the delivered client link (${SEED_REPAIR_DEFECTS.length} defects in` +
        ` ${new Set(SEED_REPAIR_DEFECTS.map((d) => d.sectionTitle)).size} sections).`,
    );
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
    /**
     * Published AND delivered to a client: it carries the report content
     * (template snapshot + results), the tenant repair-export flag, and a live
     * client portal token. It is the only fixture the no-login client surfaces
     * (`/repair-builder/…`, `/report-view/…?token=`) can be reached with — see
     * SEED_CLIENT_ACCESS.
     */
    delivered:   'seed-delivered-inspection',
    /** Commercial, so a unit can be added between two publishes to make a diff. */
    republished: 'seed-republished-inspection',
};

/**
 * The client's no-login access to `SEED_INSPECTIONS.delivered`.
 *
 * `builderUrl` is paste-ready for a local `npm run dev` (port 8787). Specs use
 * `builderPath` instead, because Playwright's baseURL is the E2E worker on 8789
 * and hardcoding a port there is how a spec ends up loading a page nothing
 * served. Both are derived from the same three values, so they cannot disagree.
 */
export const SEED_CLIENT_ACCESS = {
    /** Recipient of the delivered report. NOT a login account — see the constant. */
    email: CLIENT_RECIPIENT_EMAIL,
    /** Plaintext portal token, live and open-ended. */
    token: CLIENT_PORTAL_TOKEN,
    inspectionId: SEED_INSPECTIONS.delivered,
    tenantSlug: TENANT_A_SLUG,
    /** Root-relative — use this from a spec (Playwright supplies the origin). */
    builderPath:
        `/repair-builder/${TENANT_A_SLUG}/${SEED_INSPECTIONS.delivered}?token=${CLIENT_PORTAL_TOKEN}`,
    /** Absolute, for a human running `npm run dev`. */
    builderUrl:
        `http://localhost:8787/repair-builder/${TENANT_A_SLUG}/${SEED_INSPECTIONS.delivered}?token=${CLIENT_PORTAL_TOKEN}`,
};

/**
 * The defects the delivered report publishes, flattened the way the builder
 * receives them — derived from the snapshot rather than restated, so a spec that
 * counts rows counts what was actually seeded.
 *
 * `findingKey` is NOT here on purpose: the server composes it
 * (`{source}:{sectionId}:{itemId}:{recommendationId|'custom'}`, plus a collision
 * ordinal) and a fixture that recomputed the format would pass while the real
 * one changed underneath it.
 */
export const SEED_REPAIR_DEFECTS: Array<{
    sectionTitle: string;
    itemLabel: string;
    defectTitle: string;
    category: string;
}> = DELIVERED_TEMPLATE_SNAPSHOT.sections.flatMap((section) =>
    section.items.flatMap((item) =>
        item.tabs.defects.map((defect) => ({
            sectionTitle: section.title,
            itemLabel: item.label,
            defectTitle: defect.title,
            category: defect.category,
        })),
    ),
);
