import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// =============================================================================
// OpenInspection — Cloudflare Resource Teardown (Validated & Robust)
// =============================================================================

const args = process.argv.slice(2);

// Argument Parsing Helper
const getArg = (key) => {
    const idx = args.indexOf(key);
    return (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) ? args[idx + 1] : null;
};

// Configuration Paths & Naming
const TOML_PATH = path.resolve(getArg('--config') || getArg('--toml') || 'wrangler.toml');
const PROJECT_SLUG = getArg('--name') || 'openinspection';

// Project Context (Initialized via Args or Fallback)
const isForce = args.includes('--force') || args.includes('-y') || args.includes('--yes');
const isLocal = args.includes('--local');

// Global state for discovered resources
const discovered = {
    worker: PROJECT_SLUG,
    databases: [],    // { name, uuid, found: false }
    kvNamespaces: [], // { title, id, found: false }
    buckets: [],       // { name, found: false }
    isSaaS: fs.existsSync(TOML_PATH)
};

// Step 0: Intelligent Discovery — Parse TOML if it exists
if (discovered.isSaaS) {
    try {
        const toml = fs.readFileSync(TOML_PATH, 'utf8');
        const getVal = (regex) => {
            const match = toml.match(regex);
            return match ? match[1] : null;
        };
        
        // 0.1 Worker Name
        const configWorker = getVal(/name\s*=\s*"([^"]+)"/);
        if (configWorker) discovered.worker = configWorker;

        // 0.2 D1 Databases (All)
        const d1Matches = [...toml.matchAll(/database_name\s*=\s*"([^"]+)"/g)];
        const d1Ids = [...toml.matchAll(/database_id\s*=\s*"([^"]+)"/g)];
        d1Matches.forEach((m, i) => {
            discovered.databases.push({ name: m[1], uuid: d1Ids[i] ? d1Ids[i][1] : null });
        });

        // 0.3 KV Namespaces (All - looking for ID inside blocks)
        const kvBlocks = toml.split('[[kv_namespaces]]').slice(1);
        kvBlocks.forEach(block => {
            const idMatch = block.match(/id\s*=\s*"([^"]+)"/);
            const bindingMatch = block.match(/binding\s*=\s*"([^"]+)"/);
            if (idMatch && idMatch[1] !== '00000000000000000000000000000000') {
                discovered.kvNamespaces.push({ id: idMatch[1], binding: bindingMatch ? bindingMatch[1] : 'Unknown' });
            }
        });

        // 0.4 R2 Buckets (All)
        const bucketMatches = [...toml.matchAll(/bucket_name\s*=\s*"([^"]+)"/g)];
        bucketMatches.forEach(m => discovered.buckets.push({ name: m[1] }));

    } catch (e) {
        console.warn(`  ⚠ Failed to parse ${TOML_PATH}: ${e.message}. Falling back to naming conventions.`);
    }
}

// Fallback logic if nothing found in TOML or TOML missing
if (discovered.databases.length === 0) discovered.databases.push({ name: `${PROJECT_SLUG}-db` });
if (discovered.kvNamespaces.length === 0) discovered.kvNamespaces.push({ title: `${PROJECT_SLUG}-tenant-cache` });
if (discovered.buckets.length === 0) discovered.buckets = [{ name: `${PROJECT_SLUG}-photos` }, { name: `${PROJECT_SLUG}-photos-preview` }];

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

        // Always pipe so we can inspect output for 404/Not Found patterns
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
        const isTimeout = output.includes('timed out') || output.includes('timeout') || output.includes('ETIMEDOUT');

        if (isTimeout && attempt < maxRetries) {
            attempt++;
            continue;
        }

        // Swallow logic for teardown
        if (!options.ignoreError) {
            const carriesSwallowCode = options.swallowNotFound && (
                output.includes('10007') || 
                output.includes('10090') || 
                output.includes('7400') || 
                output.includes('not found') || 
                output.includes("Couldn't find") ||
                output.includes("not exist") ||
                output.includes("Invalid uuid")
            );

            if (carriesSwallowCode) {
                return output;
            }
            
            // Final failure logic
            if (!options.silent) {
                process.stdout.write(result.stdout || '');
                process.stderr.write(result.stderr || '');
            }
            die(`Command failed after ${attempt} retries: ${cmd}\n${output}`);
        }
        
        if (!options.silent) {
            process.stdout.write(result.stdout || '');
            process.stderr.write(result.stderr || '');
        }
        return output;
    }
}

