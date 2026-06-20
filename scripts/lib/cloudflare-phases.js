import fs from 'fs';
import crypto from 'crypto';
import { run, info, step, warn, die, extractJson } from './cloudflare-exec.js';
import { getCloudflareState } from './cloudflare-resources.js';
import { seedDatabase } from './cloudflare-db.js';

// =============================================================================
// OpenInspection — Cloudflare Setup: phased orchestration steps
// =============================================================================

// LOCAL MODE — Skip all remote Cloudflare resource creation
export function runLocalSetup(ctx) {
    const { isAutoSeed, initialCompany, initialSubdomain, initialEmail, initialPassHash, isLocal, DB_NAME, TOML_PATH } = ctx;

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

    // Ensure a usable SETUP_CODE in .dev.vars — the local /setup gate reads it
    // from c.env.SETUP_CODE. Replace the placeholder (or add one if missing);
    // leave a real operator-chosen value untouched.
    const setupMatch = vars.match(/^SETUP_CODE=(.*)$/m);
    let setupCode;
    if (!setupMatch || setupMatch[1].trim() === '' || setupMatch[1].trim() === 'change-me-6-chars-min') {
        setupCode = crypto.randomBytes(4).toString('hex');
        vars = setupMatch
            ? vars.replace(/^SETUP_CODE=.*$/m, `SETUP_CODE=${setupCode}`)
            : `SETUP_CODE=${setupCode}\n` + vars;
    } else {
        setupCode = setupMatch[1].trim();
    }

    fs.writeFileSync(varsPath, vars.trim() + '\n');
    info('.dev.vars written with JWT_SECRET + SETUP_CODE');

    step("Step 2: Applying local database migrations...");
    run('npx wrangler d1 migrations apply DB --local');
    info("Migrations applied locally");

    if (isAutoSeed) {
        seedDatabase({ initialCompany, initialSubdomain, initialEmail, initialPassHash, isLocal, DB_NAME, TOML_PATH });
    }

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║  ✓ Local Setup Ready                                 ║");
    console.log(`║  🔑 Setup code: ${setupCode.padEnd(38)}║`);
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("\n  Next steps:");
    console.log("    1. npm run dev");
    console.log("    2. Open /setup and enter the setup code above");
    process.exit(0);
}

