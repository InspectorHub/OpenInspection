import path from 'path';
import { ensureTomlExists } from './lib/cloudflare-db.js';
import { runLocalSetup, runRemoteSetup } from './lib/cloudflare-phases.js';

// =============================================================================
// OpenInspection — Cloudflare One-Command Setup (Validated & Robust)
// =============================================================================

const args = process.argv.slice(2);

// Argument Parsing Helper
const getArg = (key) => {
    const idx = args.indexOf(key);
    return (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) ? args[idx + 1] : null;
};

// Configuration Paths & Naming
// CONFIG_PATH = the gitignored local config with real ids (written here);
// TEMPLATE_PATH = the committed placeholder wrangler.jsonc it's bootstrapped from.
const TOML_PATH = path.resolve(getArg('--config') || 'wrangler.local.jsonc');
const TOML_EXAMPLE_PATH = path.resolve(path.dirname(TOML_PATH), 'wrangler.jsonc');
const PROJECT_SLUG = getArg('--name') || 'openinspection';
const PROJECT_TITLE = getArg('--app-name') || getArg('--title') || 'OpenInspection';

// Dynamic Resource Naming
const DB_NAME = getArg('--db-name') || `${PROJECT_SLUG}-db`;
const KV_NAME = getArg('--kv-name') || `${PROJECT_SLUG}-tenant-cache`;
// Single R2 bucket — PHOTOS holds photos + report/cert PDFs + e-sign evidence
// (there is no separate REPORTS bucket; wrangler.jsonc binds only PHOTOS).
const BUCKETS = [`${PROJECT_SLUG}-photos`];
const WORKER_NAME = PROJECT_SLUG;

const isForce = args.includes('--force') || args.includes('-y') || args.includes('--yes');
const isLocal = args.includes('--local');

// Metadata for automated resource provisioning

const initialCompany = getArg('--company-name');
const initialSubdomain = getArg('--subdomain');
const initialEmail = getArg('--admin-email');
const initialPassHash = getArg('--admin-password-hash');
const isAutoSeed = initialCompany && initialEmail && initialPassHash;

// Shared context passed to the extracted phase steps.
const ctx = {
    args, getArg,
    TOML_PATH, TOML_EXAMPLE_PATH, PROJECT_SLUG, PROJECT_TITLE,
    DB_NAME, KV_NAME, BUCKETS, WORKER_NAME,
    isForce, isLocal,
    initialCompany, initialSubdomain, initialEmail, initialPassHash, isAutoSeed,
};

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log(`║     ${PROJECT_TITLE.padEnd(25)} — Cloudflare Setup              ║`);
console.log("╚══════════════════════════════════════════════════════╝");

ensureTomlExists({ TOML_PATH, TOML_EXAMPLE_PATH });

// =============================================================================
// LOCAL MODE — Skip all remote Cloudflare resource creation
// =============================================================================
if (isLocal) {
    runLocalSetup(ctx);
}

runRemoteSetup(ctx);