function getCloudflareState() {
    if (isLocal) return { d1: [], kv: [], r2: [] };
    const state = { d1: [], kv: [], r2: [] };
    
    // D1
    try {
        const d1Output = run('npx wrangler d1 list --json', { silent: true, ignoreError: true });
        state.d1 = JSON.parse(d1Output);
    } catch (e) {}

    // KV
    try {
        const kvOutput = run('npx wrangler kv namespace list', { silent: true, ignoreError: true });
        state.kv = JSON.parse(kvOutput);
    } catch (e) {}

    // R2
    try {
        const r2Output = run('npx wrangler r2 bucket list', { silent: true, ignoreError: true });
        const lines = r2Output.split('\n');
        state.r2 = lines.filter(l => l.startsWith('name:')).map(l => l.replace('name:', '').trim());
    } catch (e) {}

    return state;
}

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log(`║  ${PROJECT_SLUG.padEnd(25)} — Cloudflare Teardown         ║`);
console.log("╚══════════════════════════════════════════════════════╝");

step("Step 0: Initializing resource validation...");
const initialState = getCloudflareState();

// Map and Validate Discovered Resources
discovered.databases.forEach(db => {
    const live = initialState.d1.find(l => l.name === db.name || l.uuid === db.uuid);
    if (live) { db.uuid = live.uuid; db.found = true; }
});
discovered.kvNamespaces.forEach(kv => {
    const live = initialState.kv.find(l => l.title === kv.title || l.id === kv.id);
    if (live) { kv.id = live.id; kv.title = live.title; kv.found = true; }
});
discovered.buckets.forEach(b => {
    if (initialState.r2.includes(b.name)) b.found = true;
});

if (isLocal) {
    const localState = fs.existsSync('.wrangler') ? '.wrangler/ (local DB + KV)' : null;
    const devVars = fs.existsSync('.dev.vars') ? '.dev.vars' : null;
    const localItems = [localState, devVars].filter(Boolean);
    console.log("\n  Local resources to remove:");
    if (localItems.length === 0) {
        console.log("  ✓ No local state found. Nothing to do.");
        process.exit(0);
    }
    localItems.forEach(p => console.log(`  - ${p}`));
} else {
    console.log("\n  Discovery Plan (Resources identified for deletion):");
    console.log(`  [Worker]  ${discovered.worker}`);
    
    discovered.databases.forEach(db => {
        console.log(`  [D1]      ${db.name.padEnd(20)} | ${db.uuid || 'N/A'.padEnd(36)} | ${db.found ? 'FOUND' : 'MISSING'}`);
    });
    discovered.kvNamespaces.forEach(kv => {
        console.log(`  [KV]      ${(kv.binding || kv.title).padEnd(20)} | ${kv.id || 'N/A'.padEnd(36)} | ${kv.found ? 'FOUND' : 'MISSING'}`);
    });
    discovered.buckets.forEach(b => {
        console.log(`  [R2]      ${b.name.padEnd(20)} | ${'N/A'.padEnd(36)} | ${b.found ? 'FOUND' : 'MISSING'}`);
    });

    const anyFound = discovered.databases.some(d => d.found) || discovered.kvNamespaces.some(k => k.found) || discovered.buckets.some(b => b.found);
    if (!anyFound) {
        const workerCheck = run(`npx wrangler deployments list --name ${discovered.worker} --json`, { silent: true, ignoreError: true }).toLowerCase();
        if (workerCheck.includes('10007') || workerCheck.includes('not found') || workerCheck.includes('not exist') || workerCheck.includes('does not exist')) {
            console.log("\n  ✓ No relevant Cloudflare resources found for deletion. Nothing to do.");
            process.exit(0);
        }
    }
}

if (!isForce) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\n  Type 'yes' to proceed with deletion: ", (answer) => {
        if (answer.toLowerCase() !== 'yes') { console.log("  Aborted."); process.exit(0); }
        rl.close();
        executeTeardown();
    });
} else {
    executeTeardown();
}