// REMOTE MODE — Provision real Cloudflare resources and deploy.
export function runRemoteSetup(ctx) {
    const {
        isForce, isLocal, isAutoSeed,
        DB_NAME, KV_NAME, BUCKETS, WORKER_NAME,
        PROJECT_TITLE, TOML_PATH,
        initialCompany, initialSubdomain, initialEmail, initialPassHash,
    } = ctx;

    // 1. Pre-Setup Check
    step("Step 0: Pre-setup resource validation...");
    const initialState = getCloudflareState({ isLocal });
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
    let d1Output = '';

    if (conflictD1) {
        info(`Using existing D1 database found in Step 0: ${conflictD1.uuid}`);
        d1Id = conflictD1.uuid;
    } else {
        d1Output = run(`npx wrangler d1 create ${DB_NAME}`, { ignoreError: true, silent: true });

        // Use extractJson (not raw JSON.parse) — `run()` merges stderr into the
        // output and wrangler prepends a warning (e.g. the "unsafe fields" notice),
        // which would break a bare JSON.parse.
        const d1List = extractJson(run('npx wrangler d1 list --json', { silent: true, ignoreError: true, stdoutOnly: true }));
        if (Array.isArray(d1List)) d1Id = d1List.find(db => db.name === DB_NAME)?.uuid;

        if (!d1Id) {
            d1Id = d1Output.match(/database_id\s*=\s*"([^"]*)"/)?.[1] || d1Output.match(/"uuid":\s*"([^"]*)"/)?.[1];
        }

        // Fallback: Check wrangler.local.jsonc if create failed with "exists" and list didn't help
        if (!d1Id && d1Output.includes('already exists') && fs.existsSync(TOML_PATH)) {
            const toml = fs.readFileSync(TOML_PATH, 'utf8');
            const existingId = toml.match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1];
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

        // extractJson (not raw JSON.parse) — see the D1 note above.
        const kvList = extractJson(run('npx wrangler kv namespace list', { silent: true, ignoreError: true, stdoutOnly: true }));
        if (Array.isArray(kvList)) kvId = kvList.find(ns => ns.title === KV_NAME)?.id;

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

    // 6. Patch wrangler.local.jsonc
    step(`Step 5: Patching ${TOML_PATH} with resource IDs...`);
    if (fs.existsSync(TOML_PATH)) {
        let toml = fs.readFileSync(TOML_PATH, 'utf8');
        // More robust regex for patching with word boundaries
        toml = toml.replace(/"database_id":\s*"00000000-0000-0000-0000-000000000000"/, `"database_id": "${d1Id}"`);
        toml = toml.replace(/"id":\s*"00000000000000000000000000000000"/, `"id": "${kvId}"`);
        // Final generic fallback if placeholders were already changed
        if (!toml.includes(d1Id)) toml = toml.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${d1Id}"`);
        if (!toml.includes(kvId)) toml = toml.replace(/"id":\s*"[^"]*"/, `"id": "${kvId}"`);
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
        toml = toml.replace(/"APP_NAME":\s*"[^"]*"/, `"APP_NAME": "${PROJECT_TITLE}"`);
        fs.writeFileSync(TOML_PATH, toml);
        info("APP_NAME updated in wrangler.local.jsonc");
    }

    // 8. Build & Deploy via the canonical `npm run deploy` (react-router build →
    // wrangler deploy build/server/wrangler.json → jwt:ensure → setup-code:ensure).
    // The single-worker build needs the react-router bundle (virtual:react-router/
    // server-build), so a direct `wrangler deploy` cannot ship it. `npm run deploy`
    // resolves the wrangler config from WRANGLER_CONFIG — point it at the one we
    // just wrote — and its final setup-code:ensure step prints the first-run code.
    step("Step 8: Building and deploying Worker (npm run deploy)...");
    const deployOutput = run('npm run deploy', {
        env: { ...process.env, CI: 'true', NON_INTERACTIVE: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_CONFIG: TOML_PATH },
        ignoreError: true,
    });

    // 10. Automated Database Seeding (Optional)
    if (isAutoSeed) {
        seedDatabase({ initialCompany, initialSubdomain, initialEmail, initialPassHash, isLocal, DB_NAME, TOML_PATH });
    }

    // 12. Post-Setup Verification
    step("Final Step: Verifying setup success...");
    const finalState = getCloudflareState({ isLocal });
    const verifiedD1 = finalState.d1.find(db => db.name === DB_NAME);
    const verifiedKV = finalState.kv.find(ns => ns.title === KV_NAME);
    const verifiedR2 = BUCKETS.filter(b => finalState.r2.includes(b));

    if (verifiedD1 && verifiedKV && verifiedR2.length === BUCKETS.length) {
        const urlMatch = deployOutput.match(/https?:\/\/[a-z0-9.-]+\.workers\.dev/);
        const workerUrl = urlMatch ? urlMatch[0] : `https://${WORKER_NAME}.workers.dev`;

        console.log("\n╔══════════════════════════════════════════════════════╗");
        console.log("║  ✓ Setup Success: All resources verified.            ║");
        if (isAutoSeed) {
            console.log("║  ℹ Zero-Config enabled: Initial records created.     ║");
        }
        console.log("╚══════════════════════════════════════════════════════╝");
        console.log(`\n  Worker URL: ${workerUrl}`);
        console.log("  Setup code: printed by the deploy step above — enter it at /setup.");
    } else {
        warn("Some resources could not be verified post-setup.");
    }
}
