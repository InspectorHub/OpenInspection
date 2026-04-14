import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
const TOML_PATH = path.resolve(getArg('--config') || getArg('--toml') || 'wrangler.toml');
const PROJECT_SLUG = getArg('--name') || 'openinspection-standalone';
const PROJECT_TITLE = getArg('--app-name') || getArg('--title') || 'OpenInspection';

// Dynamic Resource Naming
const DB_NAME = getArg('--db-name') || `${PROJECT_SLUG}-db`;
const KV_NAME = getArg('--kv-name') || `${PROJECT_SLUG}-tenant-cache`;
const BUCKETS = [`${PROJECT_SLUG}-photos`];
const WORKER_NAME = PROJECT_SLUG;

const isForce = args.includes('--force') || args.includes('-y') || args.includes('--yes');
const isRefreshCode = args.includes('--refresh-setup-code');
const isLocal = args.includes('--local');

// Metadata for automated resource provisioning

const initialCompany = getArg('--company-name');
const initialSubdomain = getArg('--subdomain');
const initialEmail = getArg('--admin-email');
const initialPassHash = getArg('--admin-password-hash');
const isAutoSeed = initialCompany && initialEmail && initialPassHash;

const info = (msg) => console.log(`  ✓ ${msg}`);
const step = (msg) => { console.log(`\n▶ ${msg}`); };
const warn = (msg) => console.warn(`  ⚠ ${msg}`);
const die = (msg) => { console.error(`\n  ✗ ERROR: ${msg}`); process.exit(1); };

function run(cmd, options = {}) {
    const parts = cmd.split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    const maxRetries = options.ignoreRetry ? 0 : 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
        if (attempt > 0) {
            console.log(`  ⚠ Network timeout or instability detected. Retrying (${attempt}/${maxRetries})...`);
            // Brief sync sleep for 2s
            const start = Date.now();
            while (Date.now() - start < 2000) {}
        }

        const result = spawnSync(command, args, {
            encoding: 'utf8',
            shell: true,
            stdio: 'pipe', 
            input: options.input,
            env: { ...process.env, CI: 'true', NON_INTERACTIVE: 'true', WRANGLER_SEND_METRICS: 'false' },
            ...options
        });

        const output = (result.stdout || '') + (result.stderr || '');
        
        // Success
        if (result.status === 0) {
            if (!options.silent) {
                process.stdout.write(result.stdout || '');
                process.stderr.write(result.stderr || '');
            }
            return output;
        }

        // Specifically check for Cloudflare timeout / network errors
        const isTimeout = output.includes('timed out') || output.includes('timeout') || output.includes('ETIMEDOUT') || output.includes('fetch failed');
        
        if (isTimeout && attempt < maxRetries) {
            attempt++;
            continue;
        }

        // Final failure logic
        if (!options.ignoreError) {
            process.stdout.write(result.stdout || '');
            process.stderr.write(result.stderr || '');
            die(`Command failed after ${attempt} retries: ${cmd}\n${output}`);
        }
        return output;
    }
}

function extractJson(output) {
    const firstBrace = output.indexOf('{');
    const firstBracket = output.indexOf('[');
    let start = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) start = firstBrace;
    else start = firstBracket;

    const lastBrace = output.lastIndexOf('}');
    const lastBracket = output.lastIndexOf(']');
    let end = -1;
    if (lastBrace !== -1 && (lastBracket === -1 || lastBrace > lastBracket)) end = lastBrace;
    else end = lastBracket;

    if (start === -1 || end === -1 || end < start) return null;
    
    try {
        return JSON.parse(output.substring(start, end + 1));
    } catch (e) {
        return null;
    }
}

function getCloudflareState() {
    if (isLocal) return { d1: [], kv: [], r2: [] };
    const state = { d1: [], kv: [], r2: [] };
    try {
        const d1Output = run('npx wrangler d1 list --json', { silent: true, ignoreError: true });
        state.d1 = extractJson(d1Output) || [];
    } catch (e) {}
    try {
        const kvOutput = run('npx wrangler kv namespace list', { silent: true, ignoreError: true });
        state.kv = extractJson(kvOutput) || [];
    } catch (e) {}
    try {
        const r2Output = run('npx wrangler r2 bucket list', { silent: true, ignoreError: true });
        const lines = r2Output.split('\n');
        state.r2 = lines.filter(l => l.startsWith('name:')).map(l => l.replace('name:', '').trim());
    } catch (e) {}
    return state;
}