async function executeTeardown() {
    const backupPath = TOML_PATH + '.bak';
    const hasToml = fs.existsSync(TOML_PATH);

    if (isLocal) {
        step("Step 1: Removing local state...");
        const localPaths = ['.wrangler', '.dev.vars'];
        for (const p of localPaths) {
            if (fs.existsSync(p)) {
                if (fs.lstatSync(p).isDirectory()) {
                    fs.rmSync(p, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(p);
                }
                info(`Deleted: ${p}`);
            }
        }
        console.log("\n╔══════════════════════════════════════════════════════╗");
        console.log("║  ✓ Local Teardown Complete                           ║");
        console.log("╚══════════════════════════════════════════════════════╝");
        console.log("\n  Run 'npm run setup:local' to re-initialize.\n");
        return;
    }

    try {
        if (hasToml) {
            fs.renameSync(TOML_PATH, backupPath);
            info("Temporarily bypassing wrangler.toml to avoid ID conflicts");
        }

        // 1. Delete Worker
        step(`Step 1: Deleting Worker: ${discovered.worker}`);
        run(`npx wrangler delete --name ${discovered.worker} --force`, { ignoreError: true, swallowNotFound: true });
        info("Worker deletion cleanup attempted");

        // 2. Delete D1 Databases
        step("Step 2: Deleting D1 databases...");
        for (const db of discovered.databases) {
            if (db.found || db.uuid) {
                run(`npx wrangler d1 delete ${db.name} --skip-confirmation`, { swallowNotFound: true });
                info(`D1 database deleted: ${db.name}`);
            }
        }

        // 3. Delete KV Namespaces
        step("Step 3: Deleting KV namespaces...");
        for (const kv of discovered.kvNamespaces) {
            if (kv.found || kv.id) {
                run(`npx wrangler kv namespace delete --namespace-id ${kv.id}`, { swallowNotFound: true, input: 'y\n' });
                info(`KV namespace deleted: ${kv.id} (${kv.binding || kv.title})`);
            }
        }

        // 4. Delete R2 Buckets
        step("Step 4: Deleting R2 buckets...");
        for (const bucket of discovered.buckets) {
            if (bucket.found) {
                run(`npx wrangler r2 bucket delete ${bucket.name}`, { ignoreError: true, swallowNotFound: true, input: 'y\n' });
                info(`R2 bucket deleted: ${bucket.name}`);
            }
        }

    } finally {
        if (fs.existsSync(backupPath)) {
            fs.renameSync(backupPath, TOML_PATH);
        }
    }

    // 5. Reset wrangler.toml
    step("Step 5: Resetting wrangler.toml to placeholder state...");
    if (fs.existsSync(TOML_PATH)) {
        let toml = fs.readFileSync(TOML_PATH, 'utf8');
        // Reset Database ID to placeholder
        toml = toml.replace(/database_id\s*=\s*"[^"]*"/g, 'database_id = "00000000-0000-0000-0000-000000000000"');
        // Reset KV ID to placeholder
        toml = toml.replace(/id\s*=\s*"[^"]*"/g, 'id = "00000000000000000000000000000000"');
        // Reset Base URL to default
        toml = toml.replace(/APP_BASE_URL\s*=\s*"https:\/\/[^"]*"/g, 'APP_BASE_URL = "https://openinspection.workers.dev"');
        fs.writeFileSync(TOML_PATH, toml);
        info("wrangler.toml reset");
    }

    // Verification
    step("Final Step: Verifying teardown success...");
    const finalState = getCloudflareState();
    const remainingD1 = discovered.databases.filter(db => finalState.d1.find(l => l.name === db.name));
    const remainingKV = discovered.kvNamespaces.filter(kv => finalState.kv.find(l => l.id === kv.id));
    const remainingR2 = discovered.buckets.filter(b => finalState.r2.includes(b.name));

    if (remainingD1.length === 0 && remainingKV.length === 0 && remainingR2.length === 0) {
        console.log("\n╔══════════════════════════════════════════════════════╗");
        console.log("║  ✓ Teardown Success: All resources cleared.          ║");
        console.log("╚══════════════════════════════════════════════════════╝\n");
    } else {
        warn("Some resources could not be automatically cleared:");
        remainingD1.forEach(db => console.log(`  - D1: ${db.name}`));
        remainingKV.forEach(kv => console.log(`  - KV: ${kv.id}`));
        remainingR2.forEach(b => console.log(`  - R2: ${b.name}`));
        console.log("\n  Deployment may fail until these are manually cleared.\n");
    }
}
