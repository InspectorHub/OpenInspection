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

    const sql = [
        `INSERT INTO tenants (id, name, subdomain, tier, status, max_users, created_at) VALUES ('${tenantId}', '${initialCompany.replace(/'/g, "''")}', '${effectiveSubdomain}', 'free', 'active', 5, ${now});`,
        `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES ('${userId}', '${tenantId}', '${initialEmail.replace(/'/g, "''")}', '${initialPassHash}', 'admin', ${now});`
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
