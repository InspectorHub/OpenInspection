#!/usr/bin/env node
/**
 * Bring LOCAL D1 to the standard state for Chrome / manual E2E review.
 *
 *   node scripts/seed-local-e2e.mjs              # restore snapshot + migrate + fixtures
 *   node scripts/seed-local-e2e.mjs --no-restore # migrate + fixtures over current DB
 *   node scripts/seed-local-e2e.mjs --list       # show available snapshots
 *
 * WHY A SNAPSHOT AND A SQL FILE, not one or the other:
 *
 * Stripe credentials live in `tenant_configs.secrets_enc` / `dek_enc`,
 * encrypted with a key derived from JWT_SECRET. They cannot be reconstructed
 * from a committed SQL file, and they must never be IN one. So the Stripe-
 * bearing state comes from a binary snapshot under the gitignored
 * `local-fixtures/`, and everything non-secret comes from
 * `scripts/fixtures/local-e2e.sql`, which is committed and reviewable.
 *
 * The two halves are deliberately separate: re-running fixtures is safe and
 * frequent, restoring a snapshot is destructive and occasional.
 *
 * Running the E2E suite WIPES local D1 (tests/global-setup.ts clears every
 * table so `POST /api/auth/setup` does not 409 on the next run). That is why
 * this script exists — after any E2E run, local review state is gone and had
 * been rebuilt by hand each time.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_DIR = resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = resolve(APP_DIR, '..', '..', 'local-fixtures');
const STATE_DIR = join(APP_DIR, '.wrangler', 'state');
const CONFIG = process.env.WRANGLER_CONFIG || 'wrangler.jsonc';

/** Snapshot carrying a tenant with Stripe configured. Override with --snapshot. */
const DEFAULT_SNAPSHOT = 'oi-local-d1-backup-stripe';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f, d) => {
    const i = args.indexOf(f);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

function listSnapshots() {
    if (!existsSync(FIXTURE_ROOT)) return [];
    return readdirSync(FIXTURE_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
}

if (has('--list')) {
    const snaps = listSnapshots();
    console.log(snaps.length ? snaps.map((s) => `  ${s}`).join('\n') : '  (none — local-fixtures/ is empty)');
    process.exit(0);
}

function wrangler(cmdArgs, opts = {}) {
    return execFileSync(process.execPath, [join(import.meta.dirname, 'wrangler.mjs'), ...cmdArgs], {
        cwd: APP_DIR,
        env: { ...process.env, WRANGLER_CONFIG: CONFIG },
        stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        encoding: 'utf8',
    });
}

/**
 * Run a read query and return its rows.
 *
 * Goes through a temp .sql FILE rather than `--command`, because
 * scripts/wrangler.mjs spawns with `shell: true` — the shell re-parses argv, so
 * a `--command "SELECT a FROM b"` arrives as five separate arguments and
 * wrangler rejects it. Nothing else in the repo passes a spaced argument
 * through that shim, which is why the quirk has gone unnoticed.
 */
function queryAll(sql) {
    const tmp = join(APP_DIR, `.seed-query-${Date.now()}.tmp.sql`);
    writeFileSync(tmp, sql, 'utf8');
    try {
        const out = wrangler(['d1', 'execute', 'DB', '--local', '--json', '--file', tmp], { quiet: true });
        // The JSON payload starts at the first '['; wrangler prefixes banner lines.
        const start = out.indexOf('[');
        if (start < 0) return [];
        return JSON.parse(out.slice(start))?.[0]?.results ?? [];
    } catch {
        return [];
    } finally {
        rmSync(tmp, { force: true });
    }
}

const queryOne = (sql) => queryAll(sql)[0];

// ── 1. Restore the Stripe-bearing snapshot ────────────────────────────────
if (!has('--no-restore')) {
    const snapshot = valueOf('--snapshot', DEFAULT_SNAPSHOT);
    const src = join(FIXTURE_ROOT, snapshot);
    if (!existsSync(src)) {
        console.error(`✘ snapshot not found: ${src}`);
        console.error(`  available: ${listSnapshots().join(', ') || '(none)'}`);
        console.error('  run with --no-restore to seed over the current database instead.');
        process.exit(1);
    }
    // Destructive, and the only destructive step — say so before doing it.
    console.log(`→ restoring ${snapshot} → .wrangler/state (replaces local D1)`);
    rmSync(STATE_DIR, { recursive: true, force: true });
    cpSync(join(src, 'v3'), join(STATE_DIR, 'v3'), { recursive: true });
}

// ── 2. Migrate ────────────────────────────────────────────────────────────
// The snapshot predates any migration added since it was taken, so this is
// not optional. Idempotent via the d1_migrations ledger.
// Invokes the wrangler shim directly rather than shelling out to `npm run
// db:migrate`: npm is not vendored into the app's node_modules, so going
// through it only worked when a global npm happened to resolve.
console.log('→ applying migrations');
wrangler(['d1', 'migrations', 'apply', 'DB', '--local'], { quiet: true });

// ── 3. Resolve the ids the fixtures hang off ──────────────────────────────
// Bound at run time rather than hardcoded: the tenant and inspections come
// from whichever snapshot was restored, and hardcoding them would silently
// produce orphan rows against a different snapshot.
const tenant = queryOne('SELECT id FROM tenants LIMIT 1');
if (!tenant?.id) {
    console.error('✘ no tenant in local D1 — restore a snapshot first (omit --no-restore).');
    process.exit(1);
}
const inspections = queryAll('SELECT id FROM inspections ORDER BY created_at LIMIT 2').map((r) => r.id);

if (inspections.length < 2) {
    console.error(`✘ need at least 2 inspections to hang fixtures off; found ${inspections.length}.`);
    console.error('  The review needs one inspection with people+invoice and a second for the');
    console.error('  cross-inspection agent referral count. Create them, or restore a fuller snapshot.');
    process.exit(1);
}

// ── 4. Apply fixtures ─────────────────────────────────────────────────────
const sqlTemplate = readFileSync(join(import.meta.dirname, 'fixtures', 'local-e2e.sql'), 'utf8');
// Named placeholders are substituted here rather than passed as bind params:
// `d1 execute --file` takes no parameters, and these are ids we just read out
// of the same database, not user input.
const sql = sqlTemplate
    .replaceAll(':TENANT', `'${tenant.id}'`)
    .replaceAll(':INSP_A', `'${inspections[0]}'`)
    .replaceAll(':INSP_B', `'${inspections[1]}'`);

const tmp = join(APP_DIR, '.seed-local-e2e.tmp.sql');
writeFileSync(tmp, sql, 'utf8');
try {
    console.log('→ applying fixtures');
    wrangler(['d1', 'execute', 'DB', '--local', '--file', tmp], { quiet: true });
} finally {
    rmSync(tmp, { force: true });
}

// ── 5. Report what the reviewer actually has ──────────────────────────────
const counts = queryOne(`SELECT
  (SELECT COUNT(*) FROM users WHERE tenant_id IS NOT NULL) members,
  (SELECT COUNT(*) FROM contacts) contacts,
  (SELECT COUNT(*) FROM inspection_access_tokens WHERE revoked_at IS NULL) live_links,
  (SELECT COUNT(*) FROM invoices) invoices,
  (SELECT COUNT(*) FROM tenant_configs WHERE secrets_enc IS NOT NULL) stripe_configured`);

console.log('\n✓ local D1 ready for review');
console.log(`  tenant           ${tenant.id}`);
console.log(`  members          ${counts?.members ?? '?'}`);
console.log(`  contacts         ${counts?.contacts ?? '?'}  (client / agent / other / no-email)`);
console.log(`  live report links${String(counts?.live_links ?? '?').padStart(2)}`);
console.log(`  invoices         ${counts?.invoices ?? '?'}  (paid / unpaid / no-inspection)`);
console.log(`  stripe           ${counts?.stripe_configured ? 'configured' : 'NOT configured'}`);
if (!counts?.stripe_configured) {
    console.log('\n  ⚠ Stripe is not configured in this database. Payment flows will not work.');
    console.log('    Restore a snapshot that has it (--list), or configure it via Settings once');
    console.log('    and re-snapshot — it cannot be seeded from the committed SQL by design.');
}