function seedDatabase() {
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
        run(`npx wrangler d1 execute ${targetDb} ${remoteFlag} --command "${sql.replace(/"/g, '\\"')}" -c ${TOML_PATH}`);
        info("Database seeded successfully.");
    } catch (e) {
        warn(`Failed to seed database: ${e.message}`);
    }
}

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log(`║     ${PROJECT_TITLE.padEnd(25)} — Cloudflare Setup              ║`);
console.log("╚══════════════════════════════════════════════════════╝");

if (isRefreshCode) {
    step("Refreshing Setup Verification Code...");
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const refreshCmd = isLocal
        ? `npx wrangler kv key put --binding=TENANT_CACHE "setup_verification_code" "${verificationCode}" --local`
        : `npx wrangler kv key put --binding=TENANT_CACHE "setup_verification_code" "${verificationCode}" --ttl 86400 --remote -c ${TOML_PATH}`;
    run(refreshCmd);
    info(`New verification code generated and stored in ${isLocal ? 'local ' : ''}KV${isLocal ? '' : ' (expires in 24h)'}`);
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log(`║  🔑 New Verification Code: ${verificationCode}               ║`);
    console.log("╚══════════════════════════════════════════════════════╝\n");
    process.exit(0);
}

// =============================================================================
// LOCAL MODE — Skip all remote Cloudflare resource creation
// =============================================================================
if (isLocal) {
    step("Step 1: Preparing .dev.vars...");
    const varsPath = '.dev.vars';
    const jwtSecret = crypto.randomBytes(32).toString('base64url');
    let vars = '';
    if (fs.existsSync(varsPath)) {
        vars = fs.readFileSync(varsPath, 'utf8');
    } else if (fs.existsSync('.dev.vars.example')) {
        vars = fs.readFileSync('.dev.vars.example', 'utf8')
            .split('\n')
            .filter(l => !l.startsWith('#') || l.trim() === '')
            .join('\n');
    }
    if (vars.includes('JWT_SECRET=')) {
        vars = vars.replace(/JWT_SECRET=.*/, `JWT_SECRET=${jwtSecret}`);
    } else {
        vars = `JWT_SECRET=${jwtSecret}\n` + vars;
    }
    fs.writeFileSync(varsPath, vars.trim() + '\n');
    info(`.dev.vars ${fs.existsSync(varsPath) ? 'updated' : 'created'} with JWT_SECRET`);

    step("Step 2: Applying local database migrations...");
    run('npx wrangler d1 migrations apply DB --local');
    info("Migrations applied locally");

    step("Step 3: Generating setup verification code (local KV)...");
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    run(`npx wrangler kv key put --binding=TENANT_CACHE "setup_verification_code" "${verificationCode}" --local`);
    info("Verification code stored in local KV");

    if (isAutoSeed) {
        seedDatabase();
    }

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║  ✓ Local Setup Ready                                 ║");
    console.log(`║  🔑 Verification Code: ${verificationCode}                   ║`);
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("\n  Next steps:");
    console.log("    1. npm run dev");
    process.exit(0);
}

// 1. Pre-Setup Check
step("Step 0: Pre-setup resource validation...");
const initialState = getCloudflareState();
const conflictD1 = initialState.d1.find(db => db.name === DB_NAME);
const conflictKV = initialState.kv.find(ns => ns.title === KV_NAME);
const conflictR2 = BUCKETS.filter(b => initialState.r2.includes(b));

if (conflictD1 || conflictKV || conflictR2.length > 0) {
    warn("Existing resources detected. This script will attempt to reuse or update them.");
    if (conflictD1) console.log(`  - Reusing D1 Database: ${DB_NAME} (${conflictD1.uuid})`);
    if (conflictKV) console.log(`  - Reusing KV Namespace: ${KV_NAME} (${conflictKV.id})`);
    if (conflictR2.length > 0) console.log(`  - Reusing R2 Buckets: ${conflictR2.join(', ')}`);
    info("Proceeding with idempotent setup...");
} else {
    info("Clean environment confirmed.");
}

