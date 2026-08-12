import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { run, info, step, warn, die } from './cloudflare-exec.js';

// =============================================================================
// OpenInspection — Cloudflare Setup: wrangler config bootstrap + D1 seeding
// =============================================================================

// wrangler.local.jsonc is gitignored — generated from wrangler.jsonc on first
// setup. Real D1 / KV / R2 IDs are patched into the local copy further below;
// the template stays untouched and tracked in git so self-hosters always have
// a known-good starting point.
export function ensureTomlExists({ TOML_PATH, TOML_EXAMPLE_PATH }) {
    if (fs.existsSync(TOML_PATH)) return;
    if (!fs.existsSync(TOML_EXAMPLE_PATH)) {
        die(`Neither ${TOML_PATH} nor ${TOML_EXAMPLE_PATH} found — cannot bootstrap wrangler config.`);
    }
    fs.copyFileSync(TOML_EXAMPLE_PATH, TOML_PATH);
    info(`Created ${path.basename(TOML_PATH)} from ${path.basename(TOML_EXAMPLE_PATH)}`);
}

export function seedDatabase({ initialCompany, initialSubdomain, initialEmail, initialPassHash, isLocal, DB_NAME, TOML_PATH }) {
    step("Performing automated database seeding...");
    const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
    const effectiveSubdomain = (initialSubdomain || initialCompany.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).toLowerCase();
    const tenantId = SYSTEM_TENANT_ID;
    const userId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // Three things this statement got wrong, all of them silent until first run:
    //
    //   `subdomain` has not been a column on `tenants` for some time — this
    //   insert could never have succeeded against the current schema, so the
    //   very first thing a self-hoster ran was already failing here.
    //
    //   `name` is gone too; the company name lives in `tenant_configs`, which
    //   is why a second statement now writes it there.
    //
    //   `admin` is not one of the four roles (owner / manager / inspector /
    //   agent). `requireRole('owner', …)` never matches it and capabilities are
    //   looked up by role, so the account this script created for the person
    //   installing the product could do nothing at all.
    const company = initialCompany.replace(/'/g, "''");
    const sql = [
        `INSERT INTO tenants (id, slug, tier, status, max_users, deployment_mode, created_at) VALUES ('${tenantId}', '${effectiveSubdomain}', 'free', 'active', 5, 'shared', ${now});`,
        `INSERT INTO tenant_configs (tenant_id, company_name, updated_at) VALUES ('${tenantId}', '${company}', ${now});`,
        `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES ('${userId}', '${tenantId}', '${initialEmail.replace(/'/g, "''")}', '${initialPassHash}', 'owner', ${now});`
    ].join(' ');

    const targetDb = isLocal ? 'DB' : DB_NAME;
    const remoteFlag = isLocal ? '--local' : '--remote';

    try {
        // CodeQL js/incomplete-sanitization — escape backslash BEFORE double-quote so a
        // literal `\` in input doesn't break out of the shell quote. Order matters.
        const escapedSql = sql.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        run(`npx wrangler d1 execute ${targetDb} ${remoteFlag} --command "${escapedSql}" -c ${TOML_PATH}`);
        info("Database seeded successfully.");
    } catch (e) {
        warn(`Failed to seed database: ${e.message}`);
    }
}
