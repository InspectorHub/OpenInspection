import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// =============================================================================
// OpenInspection — Cloudflare Backup Script (D1 SQL + R2 Media)
// =============================================================================

// Argument Parsing Helper
const getArg = (key) => {
    const idx = process.argv.indexOf(key);
    return (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) ? process.argv[idx + 1] : null;
};

// C-17: resolve the wrangler config the same way scripts/wrangler.mjs does
// (--config flag > WRANGLER_CONFIG env > wrangler.local.jsonc > wrangler.jsonc)
// and derive the DB/bucket names FROM that config — the old hardcoded
// standalone names made `npm run backup` useless for the SaaS target.
const TOML_PATH = getArg('--config')
    || process.env.WRANGLER_CONFIG
    || (fs.existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');
const PROJECT_SLUG = 'openinspection';

function readWranglerConfig(file) {
    try {
        let raw = fs.readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
            .replace(/^\s*\/\/.*$/gm, '');          // whole-line comments
        try {
            return JSON.parse(raw);
        } catch {
            // Retry with trailing line comments stripped (safe for our configs —
            // no string values contain `//` outside URLs at line start).
            raw = raw.replace(/,?\s*\/\/[^"\n]*$/gm, (m) => (m.startsWith(',') ? ',' : ''));
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn(`  ⚠ Could not parse ${file} (${e.message}) — falling back to default resource names`);
        return {};
    }
}
const WRANGLER_CFG = readWranglerConfig(TOML_PATH);

// Dynamic Resource Naming (derived from the resolved config; flags override)
const DB_NAME = getArg('--db-name')
    || WRANGLER_CFG.d1_databases?.[0]?.database_name
    || `${PROJECT_SLUG}-db`;
const BUCKETS = (getArg('--buckets')?.split(',').filter(Boolean))
    || (WRANGLER_CFG.r2_buckets?.map((b) => b.bucket_name).filter(Boolean))
    || [`${PROJECT_SLUG}-photos`, `${PROJECT_SLUG}-photos-preview`];
const BACKUP_ROOT = 'backups';

const info = (msg) => console.log(`  ✓ ${msg}`);
const step = (msg) => { console.log(`\n▶ ${msg}`); };
const warn = (msg) => console.warn(`  ⚠ ${msg}`);
const die = (msg) => { console.error(`\n  ✗ ERROR: ${msg}`); process.exit(1); };

function run(cmd, options = {}) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: options.silent ? 'pipe' : 'inherit', ...options });
    } catch (e) {
        if (options.ignoreError) return e.stdout || e.stderr;
        die(`Command failed: ${cmd}\n${e.message}`);
    }
}

// 1. Create Timestamped Backup Directory
const now = new Date();
const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
const backupDir = path.join(BACKUP_ROOT, timestamp);

if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║         OpenInspection — Cloudflare Backup           ║");
console.log("╚══════════════════════════════════════════════════════╝");
info(`Config: ${TOML_PATH}`);
info(`Destination: ${backupDir}`);

// 2. Database Backup (D1)
step(`Backing up D1 Database: ${DB_NAME}`);
const sqlFile = path.join(backupDir, 'database.sql');
// Wrangler d1 export creates a local file directly
run(`npx wrangler d1 export ${DB_NAME} --remote --output "${sqlFile}" -c ${TOML_PATH}`);
info(`Database snapshotted to: ${sqlFile}`);

// 3. Media Backup (R2)
for (const bucket of BUCKETS) {
    step(`Backing up R2 Bucket: ${bucket}`);
    const mediaDir = path.join(backupDir, 'media', bucket);
    fs.mkdirSync(mediaDir, { recursive: true });

    const listJson = run(`npx wrangler r2 object list ${bucket} --json`, { silent: true, ignoreError: true });
    let objects = [];
    try {
        objects = JSON.parse(listJson);
    } catch (e) {
        warn(`Could not parse object list for ${bucket}. It might be empty.`);
    }

    if (objects.length === 0) {
        info(`Bucket ${bucket} is empty.`);
        continue;
    }

    info(`Found ${objects.length} objects. Downloading...`);
    for (const obj of objects) {
        const key = obj.key;
        const localPath = path.join(mediaDir, key);
        
        // Ensure subdirectories exist for keys like "folder/image.png"
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        
        run(`npx wrangler r2 object get "${bucket}/${key}" --file "${localPath}"`, { silent: true });
        console.log(`    - ${key}`);
    }
    info(`Bucket ${bucket} backed up.`);
}

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║  ✓ Backup complete!                                  ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log(`\n  All files saved to: ${backupDir}\n`);