// 2. Check Auth & Get Account ID
step("Step 1: Checking Cloudflare authentication...");
let whoamiJson;
try {
    const whoamiOutput = run('npx wrangler whoami --json', { silent: true });
    whoamiJson = extractJson(whoamiOutput);
} catch (e) {
    if (isForce) die("Not logged in and --force enabled. Please run 'npx wrangler login' first.");
    console.log("  Not logged in. Opening browser...");
    run('npx wrangler login');
    const whoamiOutput = run('npx wrangler whoami --json', { silent: true });
    whoamiJson = extractJson(whoamiOutput);
}

const accountId = whoamiJson?.account?.id || whoamiJson?.accounts?.[0]?.id;
if (!accountId) die("Could not determine Cloudflare account ID.");
info(`Account ID: ${accountId}`);

// 3. Create D1 Database
step(`Step 2: Preparing D1 database: ${DB_NAME}`);
let d1Id;

if (conflictD1) {
    info(`Using existing D1 database found in Step 0: ${conflictD1.uuid}`);
    d1Id = conflictD1.uuid;
} else {
    const d1Output = run(`npx wrangler d1 create ${DB_NAME}`, { ignoreError: true, silent: true });
    
    try {
        const d1ListResult = run('npx wrangler d1 list --json', { silent: true, ignoreError: true });
        d1Id = JSON.parse(d1ListResult).find(db => db.name === DB_NAME)?.uuid;
    } catch (e) {}
    
    if (!d1Id) {
        d1Id = d1Output.match(/database_id\s*=\s*"([^"]*)"/)?.[1] || d1Output.match(/"uuid":\s*"([^"]*)"/)?.[1];
    }
    
    // Fallback: Check wrangler.toml if create failed with "exists" and list didn't help
    if (!d1Id && d1Output.includes('already exists') && fs.existsSync(TOML_PATH)) {
        const toml = fs.readFileSync(TOML_PATH, 'utf8');
        const existingId = toml.match(/database_id\s*=\s*"([0-9a-f-]{36})"/)?.[1];
        if (existingId && existingId !== '00000000-0000-0000-0000-000000000000') {
            d1Id = existingId;
            warn(`Using existing D1 ID from ${TOML_PATH}: ${d1Id}`);
        }
    }
}

if (!d1Id) die(`Could not determine D1 database ID. Output: ${d1Output}`);
info(`D1 database ID: ${d1Id}`);

// 4. Create KV Namespace
step(`Step 3: Preparing KV namespace: ${KV_NAME}`);
let kvId;

if (conflictKV) {
    info(`Using existing KV namespace found in Step 0: ${conflictKV.id}`);
    kvId = conflictKV.id;
} else {
    const kvOutput = run(`npx wrangler kv namespace create ${KV_NAME}`, { ignoreError: true, silent: true });
    
    try {
        const kvListOutput = run('npx wrangler kv namespace list', { silent: true, ignoreError: true });
        kvId = JSON.parse(kvListOutput).find(ns => ns.title === KV_NAME)?.id;
    } catch (e) {}
    
    if (!kvId) {
        kvId = kvOutput.match(/id\s*=\s*"([^"]*)"/)?.[1] || kvOutput.match(/"id":\s*"([^"]*)"/)?.[1];
    }
}
if (!kvId) die(`Could not determine KV namespace ID. Status: ${initialState.kv.length > 0 ? 'Not found in list' : 'Empty list'}`);
info(`KV namespace ID: ${kvId}`);

// Clean up orphaned KV namespaces created automatically by Cloudflare Pages
const orphanedKV = initialState.kv.find(ns => ns.title === WORKER_NAME && ns.id !== kvId);
if (orphanedKV) {
    step(`Cleaning up orphaned KV namespace: ${orphanedKV.title}...`);
    run(`npx wrangler kv namespace delete --namespace-id ${orphanedKV.id}`, { ignoreError: true, silent: true });
    info("Orphaned KV namespace deleted");
}

// 5. Create R2 Buckets
step("Step 4: Creating R2 buckets...");
for (const bucket of BUCKETS) {
    run(`npx wrangler r2 bucket create ${bucket}`, { ignoreError: true, silent: true });
}
info("R2 buckets ready");

// 6. Patch wrangler.toml
step(`Step 5: Patching ${TOML_PATH} with resource IDs...`);
if (fs.existsSync(TOML_PATH)) {
    let toml = fs.readFileSync(TOML_PATH, 'utf8');
    // More robust regex for patching with word boundaries
    toml = toml.replace(/\bdatabase_id\s*=\s*"00000000-0000-0000-0000-000000000000"/, `database_id = "${d1Id}"`);
    toml = toml.replace(/\bid\s*=\s*"00000000000000000000000000000000"/, `id = "${kvId}"`);
    // Final generic fallback if placeholders were already changed
    if (!toml.includes(d1Id)) toml = toml.replace(/\bdatabase_id\s*=\s*"[^"]*"/, `database_id = "${d1Id}"`);
    if (!toml.includes(kvId)) toml = toml.replace(/\bid\s*=\s*"[^"]*"/, `id = "${kvId}"`);
    fs.writeFileSync(TOML_PATH, toml);
    info(`${TOML_PATH} updated`);
}

// 7. Apply Database Migrations
step("Step 6: Applying database migrations (remote)...");
run(`npx wrangler d1 migrations apply ${DB_NAME} --remote -c ${TOML_PATH}`);
info("Migrations applied");

// 7. Patch Global Branding (If custom title provided)
if (PROJECT_TITLE !== 'OpenInspection' && fs.existsSync(TOML_PATH)) {
    step(`Step 7: Applying custom branding for ${PROJECT_TITLE}...`);
    let toml = fs.readFileSync(TOML_PATH, 'utf8');
    toml = toml.replace(/APP_NAME\s*=\s*"[^"]*"/, `APP_NAME = "${PROJECT_TITLE}"`);
    fs.writeFileSync(TOML_PATH, toml);
    info("APP_NAME updated in wrangler.toml");
}

// 8. Generate Setup Verification Code
step("Step 8: Generating Setup Verification Code...");
const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
const kvNamespaceId = kvId; // We already have it from Step 3
const kvPutOutput = run(`npx wrangler kv key put "setup_verification_code" "${verificationCode}" --namespace-id "${kvNamespaceId}" --ttl 86400 --remote`, { silent: true, ignoreError: true });
if (kvPutOutput.includes('error') || kvPutOutput.includes('ERROR')) {
    die(`Failed to store verification code in KV: ${kvPutOutput}`);
}
info("Verification code generated and stored in KV (expires in 24h)");

// 9. Build and Deploy
step("Step 9: Building CSS and deploying Worker...");
run('npm run css:build', { silent: true });
const deployOutput = run(`npx wrangler deploy -c ${TOML_PATH}`, { ignoreError: true });

// 10. Automated Database Seeding (Optional)
if (isAutoSeed) {
    seedDatabase();
}

// 12. Post-Setup Verification
step("Final Step: Verifying setup success...");
const finalState = getCloudflareState();
const verifiedD1 = finalState.d1.find(db => db.name === DB_NAME);
const verifiedKV = finalState.kv.find(ns => ns.title === KV_NAME);
const verifiedR2 = BUCKETS.filter(b => finalState.r2.includes(b));

if (verifiedD1 && verifiedKV && verifiedR2.length === BUCKETS.length) {
    const urlMatch = deployOutput.match(/https?:\/\/[a-z0-9.-]+\.workers\.dev/);
    const workerUrl = urlMatch ? urlMatch[0] : `https://${WORKER_NAME}.workers.dev`;

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║  ✓ Setup Success: All resources verified.            ║");
    console.log(`║  🔑 Verification Code: ${verificationCode}                   ║`);
    if (isAutoSeed) {
        console.log("║  ℹ Zero-Config enabled: Initial records created.     ║");
    }
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log(`\n  Worker URL: ${workerUrl}`);
} else {
    warn("Some resources could not be verified post-setup.");
}
